import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRequire = createRequire(path.join(root, 'apps/extension/package.json'));
const viteCli = path.join(
  path.dirname(extensionRequire.resolve('vite/package.json')),
  'bin/vite.js',
);
const children = [
  spawn(
    process.execPath,
    [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'watch', 'src/main.ts'],
    { cwd: path.join(root, 'apps/api'), stdio: 'inherit' },
  ),
  spawn(process.execPath, [viteCli, '--port', '4173', '--strictPort'], {
    cwd: path.join(root, 'apps/extension'),
    stdio: 'inherit',
  }),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) {
  child.on('error', (error) => {
    console.error(error.message);
    stop();
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    if (!stopping) {
      stop();
      process.exitCode = code || 1;
    }
  });
}
