// Rewrites ui/ca.html (with ui/ca.css inlined, minus its FONTS block) into the single-file page. The list of changes is closed; nothing else may differ.
import { BuildError } from './modules.mjs';
import { cspFor } from './csp.mjs';

const fail = (message) => {
  throw new BuildError(`ui/ca.html: ${message}`);
};

function once(html, pattern, replacement, what) {
  const found = html.match(new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g'));
  if (!found || found.length !== 1) fail(`${what} must occur exactly once (found ${found ? found.length : 0})`);
  return html.replace(pattern, typeof replacement === 'function' ? replacement : () => replacement);
}

function stripFonts(css) {
  const cssFail = (message) => {
    throw new BuildError(`ui/ca.css: ${message}`);
  };
  if (!css.endsWith('\n')) cssFail('must end with a newline');
  const lines = css.split('\n');
  const begins = lines.flatMap((l, i) => (l.includes('/* FONTS:BEGIN') ? [i] : []));
  const ends = lines.flatMap((l, i) => (l.includes('/* FONTS:END */') ? [i] : []));
  if (begins.length !== 1 || ends.length !== 1 || ends[0] < begins[0]) cssFail('the FONTS:BEGIN/END block must occur exactly once');
  return [...lines.slice(0, begins[0]), ...lines.slice(ends[0] + 1)].join('\n');
}

export function buildPage({ source, css, script, version, date, logo }) {
  let html = source.replace(/\r\n/g, '\n');

  const styles = stripFonts(css.replace(/\r\n/g, '\n'));
  html = once(html, /<link rel="stylesheet" href="\/ui\/ca\.css" \/>\n/, `<style>\n${styles}</style>\n`, 'the ca.css stylesheet link');
  if (/<link\b/i.test(html)) fail('an unexpected <link> element remains');

  html = html.replace(/^(\s*--font-(?:display|body|data):\s*)"Inter", /gm, '$1');
  if (/\bInter\b/.test(html.replace(/<script\b[\s\S]*?<\/script>/g, ''))) fail('the font name still occurs after the font stack rewrite');

  html = once(html, /src="\/ui\/assets\/alterna-savings\.svg"/, `src="data:image/svg+xml;base64,${logo.toString('base64')}"`, 'the logo image source');
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
