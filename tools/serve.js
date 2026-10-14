#!/usr/bin/env node
/* Tartarus Simulator: a local copy of the site, for testing changes before
 * they're pushed. Serves this folder with caching off. With --live, each
 * page reloads itself when a site file changes. localhost counts as a secure
 * site, so features that need one (reading the game log, sharing a window)
 * work here. sandbox/ is served too: a gitignored folder for test files.
 *
 *   node tools/serve.js [--port 8080] [--live]
 *   then open http://localhost:8080/  (or /analyze.html?auto=1)
 *
 * In VS Code, Run and Debug > "Local site" (F5) starts it with --live, and
 * restarts it when this file changes. */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
};
const PORT = Number(arg('port')) || 8080;
const LIVE = process.argv.includes('--live');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};
// Folders the site doesn't serve, so a local copy doesn't either.
const PRIVATE = ['.git', '.vscode', 'node_modules', 'trainingdata', 'local', 'worker', '.wrangler'];

// --live: pages listen here, and reload when a served file changes.
const listeners = new Set();
const RELOAD = '<script>(function(){var s=new EventSource("/__live");s.onmessage=function(){location.reload();};})();</script>';

function serve(req, res) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (LIVE && rel === '/__live') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': listening\n\n');
    listeners.add(res);
    req.on('close', () => listeners.delete(res));
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, path.normalize(rel));
  const top = path.relative(ROOT, file).split(path.sep)[0];
  if (!file.startsWith(ROOT + path.sep) || PRIVATE.includes(top)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    let body = data;
    if (LIVE && ext === '.html') {
      const html = data.toString('utf8');
      body = html.includes('</body>') ? html.replace('</body>', `${RELOAD}</body>`) : html + RELOAD;
    }
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  });
}

if (LIVE) {
  let timer = 0;
  fs.watch(ROOT, { recursive: true }, (event, name) => {
    if (!name) return;
    const top = name.split(/[\\/]/)[0];
    if (PRIVATE.includes(top) || /\.(swp|tmp)$|~$/.test(name)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const res of listeners) res.write('data: reload\n\n');
      if (listeners.size) console.log(`${new Date().toLocaleTimeString()}  ${name} changed: reloaded ${listeners.size} page${listeners.size === 1 ? '' : 's'}`);
    }, 150);
  });
}

http.createServer(serve)
  .on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is busy. Is the local site already running? Stop it, or use --port ${PORT + 1}.`);
    else console.error(e.message);
    process.exit(1);
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`The site from ${ROOT}${LIVE ? ', reloading pages when files change' : ''}`);
    console.log(`  http://localhost:${PORT}/`);
    console.log(`  http://localhost:${PORT}/analyze.html?auto=1   (the analyzer with auto mode)`);
    console.log(`  http://localhost:${PORT}/sandbox/   (your test files)`);
    console.log('Stop: Ctrl+C, or the stop button in VS Code.');
  });
