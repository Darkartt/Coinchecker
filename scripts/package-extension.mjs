import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { zipSync } from 'fflate';
await import('./verify-package.mjs');
const root = path.resolve('apps/extension/dist/client'),
  files = {};
function walk(dir) {
  for (const item of readdirSync(dir)) {
    const file = path.join(dir, item);
    if (statSync(file).isDirectory()) walk(file);
    else
      files[path.relative(root, file).replaceAll('\\', '/')] = new Uint8Array(readFileSync(file));
  }
}
walk(root);
mkdirSync('artifacts', { recursive: true });
const zip = zipSync(files, { level: 6 }),
  filename = 'coinchecker-extension-1.0.0.zip';
writeFileSync(path.join('artifacts', filename), zip);
const sha = createHash('sha256').update(zip).digest('hex');
writeFileSync(path.join('artifacts', filename + '.sha256'), `${sha}  ${filename}\n`);
console.log(
  `Packaged artifacts/${filename} (${Math.round(zip.length / 1024)} KiB). SHA-256 ${sha}`,
);
