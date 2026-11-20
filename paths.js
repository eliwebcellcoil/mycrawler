import crypto from 'node:crypto';
import path from 'node:path';

const h8 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);
const clean = (seg) => {
  let s = seg;
  try { s = decodeURIComponent(seg); } catch {}
  s = s.replace(/[<>:"|?*\\\x00-\x1f]/g, '_').replace(/^\.+$/, '_');
  if (s.length > 100) s = s.slice(0, 80) + '_' + h8(s);
  return s;
};

export const isHtmlType = (ct) => /text\/html|application\/xhtml/i.test(ct || '');

// Pure mapping URL + content type -> relative local file path (posix)
export function localPathFor(urlStr, contentType, rootHost, used) {
  const u = new URL(urlStr);
  const same = u.hostname.replace(/^www\./, '') === rootHost.replace(/^www\./, '');
  const base = same ? '' : `_ext/${clean(u.hostname + (u.port ? '_' + u.port : ''))}/`;
  const segs = u.pathname.split('/').filter((s, i, a) => s !== '' || i === a.length - 1);
  const endsSlash = u.pathname.endsWith('/') || u.pathname === '';
  let parts = segs.filter((s) => s !== '').map(clean);
  const q = u.search ? `_q${h8(u.search)}` : '';
  let file;
  const html = isHtmlType(contentType);
  if (endsSlash || parts.length === 0) {
    file = `index${q}.html`;
  } else {
    let last = parts.pop();
    const ext = path.posix.extname(last);
    if (html) {
      if (/^\.html?$/i.test(ext)) file = last.slice(0, -ext.length) + q + ext;
      else if (ext) file = last + q + '.html';
      else { parts.push(last); file = `index${q}.html`; }
    } else {
      file = ext ? last.slice(0, -ext.length) + q + ext : last + q;
    }
  }
  let rel = base + [...parts, file].join('/');
  if (used) {
    if (used.has(rel) && used.get(rel) !== urlStr) {
      const ext = path.posix.extname(rel);
      rel = rel.slice(0, rel.length - ext.length) + '_' + h8(urlStr) + ext;
    }
    used.set(rel, urlStr);
  }
  return rel;
}
