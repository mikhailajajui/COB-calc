/**
 * A11 (scope B, user decision Q-A11-SCOPE 2026-10-01): the print table is built on demand, not on every keystroke.
 * Rules A11-R1, A11-R2 (screen unchanged), A11-R6 (nothing else changes); NO pause / debounce (scope C dropped).
 *
 * No vitest test loads ui/ca.js (it is DOM work), so these are static pins over the comment-stripped source; the
 * behaviour itself is proved in real Chrome by tests/ui/check_render_cost.mjs (F18). Red until sr-dev implements A11.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, stripComments } from '../architecture/support.js';

const src = stripComments(readFileSync(join(ROOT, 'ui', 'ca.js'), 'utf8'));

/** Text of `function name(...) { ... }` by brace matching (braces inside strings are not expected in these bodies). */
function body(name: string): string {
  const at = src.search(new RegExp(`function\\s+${name}\\s*\\(`));
  expect(at, `function ${name} must exist in ui/ca.js`).toBeGreaterThanOrEqual(0);
  const open = src.indexOf('{', src.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}
const calls = (text: string, name: string) => (text.match(new RegExp(`(?<![\\w.])${name}\\s*\\(`, 'g')) ?? []).length;

describe('A11-R1 the print table is built on demand', () => {
  it('A11-1 renderPrintSchedule has exactly one caller, ensurePrintSchedule', () => {
    const defs = (src.match(/function\s+renderPrintSchedule\s*\(/g) ?? []).length;
    expect(defs).toBe(1);
    expect(calls(src, 'renderPrintSchedule') - defs, 'call sites in the whole file').toBe(1);
    expect(calls(body('ensurePrintSchedule'), 'renderPrintSchedule')).toBe(1);
  });

  it('A11-2 recompute, renderPrintRecord and the column radio handler do not build the print table', () => {
    for (const fn of ['recompute', 'renderPrintRecord']) {
      expect(calls(body(fn), 'renderPrintSchedule'), fn).toBe(0);
      expect(calls(body(fn), 'ensurePrintSchedule'), fn).toBe(0);
    }
    const radio = src.slice(src.indexOf('for (const radio of columnRadios)'), src.indexOf('function setCurrentResult') );
    expect(radio).toContain('renderScheduleTable()');
    expect(radio).not.toMatch(/renderPrintSchedule|ensurePrintSchedule/);
  });

  it('A11-3 ensurePrintSchedule is a no-op without a result and caches on (result, scheduleColumns)', () => {
    const b = body('ensurePrintSchedule');
    expect(b).toMatch(/!\s*scheduleResult|scheduleResult\s*===\s*null|scheduleResult\s*==\s*null/);
    expect(b).toContain('scheduleColumns');
    expect(b).toMatch(/return/);
  });

  it('A11-4 it runs from a beforeprint listener and from a matchMedia("print") change listener', () => {
    expect(src).toMatch(/addEventListener\(\s*['"]beforeprint['"][\s\S]{0,200}?ensurePrintSchedule/);
    expect(src).toMatch(/matchMedia\(\s*['"]print['"]\s*\)/);
    expect(src).toMatch(/matchMedia\(\s*['"]print['"]\s*\)[\s\S]{0,200}?['"]change['"][\s\S]{0,200}?ensurePrintSchedule|ensurePrintSchedule[\s\S]{0,200}?matchMedia\(\s*['"]print['"]\s*\)/);
  });

  it('A11-5 the existing beforeprint refresh of the printed-at time is kept', () => {
    expect(src).toMatch(/addEventListener\(\s*['"]beforeprint['"]\s*,\s*refreshPrintedAt\s*\)/);
  });
});

describe('A11-R2 / scope B: the screen table is unchanged and not delayed', () => {
  it('A11-6 recompute still rebuilds the screen table synchronously on every call', () => {
    expect(calls(body('recompute'), 'renderScheduleTable')).toBe(1);
  });

  it('A11-7 no pause, debounce or animation frame was added (scope C is out); the only timer is the blob revoke', () => {
    expect((src.match(/\bsetTimeout\s*\(/g) ?? []).length).toBe(1);
    expect(src).toContain('URL.revokeObjectURL');
    expect(src).not.toMatch(/requestAnimationFrame|clearTimeout|debounce|SCHEDULE_PAUSE_MS/);
  });
});
