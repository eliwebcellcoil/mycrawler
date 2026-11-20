// Usage: node cli.js <url> [outDir] [--max-pages N] [--depth N] [--subdomains] [--no-robots]
import path from 'node:path';
import fs from 'node:fs/promises';
import { Crawler } from './crawler.js';

const a = process.argv.slice(2);
const flag = (n) => a.includes(n);
const val = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const pos = a.filter((x, i) => !x.startsWith('--') && !(i > 0 && a[i - 1].startsWith('--') && ['--max-pages', '--depth'].includes(a[i - 1])));
if (!pos[0]) { console.error('usage: node cli.js <url> [outDir] [--max-pages N] [--depth N] [--subdomains] [--no-robots]'); process.exit(1); }
const out = path.resolve(pos[1] || 'mirror');
const c = new Crawler({
  url: new URL(pos[0]).href, maxPages: Number(val('--max-pages', 500)), maxDepth: Number(val('--depth', 10)),
  includeSubdomains: flag('--subdomains'), respectRobots: !flag('--no-robots'),
}, out);
c.on('log', console.log);
let last = 0;
c.on('progress', (s) => { if (Date.now() - last > 2000) { last = Date.now(); console.log(`pages=${s.pages} assets=${s.assets} queued=${s.queued} failed=${s.failed}`); } });
const r = await c.run();
await fs.writeFile(path.join(out, '_report.json'), JSON.stringify({ entry: r.entry, failures: r.failures, stats: r.stats }, null, 1));
console.log('done', r.stats);
