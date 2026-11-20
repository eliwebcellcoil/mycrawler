import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Crawler } from '../crawler.js';

const pages = {
  '/': ['text/html', '<html><head><link rel="stylesheet" href="/s/style.css" integrity="x"><base href="/"></head><body><a href="about">A</a> <a href="/blog/?p=1">B</a> <a href="http://other.invalid/x">ext</a><img src="img/a.png" srcset="img/a.png 1x, img/b.png 2x"><div style="background:url(img/b.png)"></div></body></html>'],
  '/about': ['text/html', '<a href="/">home</a><a href="/blog/?p=1#top">blog</a><script src="/app.js"></script>'],
  '/blog/': ['text/html', '<a href="../about">about</a>'],
  '/s/style.css': ['text/css', '@import "more.css"; body{background:url(../img/a.png)}'],
  '/s/more.css': ['text/css', 'p{color:red}'],
  '/img/a.png': ['image/png', 'PNG-A'], '/img/b.png': ['image/png', 'PNG-B'],
  '/app.js': ['text/javascript', 'console.log(1)'],
};
const srv = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x'); const p = pages[u.pathname];
  if (!p) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'content-type': p[0] }); s.end(p[1]);
}).listen(0);
await new Promise((r) => srv.once('listening', r));
const port = srv.address().port;
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-'));
const c = new Crawler({ url: `http://127.0.0.1:${port}/` }, out);
const r = await c.run();
srv.close();
const rd = (f) => fs.readFileSync(path.join(out, f), 'utf8');
console.log(r.stats, r.failures);
assert.equal(r.stats.pages, 3);
assert.ok(fs.existsSync(path.join(out, 'index.html')));
assert.ok(fs.existsSync(path.join(out, 'about/index.html')));
assert.ok(fs.existsSync(path.join(out, 's/more.css')));
const idx = rd('index.html');
assert.ok(!/integrity|<base/.test(idx));
assert.ok(idx.includes('href="about/index.html"'), idx);
assert.ok(idx.includes('src="img/a.png"'));
assert.ok(idx.includes('http://other.invalid/x'));
assert.ok(rd('about/index.html').includes('href="../index.html"'));
assert.ok(rd('about/index.html').includes('#top'));
assert.ok(rd('s/style.css').includes('url("../img/a.png")'));
assert.ok(rd('s/style.css').includes('@import "more.css"'));
console.log('OK');
