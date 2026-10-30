import { defineConfig } from 'vitest/config';

// SEC-4 (vitest 2.1.9 -> 5.0.5): keep the v2 behaviour.
// testTimeout: v5 applies the 5 s default to synchronous tests too; some of ours run longer.
// taskTitleValueFormatTruncate: 0 keeps it.each titles untruncated, as v2 printed them.
// exclude: the v2 default list (v5 excludes only node_modules and .git).
export default defineConfig({
  test: {
    testTimeout: 120_000,
    taskTitleValueFormatTruncate: 0,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
    ],
  },
});
