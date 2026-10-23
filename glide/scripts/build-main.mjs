// Bundles the Electron main process, preload script, background worker and CLI with esbuild.
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  packages: 'external',
  external: ['electron'],
  logLevel: 'info',
  outExtension: { '.js': '.cjs' },
  outdir: 'dist-electron',
};

const entries = [
  { entryPoints: { main: 'electron/main.ts', worker: 'electron/worker.ts', cli: 'electron/cli.ts' } },
  // Preload runs sandboxed: bundle everything (only electron is external).
  { entryPoints: { preload: 'electron/preload.ts' }, packages: undefined },
];

if (watch) {
  for (const e of entries) await (await context({ ...common, ...e })).watch();
} else {
  for (const e of entries) await build({ ...common, ...e });
}
