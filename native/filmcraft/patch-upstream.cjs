'use strict';
// The two integration patches retain FilmCraft's demux/decoder/frame selection behavior.
// Runtime never reads this developer-only file or upstream source checkout.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../../verification-runs/e44');
const upstream=process.argv[2]||path.join(root,'filmcraft-source/filmcraft-176e6a9c585fd29e4b18d691663fe88a936c5b37');
const backupDir=path.join(root,'filmcraft-test');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const expected={
 'crates/codecs/src/mkv.rs':'807b2e89c534a71e7855923cb94df62ff3d252f42c79b71526c28ea0b7814286',
 'crates/codecs/src/gop.rs':'fdb53061261a7e5b7bd9cd6f8076f6db1e0ee3ca8bcde66ba012ae454b48f49d',
 'crates/codecs/src/mp4.rs':'88ffe768bfa8769fafc85fa6afb039829f7e63f3a74943cc809e2750934b9430',
 'crates/platform/src/media_foundation.rs':'bea74ec7a7c15a41eb8be78be7ab5d21d1ede5bff6f80562c16d642b7363ede3'
};
const changes=[
 ['crates/codecs/src/mkv.rs','        let origin = media_origin(&file, vtrack, &atracks);\n        rebase(&mut file, origin);',
 `        // Preserve external source timestamps, including nonzero starts.
        let origin = 0;`],
 ['crates/codecs/src/mkv.rs','        Ok(self.video.frame_late(&MkvVideo { src: self, track: ti }, target, late)?)',
 `        E52_ACTUAL_PTS.set(None);
        let result = self.video.frame_late(&MkvVideo { src: self, track: ti }, target, late)?;
        E52_ACTUAL_PTS.set(self.video.e44_cached_pts(&result).map(|pts| to_tick(&self.file.tracks[ti], pts)));
        Ok(result)`],
 ['crates/codecs/src/gop.rs','    pub fn frame(&self, s: &dyn VideoSamples, target: i64)',
 `    /// Eagle bridge: recover the returned Arc's actual decoded timestamp.
    pub fn e44_cached_pts(&self, frame: &Arc<VideoFrame>) -> Option<i64> {
        let st = self.shared.state.lock().unwrap_or_else(PoisonError::into_inner);
        st.frames.iter().find_map(|(&pts, value)| Arc::ptr_eq(value, frame).then_some(pts))
    }
    pub fn frame(&self, s: &dyn VideoSamples, target: i64)`],
 ['crates/codecs/src/gop.rs','budget: FRAME_CACHE_CEILING','budget: e44_budget()'],
 ['crates/codecs/src/gop.rs',
 `        let reserve = MIN_FRAMES.saturating_mul(frame_bytes).min(FRAME_CACHE_CEILING);
        self.budget.min(FRAME_CACHE_CEILING).max(reserve)`,
 `        let _ = frame_bytes; // The bridge reserves two conservative source frames at open.
        self.budget.min(FRAME_CACHE_CEILING)`],
 ['crates/codecs/src/mp4.rs','    fn video_at(&self, t: Tick) -> crate::Result<Arc<VideoFrame>> {',
 `    fn video_at(&self, t: Tick) -> crate::Result<Arc<VideoFrame>> {
        E44_ACTUAL_PTS.set(None);`],
 ['crates/codecs/src/mp4.rs','        snap_to_frame_grid(&mut file, vtrack);\n        rebase_unedited_video(&mut file, vtrack, &mut audios);',
 `        // Eagle exact-source mode: the ffprobe source PTS is the identity used by annotations.
        // Keep original sample timing and edit_offset, including VFR jitter and nonzero starts.
        // Editor-grid snapping/rebasing must not silently change that external identity.`],
 ['crates/codecs/src/mp4.rs','        self.video.frame_late(&Mp4Video { src: self, track: ti }, t.to_rational_round(1, ts), late)',
 `        let result = self.video.frame_late(&Mp4Video { src: self, track: ti }, t.to_rational_round(1, ts), late);
        if let Ok(frame) = &result {
            E44_ACTUAL_PTS.set(self.video.e44_cached_pts(frame).map(|pts| Tick::from_rational(pts.saturating_add(self.file.tracks[ti].edit_offset), 1, ts)));
        }
        result`]
];
const receipts=[];
for(const [file,wanted] of Object.entries(expected)){
 const filename=path.join(upstream,file),backup=path.join(backupDir,path.basename(file)+'.original');
 let original=fs.readFileSync(fs.existsSync(backup)?backup:filename);
 if(hash(original)!==wanted)throw Error('Original source identity mismatch: '+file);
 if(!fs.existsSync(backup))fs.writeFileSync(backup,original);
 let text=original.toString().replace(/\r\n/g,'\n');
 for(const [name,before,after] of changes.filter(x=>x[0]===file)){
  if(text.split(before).length!==2)throw Error('Unexpected upstream source: '+name);
  text=text.replace(before,after);
 }
 if(file.endsWith('gop.rs'))text+=`
// Eagle bridge budget. Set once before opening the one source owned by this process.
static E44_CACHE_BUDGET: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(FRAME_CACHE_CEILING);
pub fn e44_set_budget(bytes: usize) { E44_CACHE_BUDGET.store(bytes.clamp(128 << 20, FRAME_CACHE_CEILING), Ordering::Relaxed); }
fn e44_budget() -> usize { E44_CACHE_BUDGET.load(Ordering::Relaxed) }
`;
 if(file.endsWith('mp4.rs'))text+=`
// Returned timestamp is actual decoded/cache identity, adjusted by the container edit list.
thread_local! { static E44_ACTUAL_PTS: std::cell::Cell<Option<Tick>> = const { std::cell::Cell::new(None) }; }
pub fn e44_actual_pts() -> Option<Tick> { E44_ACTUAL_PTS.get() }
`;
 if(file.endsWith('mkv.rs'))text+=`
// Actual returned cache identity; never substitute the requested timestamp.
thread_local! { static E52_ACTUAL_PTS: std::cell::Cell<Option<Tick>> = const { std::cell::Cell::new(None) }; }
pub fn e52_actual_pts() -> Option<Tick> { E52_ACTUAL_PTS.get() }
`;
 if(fs.readFileSync(filename,'utf8')!==text)fs.writeFileSync(filename,text);
 receipts.push({file,originalHash:wanted,patchedHash:hash(text),modified:file.includes('/codecs/')});
}
fs.writeFileSync(path.join(backupDir,'native-patch-'+Date.now()+'.json'),JSON.stringify({upstream:'176e6a9c585fd29e4b18d691663fe88a936c5b37',purpose:'Actual cache PTS, explicit GOP byte ceiling, original sample/edit-list preservation; experimental readback patch restored to upstream',files:receipts},null,2));
