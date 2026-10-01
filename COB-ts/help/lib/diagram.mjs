// Diagrams (B29-R8, R8a): validate the renderer's results and build the figure markup and the text alternative.

const STATE_WORDS = {
  today: 'today',
  planned: 'planned',
  wrong: 'known wrong result today',
  open: 'open or on hold',
  out: 'outside this tool',
};

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const clean = (s) =>
  String(s ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/#quot;|&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

/** Throws Error(message) when the renderer's result for one block is unusable. */
export function checkResult(res) {
  if (!res || typeof res !== 'object') throw new Error('the renderer returned no result for this block');
  if (typeof res.svg !== 'string' || !res.svg.trimStart().startsWith('<svg')) throw new Error('the renderer returned no SVG for this block');
  const m = res.model;
  if (!m || (m.type !== 'flowchart' && m.type !== 'sequence')) throw new Error(`unsupported diagram type "${m && m.type}" (only flowchart and sequence)`);
  if (m.type === 'flowchart') {
    if (!Array.isArray(m.nodes) || m.nodes.length === 0) throw new Error('the diagram has no nodes');
    for (const n of m.nodes) {
      for (const c of n.classes ?? []) if (!(c in STATE_WORDS)) throw new Error(`class "${c}" is not one of today, planned, wrong, open, out`);
    }
  } else if (!(m.messages ?? []).length && !(m.actors ?? []).length) throw new Error('the diagram has no actors or messages');
}

/** The sentences of the text alternative, one per box and arrow (or per message). */
export function sentences(model) {
  const out = [];
  if (model.type === 'sequence') {
    for (const m of model.messages ?? []) out.push(`Message from "${clean(m.from)}" to "${clean(m.to)}": ${clean(m.message)}.`);
    return out;
  }
  const text = new Map();
  for (const n of model.nodes) {
    const label = clean(n.text) || clean(n.id);
    text.set(n.id, label);
    const cls = (n.classes ?? []).find((c) => c in STATE_WORDS);
    out.push(cls ? `Box "${label}" (${STATE_WORDS[cls]}).` : `Box "${label}".`);
  }
  for (const e of model.edges ?? []) {
    if (e.stroke === 'invisible') continue;
    const label = clean(e.text);
    const from = text.get(e.start) ?? clean(e.start);
    const to = text.get(e.end) ?? clean(e.end);
    out.push(`Arrow from "${from}" to "${to}"${label ? `: ${label}` : ''}${e.stroke === 'dotted' ? ' (dashed: planned path)' : ''}.`);
  }
  return out;
}

/** The start tag of the SVG with the natural size from the viewBox, role=img and the labelled-by ids. */
function retag(svg, tid, did) {
  const end = svg.indexOf('>');
  let tag = svg.slice(0, end);
  const vb = /\sviewBox="([^"]*)"/.exec(tag);
  const box = vb ? vb[1].trim().split(/[\s,]+/).map(Number) : [];
  tag = tag
    .replace(/\s(?:width|height|role|aria-labelledby)="[^"]*"/g, '')
    .replace(/\sstyle="([^"]*)"/, (_m, v) => {
      const rest = v.replace(/max-width\s*:[^;]*;?/g, '').trim();
      return rest ? ` style="${rest}"` : '';
    });
  const size = box.length === 4 && box.every(Number.isFinite) ? ` width="${box[2]}" height="${box[3]}"` : '';
  return `${tag}${size} role="img" aria-labelledby="${tid} ${did}">${svg.slice(end + 1)}`;
}

/** figure.diagram for one block. heading: the nearest heading's text. */
export function figureHtml({ key, k, heading, source, result }) {
  const id = `${key}-fig-${k}`;
  const cap = `Figure ${k}. ${heading}`;
  const list = sentences(result.model);
  const tid = `t-${id}`;
  const did = `d-${id}`;
  const svg = retag(result.svg.trim(), tid, did).replace(
    /^(<svg\b[^>]*>)/,
    `$1<title id="${tid}">${esc(cap)}</title><desc id="${did}">${esc(list.join(' '))}</desc>`,
  );
  return (
    `<figure class="diagram" id="${id}">\n` +
    `<figcaption id="${id}-cap">${esc(cap)} <a class="anchor" href="#${id}" aria-label="Link to Figure ${k}">#</a></figcaption>\n` +
    `<div class="diagram-frame" role="region" tabindex="0" aria-labelledby="${id}-cap">${svg}</div>\n` +
    `<details class="diagram-text"><summary>Read this diagram as text</summary>\n<ol>${list.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>\n` +
    `<pre class="diagram-source" tabindex="0">${esc(source)}</pre>\n</details>\n</figure>\n`
  );
}
