'use strict';
// Cache PTS instrumentation plus opt-in readback window; original files retained and hashed.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../../verification-runs/e44');
const upstream=path.join(root,'filmcraft-source/filmcraft-176e6a9c585fd29e4b18d691663fe88a936c5b37');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const changes=[
 ['crates/codecs/src/gop.rs','    pub fn frame(&self, s: &dyn VideoSamples, target: i64)',
 `    /// E44 audit: identify the returned Arc by identity, without altering frame selection.
    pub fn e44_cached_pts(&self, frame: &Arc<VideoFrame>) -> Option<i64> {
        let st = self.shared.state.lock().unwrap_or_else(PoisonError::into_inner);
        st.frames.iter().find_map(|(&pts, value)| Arc::ptr_eq(value, frame).then_some(pts))
    }

    pub fn frame(&self, s: &dyn VideoSamples, target: i64)`],
 ['crates/codecs/src/gop.rs','    let job = move || ctx.run(f);',
 `    let readback_min = crate::mp4::e44_readback_min();
    let job = move || ctx.run(|| crate::mp4::e44_with_readback_min(readback_min, f));`],
 ['crates/codecs/src/mp4.rs','    fn video_at(&self, t: Tick) -> crate::Result<Arc<VideoFrame>> {',
 `    fn video_at(&self, t: Tick) -> crate::Result<Arc<VideoFrame>> {
        E44_ACTUAL_PTS.set(None);`],
 ['crates/codecs/src/mp4.rs','        self.video.frame_late(&Mp4Video { src: self, track: ti }, t.to_rational_round(1, ts), late)',
 `        E44_READBACK_MIN.set(E44_WINDOW_ENABLED.get().then(|| t.to_rational_round(1, ts).saturating_sub(self.file.tracks[ti].edit_offset).saturating_sub(ts / 2)));
        let result = self.video.frame_late(&Mp4Video { src: self, track: ti }, t.to_rational_round(1, ts), late);
        E44_READBACK_MIN.set(None);
        if let Ok(frame) = &result {
            E44_ACTUAL_PTS.set(self.video.e44_cached_pts(frame).map(|pts| Tick::from_rational(pts.saturating_add(self.file.tracks[ti].edit_offset), 1, ts)));
        }
        result`],
 ['crates/platform/src/media_foundation.rs','                    let geometry = self.geometry;',
 `                    let pts = self.take_pts(t);
                    if filmcraft_codecs::mp4::e44_readback_min().is_some_and(|min| pts < min) {
                        E44_SKIPPED_READBACKS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        continue;
                    }
                    let geometry = self.geometry;`],
 ['crates/platform/src/media_foundation.rs','                    let pts = self.take_pts(t);\n                    out.push(DecodedFrame { pts, frame, draft: false });',
 '                    out.push(DecodedFrame { pts, frame, draft: false });']
];
const files=[...new Set(changes.map(x=>x[0]))],receipt=[];
for(const file of files){
 const filename=path.join(upstream,file),backup=path.join(root,'filmcraft-test',path.basename(file)+'.original');
 if(!fs.existsSync(backup))fs.copyFileSync(filename,backup);
 const original=fs.readFileSync(backup);let text=original.toString().replace(/\r\n/g,'\n');
 for(const [name,before,after] of changes.filter(x=>x[0]===file)){
  if(text.split(before).length!==2)throw Error('Unexpected upstream source: '+name);
  text=text.replace(before,after);
 }
 if(file.endsWith('mp4.rs'))text+=`
// E44 isolated adapter hooks. Actual PTS comes from cache identity, not the request.
thread_local! {
 static E44_ACTUAL_PTS: std::cell::Cell<Option<Tick>> = const { std::cell::Cell::new(None) };
 static E44_WINDOW_ENABLED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
 static E44_READBACK_MIN: std::cell::Cell<Option<i64>> = const { std::cell::Cell::new(None) };
}
pub fn e44_actual_pts() -> Option<Tick> { E44_ACTUAL_PTS.get() }
pub fn e44_set_window(on: bool) { E44_WINDOW_ENABLED.set(on); }
pub fn e44_readback_min() -> Option<i64> { E44_READBACK_MIN.get() }
pub fn e44_with_readback_min<T>(min: Option<i64>, f: impl FnOnce() -> T) -> T {
 struct Restore(Option<i64>);
 impl Drop for Restore { fn drop(&mut self) { E44_READBACK_MIN.set(self.0); } }
 let _restore = Restore(E44_READBACK_MIN.replace(min));
 f()
}
`;
 if(file.endsWith('media_foundation.rs'))text+=`
// E44 test-only count: dependent frames decoded on GPU but not copied to CPU.
static E44_SKIPPED_READBACKS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
pub fn e44_skipped_readbacks() -> u64 { E44_SKIPPED_READBACKS.load(std::sync::atomic::Ordering::Relaxed) }
`;
 if(fs.readFileSync(filename,'utf8')!==text)fs.writeFileSync(filename,text);
 receipt.push({file,originalHash:hash(original),patchedHash:hash(text)});
}
fs.writeFileSync(path.join(root,'filmcraft-test/audit-patch.json'),JSON.stringify({purpose:'Actual returned cache PTS and opt-in half-second readback window; GPU dependencies still decoded',files:receipt},null,2));
