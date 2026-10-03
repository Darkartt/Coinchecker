import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve('apps/extension/dist/client');
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.author, 'Darkartt');
assert.equal(manifest.background.type, 'module');
assert.deepEqual(
  manifest.permissions.sort(),
  ['activeTab', 'alarms', 'sidePanel', 'storage'].sort(),
);
for (const file of [
  manifest.side_panel.default_path,
  manifest.background.service_worker,
  ...Object.values(manifest.icons),
  'privacy.html',
  'THIRD_PARTY_NOTICES.txt',
])
  assert.ok(existsSync(path.join(root, file)), `Missing ${file}`);
const files = [];
function walk(dir) {
  for (const item of readdirSync(dir)) {
    const file = path.join(dir, item);
    statSync(file).isDirectory() ? walk(file) : files.push(file);
  }
}
walk(root);
for (const file of files) {
  assert.ok(
    !/\.env|node_modules|\.map$/.test(path.relative(root, file)),
    `Private or development file in extension: ${file}`,
  );
  if (/\.(js|html)$/.test(file)) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!/script[^>]+src=["']https?:/i.test(text), 'Remote executable code');
    assert.ok(!/eval\s*\(|new Function\(/.test(text), `Unsafe code generation in ${file}`);
  }
}
assert.ok(readFileSync(path.join(root, 'privacy.html'), 'utf8').includes('browsing history'));
const notices = readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
for (const dependency of [
  '@fontsource/inter',
  '@tabler/icons-react',
  'react',
  'react-dom',
  'recharts',
])
  assert.ok(notices.includes(`${dependency}@`), `Missing licence for ${dependency}`);
assert.ok(notices.includes('SIL OPEN FONT LICENSE'), 'Missing bundled font licence');
assert.ok(notices.includes('MIT License'), 'Missing bundled library licence');
assert.ok(
  manifest.host_permissions.every(
    (p) =>
      p.startsWith('https://') ||
      p.startsWith('http://localhost/') ||
      p.startsWith('http://127.0.0.1/'),
  ),
);
console.log(
  `Manifest V3 package verified: ${files.length} bundled files; read-only permissions; no remote scripts or source maps.`,
);
