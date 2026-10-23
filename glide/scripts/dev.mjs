// Development: Vite dev server (hot reload) + esbuild watch for the main
// process + Electron pointed at the dev server.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`renderer: ${url}`);

const watch = spawn(process.execPath, ['scripts/build-main.mjs', '--watch'], { stdio: 'inherit' });
while (!existsSync('dist-electron/main.cjs') || !existsSync('dist-electron/preload.cjs')) await new Promise((r) => setTimeout(r, 200));

const electronBin = (await import('electron')).default;
const args = ['.'];
if (process.getuid?.() === 0) args.push('--no-sandbox');
const app = spawn(electronBin, args, { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
app.on('exit', async () => {
  watch.kill();
  await server.close();
  process.exit(0);
});
