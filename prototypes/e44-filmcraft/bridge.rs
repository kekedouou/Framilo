//! E44 test adapter. FilmCraft decoder/selection unchanged; cache PTS audit hook only.
//! Compiled as an extra example of filmcraft-platform; no production plugin dependency.
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
fn worker(path: String, windowed: bool, queue: Arc<(Mutex<Queue>, Condvar)>) -> Result<(), String> {
    filmcraft_codecs::mp4::e44_set_window(windowed);
    let begin = Instant::now();
    let reader = Arc::new(FileReader::open(std::path::Path::new(&path)).map_err(|e| e.to_string())?);
    let source = open_reader_within(&path, reader, &filmcraft_codecs::reader_openers(), &filmcraft_codecs::openers(), 0)
        .map_err(|e| e.to_string())?;
    emit(format!("{{\"event\":\"ready\",\"openMs\":{},\"durationTicks\":{},\"cacheCeilingBytes\":402653184}}", begin.elapsed().as_secs_f64()*1000.0, source.info().duration.0), &[]).map_err(|e| e.to_string())?;
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
        let skipped0 = filmcraft_platform::media_foundation::e44_skipped_readbacks();
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
                let conversion = Instant::now();
                let reduction = (frame.height / 720).max(1) as usize;
                let small = frame.box_decimated(reduction);
                let picture = small.as_ref().unwrap_or(&frame);
                let rgba = picture.to_rgba8();
                if job.cancel.load(Ordering::Relaxed) { continue; }
                let hw = filmcraft_codecs::hw::hw_stats();
                let stats = filmcraft_codecs::gop_stats() - stats0;
                let header = format!(concat!("{{\"event\":\"frame\",\"id\":{},\"ptsTicks\":{},\"width\":{},\"height\":{},",
                    "\"decodeMs\":{},\"convertMs\":{},\"workerMs\":{},\"cacheBytes\":{},\"hits\":{},\"misses\":{},",
                    "\"seeks\":{},\"decoded\":{},\"hwFrames\":{},\"hwSessions\":{},\"hwFallbacks\":{},\"hwDeclined\":{},\"skippedReadbacks\":{},\"codecMs\":{}}}"),
                    job.id, filmcraft_codecs::mp4::e44_actual_pts().ok_or("actual cache PTS unavailable")?.0, picture.width, picture.height, decode_ms, conversion.elapsed().as_secs_f64()*1000.0,
                    job.sent.elapsed().as_secs_f64()*1000.0, filmcraft_codecs::cached_bytes(), stats.hits, stats.misses,
                    stats.seeks, stats.decoded, hw.frames-hw0.frames, hw.sessions-hw0.sessions, hw.fallbacks-hw0.fallbacks, hw.declined-hw0.declined,
                    filmcraft_platform::media_foundation::e44_skipped_readbacks()-skipped0, stats.decode_ns as f64/1e6);
                emit(header, &rgba).map_err(|e| e.to_string())?;
            }
        }
    }
    drop(source);
    emit(format!("{{\"event\":\"closed\",\"cacheBytes\":{},\"liveDecoders\":{}}}", filmcraft_codecs::cached_bytes(), filmcraft_codecs::live_decoders()), &[]).map_err(|e|e.to_string())
}
fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let path = args.next().ok_or("source path required")?;
    let software = args.next().as_deref() == Some("software");
    let windowed = args.next().as_deref() == Some("target-readback");
    filmcraft_platform::register();
    filmcraft_codecs::hw::set_hardware_decoding(!software);
    let queue = Arc::new((Mutex::new(Queue::default()), Condvar::new()));
    let thread_queue = queue.clone();
    let handle = std::thread::Builder::new().name("filmcraft-e44-reader".into()).spawn(move || {
        let result = match std::panic::catch_unwind(|| worker(path, windowed, thread_queue)) {
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
