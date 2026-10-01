// The wording of the UI-scan refusals (B29-R13), shared by the build and --check.
import { originOf } from './ui-scan-guard.mjs';

export const forbiddenText = (h) =>
  `forbidden string "${h.match}" (${h.id}): a baseline test that scans the UI folder fails on it (${originOf(h.id)}); reword the document`;
export const refusedLine = (n) =>
  `Help build refused: ${n} forbidden string(s). Documents must not contain identifiers that the UI-folder scans forbid; reword them.`;
