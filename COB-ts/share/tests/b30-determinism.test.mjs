/**
 * B30-INV-DET and B30-INV-FOOTER date rules (QA red tests, 2026-10-01): byte-identical rebuilds, the date is the
 * only difference between two dates, validation (exit 1 and nothing written), precedence --date > COB_BUILD_DATE >
 * today in UTC, output independent of the working directory.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COB, FIXED_DATE, build, buildReal, ran, read, tmp } from './support/common.mjs';

describe('B30-INV-DET', () => {
  it('two builds with the same date are byte-identical (and independent of the working directory)', () => {
    const a = buildReal(FIXED_DATE);
    expect(a.result.status, a.result.stderr).toBe(0);
    const out2 = join(tmp(), 'COB.html');
    const r = build(['--out', out2, '--date', FIXED_DATE], { cwd: tmp() });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(out2).equals(readFileSync(a.out))).toBe(true);
  });

  it('two dates: the outputs differ only in the date string, which occurs once', () => {
    const a = buildReal('2026-10-01').html;
    const b = buildReal('2027-01-31').html;
    expect(a.length).toBeGreaterThan(1000);
    // the footer is the only place that changes (the date string 2026-10-01 may also occur in a source example)
    expect(a.split('built 2026-10-01 ').length - 1).toBe(1);
    expect(a).not.toBe(b);
    expect(a.replace('built 2026-10-01 ', 'built DATE ')).toBe(b.replace('built 2027-01-31 ', 'built DATE '));
  });

  it('LF line endings only, ends with a newline, no absolute path of this machine in the output', () => {
    const { html } = buildReal();
    expect(html).not.toContain('\r');
    expect(html.endsWith('\n')).toBe(true);
    expect(html).not.toContain(COB);
    expect(html).not.toMatch(/\/Users\/|\/private\/var|\/tmp\//);
  });
});

describe('B30-INV-FOOTER: the date', () => {
  const bad = ['2026-13-01', '2026-02-30', '2026-02-29', '1/10/2026', '', '2026-1-1', '2026-10-01T00:00', ' 2026-10-01', '2026-00-10', '2026-10-32'];
  it.each(bad)('--date %j: exit 1, message names the date option, an existing output is untouched', (d) => {
    const dir = tmp();
    const out = join(dir, 'COB.html');
    writeFileSync(out, 'SENTINEL');
    const r = build(['--out', out, '--date', d]);
    expect(r.status).toBe(1);
    expect(r.stderr.toLowerCase()).toContain('date');
    expect(read(out)).toBe('SENTINEL');
    expect(existsSync(out + '.tmp')).toBe(false);
  });

  it('a bad date writes nothing when there was no output before', () => {
    const out = join(tmp(), 'COB.html');
    const r = build(['--out', out, '--date', '2026-13-01']);
    ran(r);
    expect(r.status).toBe(1);
    expect(existsSync(out)).toBe(false);
  });

  it('a bad COB_BUILD_DATE exits 1 too', () => {
    const out = join(tmp(), 'COB.html');
    const r = build(['--out', out], { env: { COB_BUILD_DATE: '2026-02-30' } });
    ran(r);
    expect(r.status).toBe(1);
    expect(r.stderr.toLowerCase()).toContain('date');
    expect(existsSync(out)).toBe(false);
  });

  it('a real leap day is accepted', () => {
    expect(buildReal('2028-02-29').html).toContain('built 2028-02-29 ');
  });

  it('precedence: --date wins over COB_BUILD_DATE; the variable is used when --date is absent', () => {
    const d = tmp();
    const o1 = join(d, 'a.html');
    expect(build(['--out', o1, '--date', '2026-10-01'], { env: { COB_BUILD_DATE: '2020-05-05' } }).status).toBe(0);
    expect(read(o1)).toContain('built 2026-10-01 ');
    const o2 = join(d, 'b.html');
    expect(build(['--out', o2], { env: { COB_BUILD_DATE: '2020-05-05' } }).status).toBe(0);
    expect(read(o2)).toContain('built 2020-05-05 ');
  });

  it('default date is today in UTC', () => {
    const iso = (t) => new Date(t).toISOString().slice(0, 10);
    const before = iso(Date.now());
    const out = join(tmp(), 'COB.html');
    expect(build(['--out', out]).status).toBe(0);
    const after = iso(Date.now());
    const got = read(out).match(/built (\d{4}-\d{2}-\d{2}) /)?.[1];
    expect([before, after]).toContain(got);
  });
});
