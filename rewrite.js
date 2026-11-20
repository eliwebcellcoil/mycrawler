// Extraction + rewriting of references in HTML and CSS.
// fn(ref, kind) -> new ref string, or null/undefined to leave unchanged.

const SKIP = /^(#|javascript:|mailto:|tel:|data:|about:|blob:|sms:)/i;
const decodeEnt = (s) => s.replace(/&amp;/g, '&').replace(/&#38;/g, '&').replace(/&quot;/g, '"');
const encodeEnt = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function apply(ref, kind, fn) {
  const raw = ref.trim();
  if (!raw || SKIP.test(raw)) return null;
  return fn(raw, kind);
}

export function transformCss(css, fn) {
  css = css.replace(/@import\s+(['"])(.*?)\1/gi, (m, q, ref) => {
    const r = apply(ref, 'asset', fn);
    return r ? `@import ${q}${r}${q}` : m;
  });
  return css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, q, ref) => {
    const r = apply(ref, 'asset', fn);
    return r ? `url(${q || '"'}${r}${q || '"'})` : m;
  });
}

const ATTR = /(\s(?:href|src|data-src|data-original|data-lazy-src|poster|srcset|data-srcset|data-bg)\s*=\s*)("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

export function transformHtml(html, fn) {
  html = html.replace(/\s+integrity\s*=\s*("[^"]*"|'[^']*')/gi, '');
  html = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (m, a, css) => `<style${a}>${transformCss(css, fn)}</style>`);
  return html.replace(/<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (m, tag, attrs) => {
    const t = tag.toLowerCase();
    const pageTag = t === 'a' || t === 'area' || t === 'iframe' || t === 'frame';
    let out = attrs.replace(ATTR, (mm, pre, val, dq, sq, uq) => {
      const name = pre.trim().replace(/\s*=\s*$/, '').toLowerCase();
      const inner = decodeEnt(dq ?? sq ?? uq);
      const quote = sq !== undefined ? "'" : '"';
      const kind = pageTag && (name === 'href' || name === 'src') ? 'page' : 'asset';
      if (name === 'srcset' || name === 'data-srcset') {
        const res = inner.split(',').map((part) => {
          const p = part.trim().split(/\s+/);
          const r = apply(p[0] || '', 'asset', fn);
          return [r || p[0], ...p.slice(1)].join(' ');
        }).join(', ');
        return `${pre}${quote}${encodeEnt(res)}${quote}`;
      }
      const r = apply(inner, kind, fn);
      return r ? `${pre}${quote}${encodeEnt(r)}${quote}` : mm;
    });
    out = out.replace(/(\sstyle\s*=\s*)("([^"]*)"|'([^']*)')/gi, (mm, pre, val, dq, sq) => {
      const quote = dq !== undefined ? '"' : "'";
      const css = transformCss(decodeEnt(dq ?? sq), fn).replace(/"/g, "'");
      return `${pre}${quote}${encodeEnt(css).replace(/&quot;/g, "'")}${quote}`;
    });
    return `<${tag}${out}>`;
  }).replace(/<base\b[^>]*>/gi, '');
}

// <base href> must be read before resolving relative refs
export function findBase(html) {
  const m = html.match(/<base\b[^>]*\shref\s*=\s*("([^"]*)"|'([^']*)')/i);
  return m ? decodeEnt(m[2] ?? m[3]) : null;
}
