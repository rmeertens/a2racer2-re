#!/usr/bin/env node
// Static file server for the game with byte ranges and the right types, and the lobby for
// network races on /lobby (tools/lobby.mjs).
//   node tools/serve.mjs [--dist] [--lan]  (PORT, default 4180; --lan or HOST=0.0.0.0 for other machines)
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { attachLobby } from './lobby.mjs';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dist = process.argv.includes('--dist');
const roots = dist ? [join(ROOT, 'dist')] : [join(ROOT, 'public')];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.map': 'application/json', '.ico': 'image/x-icon',
};

function resolve(url) {
  const path = decodeURIComponent(new URL(url, 'http://x').pathname);
  for (const root of roots) {
    const full = normalize(join(root, path));
    if (!full.startsWith(root + sep) && full !== root) continue;
    if (existsSync(full) && statSync(full).isDirectory()) {
      const index = join(full, 'index.html');
      if (existsSync(index)) return index;
      continue;
    }
    if (existsSync(full)) return full;
  }
  return null;
}

const server = createServer((req, res) => {
  const file = resolve(req.url);
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  const size = statSync(file).size;
  const headers = {
    'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
});
attachLobby(server, { path: '/lobby' });
const port = Number(process.env.PORT || 4180);
const host = process.env.HOST || (process.argv.includes('--lan') ? '0.0.0.0' : '127.0.0.1');
server.listen(port, host, () => {
  const p = server.address().port;
  console.log(`http://127.0.0.1:${p}/`);
  if (host === '0.0.0.0') {
    // Other players on the network open one of these. Browsers allow gamepads only on https or localhost.
    for (const list of Object.values(networkInterfaces())) {
      for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`http://${a.address}:${p}/`);
    }
  }
});
