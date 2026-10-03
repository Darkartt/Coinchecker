import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

function licenseFiles(directory, prefix = '') {
  const matches = [];
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, item.name);
    if (item.isDirectory() && !['node_modules', '.git'].includes(item.name))
      matches.push(...licenseFiles(path.join(directory, item.name), relative));
    else if (item.isFile() && /^(?:LICEN[CS]E|COPYING|NOTICE)(?:[._-].*)?$/i.test(item.name))
      matches.push(relative);
  }
  return matches.sort();
}

export function bundledLicenses() {
  return {
    name: 'coinchecker-bundled-licenses',
    generateBundle() {
      const packages = new Map();
      for (const id of this.getModuleIds()) {
        if (id.startsWith('\0') || !id.replaceAll('\\', '/').includes('/node_modules/')) continue;
        let directory = path.dirname(id.split('?')[0]);
        while (directory !== path.dirname(directory)) {
          const manifestPath = path.join(directory, 'package.json');
          if (existsSync(manifestPath)) {
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
            if (manifest.name && manifest.version) {
              packages.set(directory, manifest);
              break;
            }
          }
          directory = path.dirname(directory);
        }
      }

      const notices = [];
      for (const [directory, manifest] of [...packages].sort((a, b) =>
        `${a[1].name}@${a[1].version}`.localeCompare(`${b[1].name}@${b[1].version}`),
      )) {
        const files = licenseFiles(directory);
        if (!files.length)
          this.error(`Missing dependency licence notice: ${manifest.name}@${manifest.version}`);
        const licenseLabel = typeof manifest.license === 'string' ? manifest.license : 'See below';
        notices.push(
          `${manifest.name}@${manifest.version} — ${licenseLabel}\n${'='.repeat(72)}\n` +
            files
              .map(
                (name) => `${name}\n\n${readFileSync(path.join(directory, name), 'utf8').trim()}`,
              )
              .join('\n\n'),
        );
      }
      if (!notices.length) this.error('No bundled dependency licence notices were found.');
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_NOTICES.txt',
        source:
          'Coinchecker — bundled dependency licences\n\n' +
          'These notices apply to the third-party libraries and fonts distributed with this package.\n\n' +
          notices.join('\n\n') +
          '\n',
      });
    },
  };
}
