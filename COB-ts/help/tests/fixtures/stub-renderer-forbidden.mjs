// QA fixture (B29-R13 backstop, G7): a renderer whose SVG text carries the string in env HELP_STUB_EMIT on a line of
// its own, so that the generated page, not any document, contains it. Everything else as stub-renderer.mjs.
import { render } from './stub-core.mjs';
export async function renderDiagrams(sources) {
  const emit = process.env.HELP_STUB_EMIT ?? '';
  return render(sources, 'ok').map((r) => ({ ...r, svg: r.svg.replace('</g>', `</g>\n<text x="1" y="1">${emit}</text>\n`) }));
}
