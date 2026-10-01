/**
 * B25 (DEV-OQZ) QA oracle for the golden regeneration. Test-only. Writes golden_engine_v1_b25_expected.json,
 * the file golden_engine_v1.json must equal after sr-dev's approved regeneration.
 *
 * How it is built (independent of the B25 change in the engine): every corpus input of generate_golden.mjs is
 * run through calculateCobCanada, with ONE substitution -- for a semi-monthly input the firstPaymentDate is
 * replaced by the MOVED date from the Python oracle (b25_semimonthly_move_vectors.json 'corpus', made by
 * generate_b25_semimonthly_move_vectors.py). Start, End and everything else keep their typed-date values.
 * That is the B25-INV-equiv statement: the B25 engine on the typed date = the engine on the moved date.
 * The move is idempotent, so the file comes out the same on the pre-B25 and the B25 engine; it was first made
 * on the pre-B25 engine (src untouched), where it cannot be circular.
 *
 * Run (COB-ts/): npx vite-node tests/ca/fixtures/generate_b25_expected_golden.mjs --write
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// generate_golden.mjs writes golden_engine_v1.json when --write is in argv (F-1): hide it while importing.
const argv = process.argv;
process.argv = argv.filter((a) => a !== '--write');
const v1 = await import('./generate_golden.mjs');
process.argv = argv;

const oracle = JSON.parse(readFileSync(fileURLToPath(new URL('./b25_semimonthly_move_vectors.json', import.meta.url)), 'utf8'));
const iso = (d) => d.toISOString().slice(0, 10);

export function withOracleMove(calculate) {
  return (input) => {
    if (input.paymentFrequency !== 'semiMonthly') return calculate(input);
    const moved = oracle.corpus[iso(input.firstPaymentDate)];
    if (moved === undefined) throw new Error(`no oracle move for ${iso(input.firstPaymentDate)}`);
    return calculate({ ...input, firstPaymentDate: new Date(`${moved}T00:00:00.000Z`) });
  };
}

if (process.argv.includes('--write')) {
  const { calculateCobCanada } = await import('../../../src/ca/cobCanada.ts');
  const golden = v1.computeGolden(withOracleMove(calculateCobCanada));
  const target = fileURLToPath(new URL('./golden_engine_v1_b25_expected.json', import.meta.url));
  writeFileSync(target, v1.serialise(golden));
  console.log(`wrote ${target}`);
}
