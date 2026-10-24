'use strict';
// Local, dependency-free preview. This is intentionally confined to this prototype.
const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.resolve(__dirname);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.md': 'text/plain; charset=utf-8' };

function findFile(raw) {
  let decoded;
  try { decoded = decodeURIComponent((raw || '/').split('?')[0]); } catch (_) { return { status: 400 }; }
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0')) return { status: 400 };
  const pieces = decoded.split('/').filter(Boolean);
  if (pieces.some(name => name === '..' || name === '.' || name.includes(':'))) return { status: 403 };
  if (!pieces.length) pieces.push('index.html');
  let target = root;
  try {
    for (let i = 0; i < pieces.length; i++) {
      target = path.join(target, pieces[i]);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) return { status: 403 };
      if (i < pieces.length - 1 && !stat.isDirectory()) return { status: 404 };
      if (i === pieces.length - 1 && !stat.isFile()) return { status: 404 };
    }
    const real = fs.realpathSync(target), relative = path.relative(root, real);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) return { status: 403 };
    return { status: 200, target: real };
  } catch (error) { return { status: ['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 403 }; }
}

function createServer({ port = 0 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('Port must be an integer from 0 to 65535.');
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    // Do not treat non-local host headers as a public service (including DNS rebinding).
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(req.headers.host || '')) { res.writeHead(403).end(); return; }
    const found = findFile(req.url);
    if (found.status !== 200) { res.writeHead(found.status).end(); return; }
    try {
      const body = fs.readFileSync(found.target);
      res.writeHead(200, { 'Content-Type': mime[path.extname(found.target).toLowerCase()] || 'application/octet-stream', 'Content-Length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (_) { res.writeHead(404).end(); }
  });
  server.ready = new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(server)); });
  return server;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const valid = !args.length || args.length === 2 && args[0] === '--port' && /^\d+$/.test(args[1]);
  if (!valid) { console.error('Usage: node prototypes/video-first/server.cjs [--port 43719]'); process.exitCode = 1; }
  else {
    const server = createServer({ port: args.length ? Number(args[1]) : 43719 });
    server.ready.then(() => console.log('UI-01 preview: http://127.0.0.1:' + server.address().port + '/lab.html')).catch(error => { console.error(error.message); process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
  }
}

module.exports = { createServer };
