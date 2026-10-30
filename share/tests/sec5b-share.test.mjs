/**
 * SEC-5b R5b-7.3 / T5b-TEXT, the deliverable half (COB-architecture.md §5 "SEC-5b brief", revision 63). QA red
 * tests, 2026-10-29. The ca.js brand-logo comment is reworded, so the single-file page is rebuilt: it must carry the
 * new comment once and no "hotlinked", and it must be up to date with the sources.
 *
 * "Up to date" is checked by content, not by the builder's --check (which compares modification times: every
 * `npm run build` rewrites dist/ and so makes --check report a stale page even when nothing changed). A fresh build
 * with the delivered page's own footer date must equal the delivered page byte for byte. The --check run stays a
 * manual acceptance step (brief "Acceptance").
 * The developer must not edit this file.
 */
import { describe, expect, it } from 'vitest';
import { DELIVERABLE, buildReal, read } from './support/common.mjs';

const NEW_LINE = "// --- brand logo: a self-hosted file (SEC-6); fall back to the name as text if it can't load ---";
const count = (s, sub) => s.split(sub).length - 1;

describe('SEC-5b R5b-7.3: the delivered single-file page is rebuilt with the new ca.js comment', () => {
  it('it carries the new brand-logo comment exactly once and no "hotlinked"', () => {
    const html = read(DELIVERABLE);
    expect(html).not.toContain('hotlinked');
    expect(count(html, NEW_LINE)).toBe(1);
  });

  it('a fresh build with its own footer date equals it byte for byte (content-based "up to date")', () => {
    const html = read(DELIVERABLE);
    const dates = [...html.matchAll(/ · built (\d{4}-\d{2}-\d{2}) · /g)];
    expect(dates).toHaveLength(1);
    const fresh = buildReal(dates[0][1]);
    expect(fresh.result.status, fresh.result.stderr).toBe(0);
    expect(fresh.html === html, 'fresh build equals the delivered page').toBe(true);
  });
});
