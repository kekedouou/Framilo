/* Browser DedicatedWorker, not Node worker_threads (unsupported by Eagle V8). */
importScripts('direct.js');
let reader = null, readSerial = 0, closing = false, currentId = null;
const reads = new Map();
self.onmessage = async ({ data: m }) => {
  if (m.type === 'bytes') { const r = reads.get(m.id); if (r) { reads.delete(m.id); m.error ? r.reject(Error(m.error)) : r.resolve(new Uint8Array(m.bytes)); } return; }
  try {
    if (m.type === 'open') {
      reader = await E44Direct.create({ index: m.index, hardware: m.hardware, ramBytes: m.ramBytes,
        read: (a, b) => new Promise((resolve, reject) => { const id = ++readSerial; reads.set(id, { resolve, reject }); postMessage({ type: 'read', id, a, b }); }),
        blank() {},
        draw(picture, pts) {
          const id = currentId;
          createImageBitmap(picture).then(bitmap => { if (closing) bitmap.close(); else postMessage({ type: 'picture', id, pts, bitmap }, [bitmap]); }).catch(error => postMessage({ type: 'picture-error', id, error: error.message }));
        }
      });
      postMessage({ type: 'opened', snapshot: reader.snapshot() });
    } else if (m.type === 'seek') {
      currentId = m.id; const result = await reader.seek(m.seconds);
      postMessage({ type: 'result', id: m.id, result, snapshot: reader.snapshot() });
    } else if (m.type === 'close') {
      closing = true; const result = reader?.close(); for (const r of reads.values()) r.reject(Error('Closed')); reads.clear();
      postMessage({ type: 'closed', result, snapshot: reader?.snapshot() }); self.close();
    }
  } catch (error) { postMessage({ type: 'fatal', error: String(error.stack || error) }); }
};
