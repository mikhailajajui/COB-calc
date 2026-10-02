// Rewrites ui/ca.html into the single-file page. The list of changes is closed; nothing else may differ.
import { BuildError } from './modules.mjs';
import { cspFor } from './csp.mjs';

const mark = (a, b) => a + b;
const BEGIN = mark('HELP', ':BEGIN');
const END = mark('HELP', ':END');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const OPEN_C = '/' + '*';
const CLOSE_C = '*' + '/';
const CSS_BLOCK = new RegExp(`[ \\t]*${esc(OPEN_C)} ${BEGIN} ${esc(CLOSE_C)}[\\s\\S]*?${esc(OPEN_C)} ${END} ${esc(CLOSE_C)}[ \\t]*\\n?`, 'g');
const HTML_BLOCK = new RegExp(`[ \\t]*<!-- ${BEGIN} -->[\\s\\S]*?<!-- ${END} -->[ \\t]*\\n?`, 'g');

const fail = (message) => {
  throw new BuildError(`ui/ca.html: ${message}`);
};

function once(html, pattern, replacement, what) {
  const found = html.match(new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g'));
  if (!found || found.length !== 1) fail(`${what} must occur exactly once (found ${found ? found.length : 0})`);
  return html.replace(pattern, typeof replacement === 'function' ? replacement : () => replacement);
}

export function buildPage({ source, script, version, date, logo }) {
  let html = source.replace(/\r\n/g, '\n');

  html = html.replace(CSS_BLOCK, '').replace(HTML_BLOCK, '');
  if (html.includes(BEGIN) || html.includes(END)) fail('unbalanced marker pair for the optional add-on block');

  const before = html;
  html = html.replace(/<link\b[^>]*(?:preconnect|stylesheet)[^>]*>\n?/g, '');
  if (html === before) fail('expected the external font links to be present');
  if (/<link\b/i.test(html)) fail('an unexpected <link> element remains');

  html = html.replace(/^(\s*--font-(?:display|body|data):\s*)"Inter", /gm, '$1');
  if (/\bInter\b/.test(html.replace(/<script\b[\s\S]*?<\/script>/g, ''))) fail('the font name still occurs after the font stack rewrite');

  html = once(html, /src="[^"]*alterna\.ca\/media\/[^"]*"/, `src="data:image/svg+xml;base64,${logo.toString('base64')}"`, 'the logo image source');
  html = once(html, /<a class="brand-logo"[^>]*>([\s\S]*?)<\/a>/, (_m, inner) => `<span class="brand-logo">${inner}</span>`, 'the logo link');

  html = once(html, /<script type="module" src="\/ui\/ca\.js"><\/script>/, `<script type="module">${script}</script>`, 'the page script tag');

  html = once(html, /(<meta name="viewport"[^>]*>)\n/, (_m, meta) => `${meta}\n${cspFor(script)}\n`, 'the viewport meta');

  const footerCss = [
    '  #shareFooter { margin: 24px 0 0; text-align: center; font: 12px/1.4 var(--font-body); color: var(--ink-muted); }',
    '  @media print { #shareFooter { display: none; } }',
    '',
  ].join('\n');
  html = once(html, /<\/style>/, `${footerCss}</style>`, 'the closing style tag');

  const footer = `  <footer id="shareFooter">COB Calculator v${version} · built ${date} · single-file edition, works offline</footer>\n\n`;
  html = once(html, /  <script type="module">/, `${footer}  <script type="module">`, 'the inline script position');

  return html;
}
