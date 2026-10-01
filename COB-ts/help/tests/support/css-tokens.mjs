// CSS custom-property reader and WCAG contrast arithmetic for the Help tests (B29 check 19). QA-owned.
// Light tokens: declarations in rule blocks whose selector contains :root outside any @media.
// Dark tokens: declarations inside @media (prefers-color-scheme: dark). @media print is ignored.

function blocks(css) {
  // returns [{ selector, body, parents: [media prelude...] }] with nested at-rules flattened
  const out = [];
  const walk = (src, parents) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      const prelude = src.slice(i, open).trim().replace(/^[^{}]*;/s, '').trim();
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        j++;
      }
      const body = src.slice(open + 1, j - 1);
      if (prelude.startsWith('@')) walk(body, [...parents, prelude]);
      else out.push({ selector: prelude, body, parents });
      i = j;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''), []);
  return out;
}

function decls(body) {
  const o = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) o[m[1]] = m[2].trim();
  return o;
}

export function cssTokens(css) {
  const light = {};
  const dark = {};
  for (const b of blocks(css)) {
    if (!/:root/.test(b.selector)) continue;
    if (b.parents.length === 0 && /data-theme/.test(b.selector)) continue; // explicit opt-in blocks are not the default scheme
    if (b.parents.length === 0) Object.assign(light, decls(b.body));
    else if (b.parents.some((p) => /prefers-color-scheme\s*:\s*dark/.test(p)) && !b.parents.some((p) => /print/.test(p))) Object.assign(dark, decls(b.body));
  }
  return { light, dark: { ...light, ...dark } };
}

export function hex(v) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) throw new Error(`not a hex colour: ${v}`);
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(hex(a)), luminance(hex(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** All blocks of css (for rule lookups): [{ selector, body, parents }]. */
export const cssBlocks = blocks;
