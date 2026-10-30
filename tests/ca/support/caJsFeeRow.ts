/**
 * SEC-7 (checklist §4a; security review 2026-10-28 finding #6): helpers shared by the SEC-7 tests and the structural
 * ca.js pins (SEC-5 R5-5, SEC-6 S6-R2.5). QA-owned; the developer must not edit this file.
 *
 * `addFeeRowSource` cuts the `function addFeeRow(…) { … }` declaration out of ui/ca.js (balanced parens, then
 * balanced braces). `neutraliseCaJs` replaces that declaration by `function addFeeRow() {}` and puts the SEC-5
 * `fetch('/version.json')` back to `fetch('/package.json')`, so the sha256 of the result pins "everything in ca.js
 * other than addFeeRow is as before SEC-5" across the SEC-7 fix.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../architecture/support.js';

export const CA_JS_PATH = join(ROOT, 'ui', 'ca.js');

export function readCaJs(): string {
  return readFileSync(CA_JS_PATH, 'utf8');
}

function matchClose(s: string, open: number, o: string, c: string): number {
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === o) depth += 1;
    else if (s[i] === c) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unbalanced ${o}${c} from ${open}`);
}

/** [start, end) of the addFeeRow function declaration in `src`. Throws unless there is exactly one. */
export function addFeeRowRange(src: string): [number, number] {
  const marker = 'function addFeeRow(';
  const start = src.indexOf(marker);
  if (start < 0 || src.indexOf(marker, start + 1) >= 0) throw new Error('expected exactly one `function addFeeRow(` in ui/ca.js');
  const parenOpen = start + marker.length - 1;
  const parenClose = matchClose(src, parenOpen, '(', ')');
  const braceOpen = src.indexOf('{', parenClose);
  const braceClose = matchClose(src, braceOpen, '{', '}');
  return [start, braceClose + 1];
}

export function addFeeRowSource(src: string = readCaJs()): string {
  const [a, b] = addFeeRowRange(src);
  return src.slice(a, b);
}

/**
 * SEC-5b R5b-7.3 (QA red step 2026-10-29): the brand-logo comment of ui/ca.js is reworded once. `neutraliseCaJs`
 * puts the old line back after the fetch reverse, so NEUTRALISED_CA_JS_SHA does not move. Before SEC-5b the
 * replace finds nothing and changes nothing.
 */
export const LOGO_COMMENT_SEC5B = "// --- brand logo: a self-hosted file (SEC-6); fall back to the name as text if it can't load ---";
export const LOGO_COMMENT_PRE_SEC5B = "// --- brand logo: hotlinked from alterna.ca; fall back to the name as text if it can't load ---";

export function neutraliseCaJs(src: string = readCaJs()): string {
  const [a, b] = addFeeRowRange(src);
  return (src.slice(0, a) + 'function addFeeRow() {}' + src.slice(b))
    .replace("fetch('/version.json')", "fetch('/package.json')")
    .replace(LOGO_COMMENT_SEC5B, LOGO_COMMENT_PRE_SEC5B);
}

/**
 * sha256 of `neutraliseCaJs(ca.js)` taken by QA on 2026-10-29 from the ca.js of the SEC-5 delivery
 * (file sha256 72dca1cf…, itself pinned as pre-SEC-5 c85852c6… with the fetch put back).
 */
export const NEUTRALISED_CA_JS_SHA = 'ff8d8ef502c95fb817fe7e8a398356fa70e243709af65c9a92fd77b5f36ad6f1';
