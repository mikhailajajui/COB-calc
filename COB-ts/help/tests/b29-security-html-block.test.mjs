/**
 * B29 security review fix 4 (QA 2026-10-01): the Help builder refuses block-level raw HTML (html_block), with the same
 * error style as the inline refusal: docs/<file>:<line>: raw HTML is not allowed in a document. The refusal is already
 * in help/lib/markdown.mjs analyze(), so this is a characterisation (green) that guards against regression.
 * Deleted with help/.
 */
import { describe, expect, it } from 'vitest';
import { buildDocs } from './support/common.mjs';

const MSG = /docs\/COB-user-manual\.md:5: raw HTML is not allowed in a document/;
const doc = (body) => ({ manual: '# T\n\n## A\n\n' + body });

describe('B29-SEC-4 raw HTML is refused', () => {
  it.each([
    ['a lone img tag with an event handler (html_block)', '<img src=x onerror=alert(1)>\n'],
    ['a div block', '<div>\nhi\n</div>\n'],
    ['a script block', '<script>alert(1)</script>\n'],
    ['an HTML comment block', '<!-- hidden -->\n'],
    ['inline HTML inside a paragraph', 'text <b>x</b> more\n'],
  ])('%s fails the build, naming file and line, and writes no page', (_n, body) => {
    const r = buildDocs(doc(body));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(MSG);
    expect(r.html).toBeNull();
  });
  it('valid documents (code spans and fences showing tags) still build', () => {
    const r = buildDocs(doc('Use `<b>` in code.\n\n```html\n<img src=x onerror=alert(1)>\n```\n'));
    expect(r.status, r.stderr).toBe(0);
    expect(r.html).not.toContain('<img src=x');
  });
});
