import { render } from './stub-core.mjs';
export function renderDiagrams(sources) {
  // synchronous on purpose (B29-R8a: "sync or async")
  return render(sources, 'ok');
}
