import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Crawler } from './crawler.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const MIRRORS = process.env.MIRRORS_DIR || path.join(__dir, 'mirrors');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.pdf': 'application/pdf',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
};

const jobs = new Map(); // id -> { meta, crawler, clients:Set }

async function loadJobs() {
  await fs.mkdir(MIRRORS, { recursive: true });
  for (const id of await fs.readdir(MIRRORS)) {
    try {
      const meta = JSON.parse(await fs.readFile(path.join(MIRRORS, id, 'job.json'), 'utf8'));
      jobs.set(id, { meta, clients: new Set() });
    } catch {}
  }
}

const publicMeta = (m) => m;
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((ok, no) => {
  let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
  req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { no(e); } });
});
const broadcast = (job, ev, data) => {
  for (const c of job.clients) c.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
};
const saveMeta = (id, meta) => fs.writeFile(path.join(MIRRORS, id, 'job.json'), JSON.stringify(meta, null, 1));

async function startJob(body) {
  let u;
  try { u = new URL(body.url); } catch { throw new Error('כתובת לא תקינה'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('נתמכים רק http ו-https');
  const num = (v, d, min, max) => Math.min(max, Math.max(min, Number(v) || d));
  const opts = {
    url: u.href,
    maxPages: num(body.maxPages, 500, 1, 20000),
    maxDepth: num(body.maxDepth, 10, 0, 50),
    concurrency: num(body.concurrency, 6, 1, 20),
    delayMs: num(body.delayMs, 0, 0, 10000),
    includeSubdomains: !!body.includeSubdomains,
    externalAssets: body.externalAssets !== false,
    respectRobots: body.respectRobots !== false,
  };
  const id = crypto.randomBytes(6).toString('hex');
  const dir = path.join(MIRRORS, id);
  await fs.mkdir(dir, { recursive: true });
  const meta = { id, url: u.href, host: u.hostname, status: 'running', startedAt: new Date().toISOString(), options: opts, stats: {} };
  const job = { meta, clients: new Set() };
  jobs.set(id, job);
  await saveMeta(id, meta);
  const crawler = new Crawler(opts, path.join(dir, 'content'));
  job.crawler = crawler;
  crawler.on('progress', (s) => { meta.stats = s; broadcast(job, 'progress', s); });
  crawler.on('log', (m) => broadcast(job, 'log', m));
  crawler.run().then(async (r) => {
    meta.status = r.cancelled ? 'cancelled' : 'done';
    meta.entry = r.entry; meta.stats = r.stats; meta.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify({ failures: r.failures, map: r.map }, null, 1));
  }).catch((e) => { meta.status = 'error'; meta.error = e.message; })
    .finally(async () => { await saveMeta(id, meta); broadcast(job, 'done', meta); delete job.crawler; });
  return meta;
}

async function serveMirror(req, res, id, rest) {
  const root = path.join(MIRRORS, id, 'content');
  let rel = decodeURIComponent(rest || '');
  let file = path.normalize(path.join(root, rel));
  if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
  try {
    let st = await fs.stat(file);
    if (st.isDirectory()) { file = path.join(file, 'index.html'); st = await fs.stat(file); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size });
    createReadStream(file).pipe(res);
  } catch { send(res, 404, 'not found', 'text/plain'); }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    let m;
    if (req.method === 'GET' && p === '/') return send(res, 200, await fs.readFile(path.join(__dir, 'public', 'index.html')), 'text/html; charset=utf-8');
    if (req.method === 'GET' && p === '/api/jobs') return send(res, 200, [...jobs.values()].map((j) => publicMeta(j.meta)).sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
    if (req.method === 'POST' && p === '/api/jobs') {
      try { return send(res, 200, await startJob(await readBody(req))); }
      catch (e) { return send(res, 400, { error: e.message }); }
    }
    if ((m = p.match(/^\/api\/jobs\/(\w+)\/events$/)) && req.method === 'GET') {
      const job = jobs.get(m[1]); if (!job) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`event: progress\ndata: ${JSON.stringify(job.meta.stats || {})}\n\n`);
      if (job.meta.status !== 'running') res.write(`event: done\ndata: ${JSON.stringify(job.meta)}\n\n`);
      job.clients.add(res); req.on('close', () => job.clients.delete(res)); return;
    }
    if ((m = p.match(/^\/api\/jobs\/(\w+)\/cancel$/)) && req.method === 'POST') {
      jobs.get(m[1])?.crawler?.cancel(); return send(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/mirrors\/(\w+)\/?(.*)$/)) && req.method === 'GET' && jobs.has(m[1])) return serveMirror(req, res, m[1], m[2]);
    send(res, 404, 'not found', 'text/plain');
  } catch (e) { send(res, 500, { error: e.message }); }
});

await loadJobs();
server.listen(PORT, HOST, () => console.log(`Site Mirror: http://${HOST}:${PORT}`));
export { server };
