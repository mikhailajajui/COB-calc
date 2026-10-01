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
