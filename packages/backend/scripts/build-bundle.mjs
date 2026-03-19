#!/usr/bin/env node
/**
 * Bundles the backend into a single ESM file using esbuild.
 * Native modules and their platform-specific binaries are kept external.
 */
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/index.js',
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  external: [
    'better-sqlite3',           // native SQLite addon
    '@boxlite-ai/boxlite-*',   // platform-specific native binaries
    'playwright-core',          // peer dep of @boxlite-ai/boxlite (large, optional)
  ],
  // CJS modules (e.g. mime-types) use require() which isn't available in ESM.
  // Use a unique name to avoid conflict with boxlite's own createRequire import.
  banner: {
    js: "import { createRequire as __banner_cjsRequire } from 'node:module'; const require = __banner_cjsRequire(import.meta.url);",
  },
})
