import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const resources = resolve(root, '../Sources/TokenUse/Resources');
const assets = {};
const temporary = [];

function png(path) {
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

function shrink(source, target, size, format = false) {
  temporary.push(target);
  const args = format
    ? ['-s', 'format', 'png', '-Z', String(size), source, '--out', target]
    : ['-Z', String(size), source, '--out', target];
  execFileSync('/usr/bin/sips', args, { stdio: 'ignore' });
  return png(target);
}

try {
  for (const provider of ['codex', 'antigravity', 'mimo', 'kimi', 'minimax']) {
    assets[provider] = png(join(resources, `provider-${provider}.png`));
  }
  assets.mascot = shrink(
    join(resources, 'working-mascot.png'),
    join(root, '.working-mascot-320.png'),
    320,
  );
  assets.appIcon = shrink(
    join(resources, 'AppIcon.icns'),
    join(root, '.app-icon-512.png'),
    512,
    true,
  );
  writeFileSync(
    join(root, 'assets.js'),
    `window.ASSETS = Object.freeze(${JSON.stringify(assets)});\n`,
  );
  console.log(`assets.js: ${Object.keys(assets).join(', ')}`);
} finally {
  for (const path of temporary) rmSync(path, { force: true });
}
