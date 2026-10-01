/**
 * B27 verify (QA finding F-1): the UI scripts must at least parse as ES modules. `ui/ca.js` is DOM work and
 * is not imported by any test, so an early error (a duplicate `const` after a merge, a bad import) leaves the
 * page dead (no handlers, the static HTML only) while the whole vitest suite stays green. `node --check` on a
 * .mjs copy runs the module parser only (early errors included), without executing anything.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('UI scripts parse as ES modules (no early errors)', () => {
  it.each(['ui/ca.js', 'ui/ca-view.js'])('%s', (file) => {
    const dir = mkdtempSync(join(tmpdir(), 'cob-parse-'));
    const copy = join(dir, 'script.mjs');
    try {
      copyFileSync(join(__dirname, '..', '..', file), copy);
      let message = '';
      try {
        execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' });
      } catch (e) {
        message = String((e as { stderr?: Buffer }).stderr ?? e);
      }
      expect(message).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
