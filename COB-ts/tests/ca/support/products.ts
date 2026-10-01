/**
 * B27 (COB-architecture.md section 5 B27; DEV-FB24): the engine's product catalogue as tests see it. QA-owned.
 *
 * `frequenciesFor(productType)` reads `allowedPaymentFrequencies` from the public barrel AT CALL TIME, so in the
 * red step (before sr-dev adds src/ca/products.ts and exports it) each test that needs it fails on its own
 * instead of the whole file failing at import, and `typecheck:tests` stays clean.
 */
import * as api from '../../../src/ca/index.js';
import type { ProductType } from '../../../src/ca/index.js';

type CatalogueFn = (productType: ProductType) => readonly string[];

export function frequenciesFor(productType: ProductType): readonly string[] {
  const fn = (api as unknown as { allowedPaymentFrequencies?: CatalogueFn }).allowedPaymentFrequencies;
  if (typeof fn !== 'function') throw new Error('B27: the barrel (src/ca/index.ts) does not export allowedPaymentFrequencies yet');
  return fn(productType);
}
