import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { localPathFor, isHtmlType } from './paths.js';
import { transformHtml, transformCss, findBase } from './rewrite.js';

const UA = 'Mozilla/5.0 (compatible; SiteMirror/1.0)';
const norm = (u) => { const x = new URL(u); x.hash = ''; return x.href; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

export class Crawler extends EventEmitter {
  constructor(opts, outDir) {
    super();
    this.o = {
      maxPages: 500, maxDepth: 10, concurrency: 6, delayMs: 0, includeSubdomains: false,
      externalAssets: true, respectRobots: true, maxFileMB: 50, timeoutMs: 30000, ...opts,
    };
    this.out = outDir;
    this.start = new URL(this.o.url);
    this.rootHost = this.start.hostname;
    this.queue = [];
    this.seen = new Set();
    this.map = new Map();       // normalized url -> local rel path
    this.used = new Map();      // local path -> url
    this.texts = [];            // {url, local, type}
    this.failures = [];
    this.stats = { pages: 0, assets: 0, failed: 0, bytes: 0, queued: 0, current: '' };
    this.pagesQueued = 0;
    this.cancelled = false;
    this.disallow = [];
    this.active = 0;
  }

  log(msg) { this.emit('log', msg); }
  progress() { this.stats.queued = this.queue.length; this.emit('progress', { ...this.stats }); }
  cancel() { this.cancelled = true; }

  inScope(u) {
    const h = u.hostname.replace(/^www\./, '');
    const r = this.rootHost.replace(/^www\./, '');
    return h === r || (this.o.includeSubdomains && h.endsWith('.' + r));
  }

  allowedByRobots(u) {
    return !this.o.respectRobots || !this.disallow.some((d) => u.pathname.startsWith(d));
  }

  enqueue(urlStr, depth, kind) {
    let u;
    try { u = new URL(urlStr); } catch { return; }
    if (!/^https?:$/.test(u.protocol)) return;
    const key = norm(u.href);
    if (this.seen.has(key)) return;
    const scoped = this.inScope(u);
    if (kind === 'page') {
      if (!scoped || depth > this.o.maxDepth || this.pagesQueued >= this.o.maxPages || !this.allowedByRobots(u)) return;
      this.pagesQueued++;
    } else if (!scoped && !this.o.externalAssets) return;
    this.seen.add(key);
    this.queue.push({ url: key, depth, kind });
  }

  async loadRobots() {
    if (!this.o.respectRobots) return;
    try {
      const res = await fetch(new URL('/robots.txt', this.start), { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) return;
      let star = false;
      for (const line of (await res.text()).split(/\r?\n/)) {
        const [k, ...v] = line.split('#')[0].split(':');
        const key = k.trim().toLowerCase(), val = v.join(':').trim();
        if (key === 'user-agent') star = val === '*';
        else if (star && key === 'disallow' && val) this.disallow.push(val);
      }
      this.log(`robots.txt: ${this.disallow.length} כללי Disallow`);
    } catch {}
  }

  async fetchOne(url) {
    let lastErr;
    for (let i = 0; i < 2; i++) {
      try {
        const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(this.o.timeoutMs) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const len = Number(res.headers.get('content-length') || 0);
        if (len > this.o.maxFileMB * 1048576) throw new Error('קובץ גדול מדי');
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > this.o.maxFileMB * 1048576) throw new Error('קובץ גדול מדי');
        return { res, buf };
      } catch (e) { lastErr = e; if (/HTTP 4/.test(e.message)) break; await sleep(300); }
    }
    throw lastErr;
  }

  decode(buf, ct) {
    const cs = /charset=([\w-]+)/i.exec(ct || '')?.[1] || /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 2048).toString('latin1'))?.[1] || 'utf-8';
    try { return new TextDecoder(cs).decode(buf); } catch { return buf.toString('utf8'); }
  }

  async process(item) {
    this.stats.current = item.url;
    const { res, buf } = await this.fetchOne(item.url);
    const ct = res.headers.get('content-type') || '';
    const finalUrl = norm(res.url || item.url);
    if (finalUrl !== item.url && item.kind === 'page' && !this.inScope(new URL(finalUrl))) throw new Error('הפניה אל מחוץ לדומיין');
    const type = isHtmlType(ct) ? 'html' : /text\/css/i.test(ct) || /\.css(\?|$)/i.test(item.url) ? 'css' : 'other';
    let local = this.map.get(finalUrl);
    if (!local) local = localPathFor(finalUrl, ct, this.rootHost, this.used);
    this.map.set(item.url, local);
    this.map.set(finalUrl, local);
    const file = path.join(this.out, ...local.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buf);
    this.stats.bytes += buf.length;
    if (type === 'html') {
      this.stats.pages++;
      const html = this.decode(buf, ct);
      const base = new URL(findBase(html) || finalUrl, finalUrl).href;
      this.texts.push({ url: finalUrl, base, local, type });
      transformHtml(html, (ref, kind) => {
        try { this.enqueue(new URL(ref, base).href, item.depth + 1, kind); } catch {}
        return null;
      });
    } else {
      this.stats.assets++;
      if (type === 'css') {
        this.texts.push({ url: finalUrl, base: finalUrl, local, type });
        transformCss(this.decode(buf, ct), (ref) => {
          try { this.enqueue(new URL(ref, finalUrl).href, item.depth + 1, 'asset'); } catch {}
          return null;
        });
      }
    }
    if (!this.entry) this.entry = local;
  }

  async worker() {
    while (!this.cancelled) {
      const item = this.queue.shift();
      if (!item) {
        if (this.active === 0) return;
        await sleep(50); continue;
      }
      this.active++;
      try { await this.process(item); }
      catch (e) {
        this.stats.failed++;
        this.failures.push({ url: item.url, error: e.message });
        this.log(`נכשל: ${item.url} (${e.message})`);
      }
      this.active--;
      this.progress();
      if (this.o.delayMs) await sleep(this.o.delayMs);
    }
  }

  async rewritePass() {
    this.log('כותב מחדש קישורים...');
    for (const t of this.texts) {
      const file = path.join(this.out, ...t.local.split('/'));
      const raw = this.decode(await fs.readFile(file), '');
      const fn = (ref) => {
        let abs;
        try { abs = new URL(ref, t.base); } catch { return null; }
        const hash = abs.hash;
        const target = this.map.get(norm(abs.href));
        if (!target) return abs.href;
        let rel = path.posix.relative(path.posix.dirname(t.local), target) || path.posix.basename(target);
        return encPath(rel) + hash;
      };
      const out = t.type === 'html' ? transformHtml(raw, fn) : transformCss(raw, fn);
      await fs.writeFile(file, out, 'utf8');
    }
  }

  async run() {
    await fs.mkdir(this.out, { recursive: true });
    await this.loadRobots();
    this.enqueue(this.start.href, 0, 'page');
    await Promise.all(Array.from({ length: this.o.concurrency }, () => this.worker()));
    if (!this.cancelled) await this.rewritePass();
    this.progress();
    const entryKey = this.map.get(norm(this.start.href)) || this.entry;
    return {
      entry: entryKey, stats: this.stats, failures: this.failures, cancelled: this.cancelled,
      map: Object.fromEntries(this.map),
    };
  }
}
