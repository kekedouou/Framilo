//! Eagle native media bridge. FilmCraft demux/decoder/cache with source-PTS audit.
//! Runtime is self-contained; source and build dependencies are development-only.
use std::io::{self, BufRead, Write};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use filmcraft_media::{FrameRequest, reader::{FileReader, open_reader_within}};
use filmcraft_time::Tick;

struct Job { id: u64, ticks: i64, cancel: Arc<AtomicBool>, sent: Instant }
#[derive(Default)]
struct Queue { pending: Option<Job>, active: Option<Arc<AtomicBool>>, closed: bool }

fn quoted(text: &str) -> String {
    let mut out = String::from("\"");
    for c in text.chars() {
        match c { '"' => out.push_str("\\\""), '\\' => out.push_str("\\\\"),
            c if c < ' ' => out.push_str(&format!("\\u{:04x}", c as u32)), c => out.push(c) }
    }
    out.push('"'); out
}
fn emit(header: String, pixels: &[u8]) -> io::Result<()> {
    if header.len() > 8192 || pixels.len() > 64 * 1024 * 1024 { return Err(io::Error::other("oversized output")); }
    let mut output = io::stdout().lock();
    output.write_all(&(header.len() as u32).to_le_bytes())?;
    output.write_all(&(pixels.len() as u32).to_le_bytes())?;
    output.write_all(header.as_bytes())?; output.write_all(pixels)?; output.flush()
}
fn resize_rgba(src: &[u8], sw: usize, sh: usize, dw: usize, dh: usize) -> Result<Vec<u8>, String> {
    // Bilinear display resampling. SAR correction may expand raw sample width;
    // output_size validates against the source's display size before this function runs.
    let source_len = sw.checked_mul(sh).and_then(|n| n.checked_mul(4)).ok_or("source image dimensions overflow")?;
    let output_len = dw.checked_mul(dh).and_then(|n| n.checked_mul(4)).ok_or("output image dimensions overflow")?;
    if sw == 0 || sh == 0 || dw == 0 || dh == 0 || source_len != src.len() || output_len > 64 * 1024 * 1024 { return Err("invalid resize dimensions".into()); }
    let mut out = Vec::new();
    out.try_reserve_exact(output_len).map_err(|e| e.to_string())?;
    out.resize(output_len, 0);
    for y in 0..dh {
        let fy = ((y as f64 + 0.5) * sh as f64 / dh as f64 - 0.5).max(0.0);
        let y0 = fy.floor() as usize; let y1 = (y0 + 1).min(sh - 1); let wy = fy - y0 as f64;
        for x in 0..dw {
            let fx = ((x as f64 + 0.5) * sw as f64 / dw as f64 - 0.5).max(0.0);
            let x0 = fx.floor() as usize; let x1 = (x0 + 1).min(sw - 1); let wx = fx - x0 as f64;
            for c in 0..4 {
                let a = src[(y0 * sw + x0) * 4 + c] as f64 * (1.0 - wx) + src[(y0 * sw + x1) * 4 + c] as f64 * wx;
                let b = src[(y1 * sw + x0) * 4 + c] as f64 * (1.0 - wx) + src[(y1 * sw + x1) * 4 + c] as f64 * wx;
                out[(y * dw + x) * 4 + c] = (a * (1.0 - wy) + b * wy).round() as u8;
            }
        }
    }
    Ok(out)
}
fn output_size(w: u32, h: u32, par: (u32, u32), quality: u32, requested: Option<(u32, u32)>) -> Result<(u32, u32), String> {
    if w == 0 || h == 0 || par.0 == 0 || par.1 == 0 { return Err("invalid source display geometry".into()); }
    let display_w = w as f64 * par.0 as f64 / par.1 as f64;
    let display_h = h as f64;
    let long = match quality { 720 => 1280, 1080 => 1920, 1440 => 2560, 2160 => 3840, _ => return Err("unsupported output quality".into()) };
    let (max_w, max_h) = if display_w < display_h { (quality, long) } else { (long, quality) };
    let (ow, oh) = match requested {
        Some((ow, oh)) => (ow, oh),
        None => { let scale = 1.0f64.min(max_w as f64 / display_w).min(max_h as f64 / display_h);
            (((display_w * scale + 1e-8).floor() as u32).max(1), ((display_h * scale + 1e-8).floor() as u32).max(1)) }
    };
    if ow == 0 || oh == 0 || ow > max_w || oh > max_h || ow as f64 > display_w + 1e-8 || oh as f64 > display_h + 1e-8 {
        return Err("requested output exceeds source display size or quality bounds".into());
    }
    // The shared profile floors both display dimensions, allowing at most one pixel's rounding.
    if ((ow as f64 / display_w) - (oh as f64 / display_h)).abs() > (1.0 / display_w).max(1.0 / display_h) + 1e-8 {
        return Err("requested output does not preserve source display aspect ratio".into());
    }
    Ok((ow, oh))
}
fn yuv420_payload(frame: &filmcraft_frame::VideoFrame) -> Result<Option<(Vec<u8>, &'static str, bool)>, String> {
    use filmcraft_frame::{PixelData, Chroma};
    use filmcraft_color::{Matrix, Range, Transfer};
    // Match FilmCraft's direct-display color path. HDR/log or unsupported matrix needs
    // its existing CPU conversion rather than a shader which silently changes the transfer.
    let matrix = match frame.color.matrix { Matrix::Bt709 => "bt709", Matrix::Bt601 => "bt601", _ => return Ok(None) };
    if !matches!(frame.color.transfer, Transfer::Bt709 | Transfer::Srgb) { return Ok(None); }
    let PixelData::Yuv8 { planes, chroma: Chroma::C420, alpha: None } = &frame.data else { return Ok(None) };
    let (w,h) = (frame.width as usize, frame.height as usize);
    let y = w.checked_mul(h).ok_or("Y plane dimensions overflow")?;
    let c = w.div_ceil(2).checked_mul(h.div_ceil(2)).ok_or("chroma plane dimensions overflow")?;
    let bytes = c.checked_mul(2).and_then(|n| n.checked_add(y)).ok_or("YUV payload dimensions overflow")?;
    if w == 0 || h == 0 || bytes > 64*1024*1024 || planes[0].len()!=y || planes[1].len()!=c || planes[2].len()!=c {
        return Err("invalid YUV420 plane shape or payload budget".into());
    }
    let mut payload = Vec::new(); payload.try_reserve_exact(bytes).map_err(|e|e.to_string())?;
    for plane in planes { payload.extend_from_slice(plane); }
    Ok(Some((payload,matrix,matches!(frame.color.range,Range::Full))))
}
// Resample planar samples before color conversion. Non-integer 4K -> 1440p
// must not expand a whole 4K frame to CPU RGBA and then rescale four channels.
fn resize_plane(src:&[u8], sw:usize, sh:usize, dw:usize, dh:usize)->Result<Vec<u8>,String>{
    let count=dw.checked_mul(dh).ok_or("plane overflow")?;
    if sw==0||sh==0||dw==0||dh==0||sw.checked_mul(sh)!=Some(src.len())||count>64*1024*1024{return Err("invalid plane resize".into());}
    let axis=|input:usize,output:usize| -> Vec<(usize,usize,u32)> {(0..output).map(|i|{let f=((i as f64+0.5)*input as f64/output as f64-0.5).clamp(0.0,(input-1) as f64);let a=f.floor() as usize;(a,(a+1).min(input-1),((f-a as f64)*1024.0).round() as u32)}).collect()};
    let xs=axis(sw,dw);let ys=axis(sh,dh);let mut out=vec![0u8;count];
    for (y,&(y0,y1,wy)) in ys.iter().enumerate(){for (x,&(x0,x1,wx)) in xs.iter().enumerate(){
        let a=src[y0*sw+x0] as u32*(1024-wx)+src[y0*sw+x1] as u32*wx;
        let b=src[y1*sw+x0] as u32*(1024-wx)+src[y1*sw+x1] as u32*wx;
        out[y*dw+x]=((a*(1024-wy)+b*wy+524288)>>20) as u8;
    }}Ok(out)
}
fn yuv420_scaled_payload(frame:&filmcraft_frame::VideoFrame,ow:u32,oh:u32)->Result<Option<(Vec<u8>,&'static str,bool)>,String>{
    let Some((source,matrix,full))=yuv420_payload(frame)? else{return Ok(None)};
    if ow==frame.width&&oh==frame.height{return Ok(Some((source,matrix,full)))}
    let (w,h,dw,dh)=(frame.width as usize,frame.height as usize,ow as usize,oh as usize);let y=w*h;let c=w.div_ceil(2)*h.div_ceil(2);
    let mut out=resize_plane(&source[..y],w,h,dw,dh)?;
    for n in 0..2{out.extend(resize_plane(&source[y+n*c..y+(n+1)*c],w.div_ceil(2),h.div_ceil(2),dw.div_ceil(2),dh.div_ceil(2))?);}
    Ok(Some((out,matrix,full)))
}
fn worker(path: String, height: u32, cache_bytes: usize, requested: Option<(u32,u32)>, prefer_yuv: bool, queue: Arc<(Mutex<Queue>, Condvar)>) -> Result<(), String> {
    filmcraft_codecs::gop::e44_set_budget(cache_bytes);
    let begin = Instant::now();
    let reader = Arc::new(FileReader::open(std::path::Path::new(&path)).map_err(|e| e.to_string())?);
    let source = open_reader_within(&path, reader, &filmcraft_codecs::reader_openers(), &filmcraft_codecs::openers(), 0)
        .map_err(|e| e.to_string())?;
    let info = source.info(); let video = info.video.as_ref().ok_or("source has no video")?;
    if video.width == 0 || video.height == 0 { return Err("source dimensions are zero".into()); }
    // The upstream cache keeps two decoded pictures while evicting; reserve a conservative
    // 8 bytes/pixel (including high-bit-depth planes) for both, rather than exceeding the ledger.
    let minimum = (video.width as usize).checked_mul(video.height as usize).and_then(|n| n.checked_mul(16)).ok_or("source dimensions overflow")?;
    if minimum > cache_bytes { return Err(format!("source needs at least {minimum} bytes for two native frames; configured cache is {cache_bytes}")); }
    emit(format!(concat!("{{\"event\":\"ready\",\"protocol\":2,\"openMs\":{},\"durationTicks\":{},\"cacheCeilingBytes\":{},",
        "\"sourceWidth\":{},\"sourceHeight\":{},\"qualityHeight\":{},\"outputWidth\":{},\"outputHeight\":{},\"audioStreams\":{},\"codec\":{}}}"),
        begin.elapsed().as_secs_f64()*1000.0, info.duration.0, cache_bytes, video.width, video.height, height,
        requested.map_or(0, |s| s.0), requested.map_or(0, |s| s.1),
        info.audio_streams.len(), quoted(&video.codec)), &[]).map_err(|e| e.to_string())?;
    loop {
        let job = {
            let mut state = queue.0.lock().unwrap_or_else(PoisonError::into_inner);
            while state.pending.is_none() && !state.closed { state = queue.1.wait(state).unwrap_or_else(PoisonError::into_inner); }
            if state.closed { break; }
            let Some(job) = state.pending.take() else { continue };
            state.active = Some(job.cancel.clone()); job
        };
        let start = Instant::now();
        let hw0 = filmcraft_codecs::hw::hw_stats();
        let stats0 = filmcraft_codecs::gop_stats();
        // Same exact-frame catch-up margin as FilmCraft FrameServer::request (SCRUB_KEEP_S).
        let result = filmcraft_media::cancel::with_cancel(&job.cancel, ||
            filmcraft_media::cancel::with_catch_up(Some(Tick::from_seconds_f64(2.0)), ||
                source.video_frame(FrameRequest::full(Tick(job.ticks)))));
        let decode_ms = start.elapsed().as_secs_f64()*1000.0;
        if job.cancel.load(Ordering::Relaxed) { continue; }
        match result {
            Err(e) => emit(format!("{{\"event\":\"error\",\"id\":{},\"message\":{}}}", job.id, quoted(&e.to_string())), &[]).map_err(|e| e.to_string())?,
            Ok(frame) => {
                if frame.width == 0 || frame.height == 0 { return Err("decoded frame dimensions are zero".into()); }
                let conversion = Instant::now();
                let (ow, oh) = output_size(frame.width, frame.height, frame.par, height, requested)?;
                let reduction = (frame.height / oh).max(1) as usize;
                let small = frame.box_decimated(reduction);
                let picture = small.as_ref().unwrap_or(&frame);
                let planar = if prefer_yuv { yuv420_scaled_payload(picture,ow,oh)? } else { None };
                let (payload,pixel_format,color_matrix,full_range) = if let Some((pixels,matrix,full)) = planar {
                    (pixels,"yuv420p",quoted(matrix),full)
                } else {
                    if ow as u64 * oh as u64 * 4 > 64 * 1024 * 1024 { return Err("output image exceeds protocol budget".into()); }
                    let mut rgba = picture.to_rgba8();
                    if ow != picture.width || oh != picture.height { rgba = resize_rgba(&rgba, picture.width as usize, picture.height as usize, ow as usize, oh as usize)?; }
                    (rgba,"rgba",String::from("null"),false)
                };
                if job.cancel.load(Ordering::Relaxed) { continue; }
                let hw = filmcraft_codecs::hw::hw_stats();
                let stats = filmcraft_codecs::gop_stats() - stats0;
                let header = format!(concat!("{{\"event\":\"frame\",\"id\":{},\"ptsTicks\":{},\"width\":{},\"height\":{},",
                    "\"decodeMs\":{},\"convertMs\":{},\"workerMs\":{},\"cacheBytes\":{},\"hits\":{},\"misses\":{},",
                    "\"seeks\":{},\"decoded\":{},\"hwFrames\":{},\"hwSessions\":{},\"hwFallbacks\":{},\"hwDeclined\":{},\"skippedReadbacks\":{},\"codecMs\":{},",
                    "\"pixelFormat\":\"{}\",\"colorMatrix\":{},\"fullRange\":{}}}"),
                    job.id, filmcraft_codecs::mp4::e44_actual_pts().ok_or("actual cache PTS unavailable")?.0, ow, oh, decode_ms, conversion.elapsed().as_secs_f64()*1000.0,
                    job.sent.elapsed().as_secs_f64()*1000.0, filmcraft_codecs::cached_bytes(), stats.hits, stats.misses,
                    stats.seeks, stats.decoded, hw.frames-hw0.frames, hw.sessions-hw0.sessions, hw.fallbacks-hw0.fallbacks, hw.declined-hw0.declined,
                    0, stats.decode_ns as f64/1e6, pixel_format, color_matrix, full_range);
                emit(header, &payload).map_err(|e| e.to_string())?;
            }
        }
    }
    drop(source);
    emit(format!("{{\"event\":\"closed\",\"cacheBytes\":{},\"liveDecoders\":{}}}", filmcraft_codecs::cached_bytes(), filmcraft_codecs::live_decoders()), &[]).map_err(|e|e.to_string())
}
fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let path = args.next().ok_or("source path required")?;
    let software = match args.next().as_deref() { Some("software") => true, Some("hardware") | None => false, _ => return Err("expected hardware or software".into()) };
    let height = args.next().unwrap_or_else(|| "720".into()).parse::<u32>().map_err(|_|"invalid output height")?;
    if ![720, 1080, 1440, 2160].contains(&height) { return Err("unsupported output height".into()); }
    let cache_bytes = args.next().unwrap_or_else(|| "402653184".into()).parse::<usize>().map_err(|_|"invalid cache bytes")?;
    if !(128*1024*1024..=384*1024*1024).contains(&cache_bytes) { return Err("native cache must be 128 to 384 MiB".into()); }
    let requested = match (args.next(), args.next()) {
        (None, None) => None,
        (Some(w), Some(h)) => { let w=w.parse::<u32>().map_err(|_|"invalid output width")?; let h=h.parse::<u32>().map_err(|_|"invalid output height")?;
            if w == 0 || h == 0 || w.max(h) > 3840 || w.min(h) > 2160 { return Err("invalid explicit output bounds".into()); } Some((w,h)) },
        _ => return Err("output width and height must be supplied together".into())
    };
    let prefer_yuv = match args.next().as_deref() { Some("yuv420p")=>true, Some("rgba")|None=>false, _=>return Err("unsupported output pixel format".into()) };
    if args.next().is_some() { return Err("unexpected command arguments".into()); }
    filmcraft_platform::register();
    filmcraft_codecs::hw::set_hardware_decoding(!software);
    let queue = Arc::new((Mutex::new(Queue::default()), Condvar::new()));
    let thread_queue = queue.clone();
    let handle = std::thread::Builder::new().name("filmcraft-e44-reader".into()).spawn(move || {
        let result = match std::panic::catch_unwind(|| worker(path, height, cache_bytes, requested, prefer_yuv, thread_queue)) {
            Ok(r) => r, Err(_) => Err("upstream worker panicked".into())
        };
        if let Err(error) = &result { let _ = emit(format!("{{\"event\":\"fatal\",\"message\":{}}}", quoted(error)), &[]); }
        result
    }).map_err(|e|e.to_string())?;
    let input = io::stdin(); let mut input = input.lock();
    let input_result: Result<(), String> = (|| {
        let mut last_id = 0;
        loop {
            // Bound the command buffer even for malformed clients.
            let mut line = Vec::new();
            let n = (&mut input).take(4097).read_until(b'\n', &mut line).map_err(|e|e.to_string())?;
            if n == 0 { break; }
            if n > 4096 { return Err("input too long".into()); }
            let text = std::str::from_utf8(&line).map_err(|e|e.to_string())?.trim();
            if text == "close" { break; }
            let fields: Vec<_> = text.split_whitespace().collect();
            if fields.len()!=2 {return Err("expected id ticks".into());}
            if fields[0] == "cancel" {
                let id = fields[1].parse::<u64>().map_err(|e|e.to_string())?;
                if id <= last_id { return Err("invalid cancel id".into()); } last_id = id;
                let mut state = queue.0.lock().unwrap_or_else(PoisonError::into_inner);
                if let Some(active) = &state.active { active.store(true, Ordering::Relaxed); }
                if let Some(old) = state.pending.take() { old.cancel.store(true, Ordering::Relaxed); }
                continue;
            }
            let id = fields[0].parse::<u64>().map_err(|e|e.to_string())?;
            let ticks = fields[1].parse::<i64>().map_err(|e|e.to_string())?;
            if id <= last_id || !(0..Tick::MAX.0).contains(&ticks) { return Err("invalid request".into()); }
            last_id = id;
            let mut state = queue.0.lock().unwrap_or_else(PoisonError::into_inner);
            if let Some(active) = &state.active { active.store(true, Ordering::Relaxed); }
            if let Some(old) = state.pending.take() {old.cancel.store(true, Ordering::Relaxed);}
            state.pending = Some(Job {id, ticks, cancel: Arc::new(AtomicBool::new(false)), sent: Instant::now()});
            queue.1.notify_one();
        }
        Ok(())
    })();
    { let mut state=queue.0.lock().unwrap_or_else(PoisonError::into_inner); state.closed=true;
      if let Some(active)=&state.active {active.store(true, Ordering::Relaxed);} queue.1.notify_one(); }
    let result = handle.join().map_err(|_|"worker join failed".to_string())?;
    input_result.and(result)
}
fn main() {
    if let Err(error) = run() { let _ = emit(format!("{{\"event\":\"fatal\",\"message\":{}}}",quoted(&error)), &[]); std::process::exit(1); }
}
use std::io::Read;

