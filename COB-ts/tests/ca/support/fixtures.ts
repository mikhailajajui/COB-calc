/**
 * A12b-R1 (COB-architecture.md §5 A12b, revision 14): the one home for test fixture paths.
 * QA-owned. F11a forbids building a `fixtures/` URL anywhere else under tests/ca.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Absolute path of tests/ca/fixtures/, with a trailing separator. */
export const FIXTURES_DIR: string = fileURLToPath(new URL('../fixtures/', import.meta.url));

/** Parses tests/ca/fixtures/<name> as JSON. Call sites state the shape with the type argument or `as`. */
export function loadFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(FIXTURES_DIR + name, 'utf8')) as T;
}

/** B39 (spec 014, registry rule 1): absolute path of the engines' shared fixtures, COB-py/tests/fixtures/, with a trailing
 *  separator. The only place that path is built (F11a). */
export const SHARED_FIXTURES_DIR: string = fileURLToPath(new URL('../../../../COB-py/tests/fixtures/', import.meta.url));

/** The text of COB-py/tests/fixtures/<name>, byte for byte. */
export function readSharedFixtureText(name: string): string {
  return readFileSync(SHARED_FIXTURES_DIR + name, 'utf8');
}

/** A reverse number-token patch of the page capture (b37_capture_undo.json, b38_capture_undo.json). */
export interface CaptureUndo {
  numberToken: string;
  /** B38: the token used on base64 (CSV) leaves; absent = numberToken. */
  csvNumberToken?: string;
  scenarios: Record<string, { path: (string | number)[]; base64: boolean; tokens: [number, string, string][] }[]>;
}

/**
 * B38 (spec 013): applies `undo` to a copy of one capture scenario and returns the copy. A scenario with no entry is
 * returned unchanged. Throws unless every patched token is a number token (odd index) holding the expected text and its
 * replacement is a whole number token.
 */
export function applyCaptureUndo<T>(scenario: T & { id: string }, undo: CaptureUndo): T {
  const patches = undo.scenarios[scenario.id];
  if (!patches) return scenario;
  const copy = JSON.parse(JSON.stringify(scenario)) as Record<string, unknown>;
  for (const { path, base64, tokens } of patches) {
    const token = base64 ? (undo.csvNumberToken ?? undo.numberToken) : undo.numberToken;
    const num = new RegExp(token);
    const whole = new RegExp(`^${token}$`);
    let parent = copy as Record<string | number, unknown>;
    for (const k of path.slice(0, -1)) parent = parent[k] as Record<string | number, unknown>;
    const leaf = path[path.length - 1]!;
    const text = base64 ? Buffer.from(parent[leaf] as string, 'base64').toString('utf8') : (parent[leaf] as string);
    const parts = text.split(num);
    for (const [i, now, before] of tokens) {
      const where = `${scenario.id} ${path.join('/')} token ${i}`;
      if (i % 2 !== 1) throw new Error(`${where} is not a number token`);
      if (parts[i] !== now) throw new Error(`${where}: expected ${now}, found ${parts[i]}`);
      if (!whole.test(before)) throw new Error(`${where}: replacement ${before} is not a number token`);
      parts[i] = before;
    }
    parent[leaf] = base64 ? Buffer.from(parts.join(''), 'utf8').toString('base64') : parts.join('');
  }
  return copy as T;
}
