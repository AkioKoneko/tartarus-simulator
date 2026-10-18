'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const PREFIX = '/tartarus-simulator/';
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.png':'image/png', '.webp':'image/webp', '.svg':'image/svg+xml', '.md':'text/plain; charset=utf-8' };

function resolvePublic(root, requestUrl) {
  const url = new URL(requestUrl);
  if (url.origin !== 'https://blahdot3h.github.io' || !url.pathname.startsWith(PREFIX)) return null;
  let rel;
  try { rel = decodeURIComponent(url.pathname.slice(PREFIX.length)) || 'index.html'; } catch { return false; }
  if (!/^(?:[\w-]+\.html|js\/[\w-]+\.js|css\/[\w-]+\.css|img\/[\w./-]+|desktop\/(?:main|preload)\.js|desktop\/lib\/[\w.-]+)$/.test(rel)) return false;
  const file = path.resolve(root, rel);
  const within = path.relative(root, file);
  return within && !within.startsWith('..') && !path.isAbsolute(within) ? file : false;
}

function install(ses, net, root) {
  ses.protocol.handle('https', async (request) => {
    const file = resolvePublic(root, request.url);
    if (file === null) return net.fetch(request, { bypassCustomProtocolHandlers:true });
    if (!file || !['GET','HEAD'].includes(request.method)) return new Response('Not found', {status:404});
    try {
      const bytes = await fs.readFile(file);
      return new Response(request.method === 'HEAD' ? null : bytes, {headers:{'Content-Type':TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store', 'X-Tartarus-Local':'second-run-8'}});
    } catch { return new Response('Not found', {status:404}); }
  });
}
module.exports = { install, resolvePublic };