#[cfg(test)]
mod tests {
    use super::{resize_rgba, output_size, yuv420_payload,resize_plane,yuv420_scaled_payload};
    use std::sync::Arc;
    #[test]
    fn downsample_preserves_constant_color_and_alpha() {
        let source = [20, 40, 60, 180].repeat(16);
        assert_eq!(resize_rgba(&source, 4, 4, 2, 2).unwrap(), [20, 40, 60, 180].repeat(4));
    }
    #[test]
    fn downsample_interpolates_all_four_contributors() {
        let source = [0,0,0,255, 100,0,0,255, 200,0,0,255, 100,0,0,255];
        assert_eq!(resize_rgba(&source, 2, 2, 1, 1).unwrap(), vec![100,0,0,255]);
    }
    #[test]
    fn malformed_resize_is_an_error() {
        assert!(resize_rgba(&[], 0, 0, 1, 1).is_err());
        assert!(resize_rgba(&[0; 4], 2, 2, 1, 1).is_err());
        assert!(resize_rgba(&[0; 4], 1, 1, usize::MAX, 2).is_err());
    }
    #[test]
    fn portrait_quality_preserves_the_long_edge() {
        assert_eq!(output_size(2160,3840,(1,1),720,None).unwrap(),(720,1280));
        assert_eq!(output_size(2160,3840,(1,1),720,Some((720,1280))).unwrap(),(720,1280));
    }
    #[test]
    fn explicit_geometry_honors_sar_and_no_display_upscale() {
        assert_eq!(output_size(640,480,(2,1),720,Some((1280,480))).unwrap(),(1280,480));
        assert_eq!(output_size(3840,2160,(1,1),1440,Some((2560,1440))).unwrap(),(2560,1440));
        assert!(output_size(640,480,(1,1),720,Some((1280,960))).is_err());
        assert!(output_size(3840,2160,(1,1),720,Some((1280,800))).is_err());
    }
    fn planar(w:u32,h:u32,y:Vec<u8>,c:Vec<u8>) -> filmcraft_frame::VideoFrame {
        use filmcraft_frame::{PixelData,Chroma,VideoFrame};use std::sync::Arc;
        VideoFrame{width:w,height:h,data:PixelData::Yuv8{planes:[Arc::new(y),Arc::new(c.clone()),Arc::new(c)],chroma:Chroma::C420,alpha:None},color:filmcraft_color::ColorInfo::REC709,par:(1,1),pts:filmcraft_time::Tick::ZERO}
    }
    #[test]
    fn planar_odd_dimensions_have_exact_ceil_chroma_lengths() {
        let frame=planar(3,3,vec![16;9],vec![128;4]);let (p,m,f)=yuv420_payload(&frame).unwrap().unwrap();
        assert_eq!(p.len(),17);assert_eq!(&p[..9],&[16;9]);assert_eq!(&p[9..],&[128;8]);assert_eq!(m,"bt709");assert!(!f);
    }
    #[test]
    fn planar_preserves_black_white_codes_and_explicit_range() {
        let mut frame=planar(2,2,vec![16,235,16,235],vec![128]);let (p,_,full)=yuv420_payload(&frame).unwrap().unwrap();
        assert_eq!(p,vec![16,235,16,235,128,128]);assert!(!full);
        frame.color.range=filmcraft_color::Range::Full;frame.color.matrix=filmcraft_color::Matrix::Bt601;
        frame.data=filmcraft_frame::PixelData::Yuv8{planes:[Arc::new(vec![0,255,0,255]),Arc::new(vec![128]),Arc::new(vec![128])],chroma:filmcraft_frame::Chroma::C420,alpha:None};
        let (p,m,full)=yuv420_payload(&frame).unwrap().unwrap();assert_eq!(&p[..4],&[0,255,0,255]);assert_eq!(m,"bt601");assert!(full);
    }
    #[test]
    fn planar_unsupported_matrix_falls_back_and_bad_planes_are_errors() {
        let mut frame=planar(2,2,vec![16;4],vec![128]);frame.color.matrix=filmcraft_color::Matrix::Bt2020Ncl;
        assert!(yuv420_payload(&frame).unwrap().is_none());
        assert!(yuv420_payload(&planar(3,3,vec![16;8],vec![128;4])).is_err());
    }
    #[test]
    fn scaled_planar_preserves_neutral_black_and_odd_geometry(){
        let f=planar(8,6,vec![16;48],vec![128;12]);let(p,m,full)=yuv420_scaled_payload(&f,5,3).unwrap().unwrap();
        assert_eq!(p.len(),27);assert_eq!(&p[..15],&[16;15]);assert_eq!(&p[15..],&[128;12]);assert_eq!(m,"bt709");assert!(!full);
        assert_eq!(resize_plane(&[0,100,200,100],2,2,1,1).unwrap(),vec![100]);
        assert!(resize_plane(&[0],0,1,2,2).is_err());
    }
    #[test]
    fn planar_resampler_matches_float_bilinear_within_one_code(){
        let values:Vec<u8>=(0..48).map(|n|((n*37)%256) as u8).collect();let rgba:Vec<u8>=values.iter().flat_map(|v|[*v,*v,*v,255]).collect();
        let p=resize_plane(&values,8,6,5,3).unwrap();let r=resize_rgba(&rgba,8,6,5,3).unwrap();
        for (n,v) in p.iter().enumerate(){assert!((*v as i32-r[n*4] as i32).abs()<=1);}
    }

}
