import { copyFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.resolve(root, '../../.env'), quiet: true });
const url = new URL(process.env.VITE_API_URL || 'http://localhost:3001');
if (
  url.protocol !== 'https:' &&
  !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
)
  throw new Error('VITE_API_URL must be HTTPS or localhost.');
const manifest = {
  manifest_version: 3,
  name: 'Coinchecker',
  version: '1.0.0',
  description: 'Understand token risks, history, and the evidence behind every finding.',
  minimum_chrome_version: '116',
  author: 'Darkartt',
  permissions: ['activeTab', 'sidePanel', 'storage', 'alarms'],
  optional_permissions: ['notifications'],
  host_permissions: [`${url.protocol}//${url.hostname}/*`],
  optional_host_permissions: [
    'https://etherscan.io/*',
    'https://basescan.org/*',
    'https://dexscreener.com/*',
    'https://app.uniswap.org/*',
    'https://*/*',
    'http://localhost/*',
    'http://127.0.0.1/*',
  ],
  background: { service_worker: 'service-worker.js', type: 'module' },
  side_panel: { default_path: 'index.html' },
  action: { default_title: 'Check token with Coinchecker' },
  icons: {
    16: 'assets/coinchecker-mark.png',
    48: 'assets/coinchecker-mark.png',
    128: 'assets/coinchecker-mark.png',
  },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'; base-uri 'none'",
  },
  commands: {
    _execute_action: {
      suggested_key: { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' },
      description: 'Open Coinchecker',
    },
  },
};
const destination = path.join(root, 'dist/client');
for (const name of ['index.html', 'service-worker.js', 'assets/coinchecker-mark.png'])
  if (!existsSync(path.join(destination, name)))
    throw new Error(`Missing extension asset: ${name}`);
writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
copyFileSync(path.join(root, 'public/privacy.html'), path.join(destination, 'privacy.html'));
console.log('Prepared Manifest V3 extension in dist/client.');
