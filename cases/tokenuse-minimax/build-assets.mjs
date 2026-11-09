#!/usr/bin/env node
/**
 * TokenUse · MiniMax 三模态发布视频 —— 真实图标资产提取器
 *
 * 把 Sources/TokenUse/Resources/ 下的真实品牌图标编码进 window.ASSETS，
 * 供 index.html 以 <img src="data:image/png;base64,..."> 渲染。
 * 严禁手敲伪造图标 —— 全部来自仓库真实资源。
 *
 * 处理：
 *   AppIcon.icns            -> sips 转 PNG -> 320px 缩略
 *   provider-*.png          -> sips 缩略到 320px
 *   working-mascot.png      -> sips 缩略到 320px
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const RES = path.join(REPO, 'Sources', 'TokenUse', 'Resources');
const TMP = path.join(HERE, '.tmp', 'icons');
fs.mkdirSync(TMP, { recursive: true });

const sips = (args) => execFileSync('/usr/bin/sips', args, { stdio: ['ignore', 'pipe', 'pipe'] });

/** 把任意源图（png/icns）归一化成 <=320px 的 PNG，返回字节 */
function normalize(source, outName) {
  const raw = path.join(TMP, outName);
  const thumb = path.join(TMP, outName.replace(/\.png$/, '-thumb.png'));

  if (source.toLowerCase().endsWith('.icns')) {
    sips(['-s', 'format', 'png', source, '--out', raw]);
  } else {
    fs.copyFileSync(source, raw);
  }
  sips(['-Z', '320', raw, '--out', thumb]);
  return fs.readFileSync(thumb);
}

const PROVIDERS = ['codex', 'antigravity', 'mimo', 'kimi', 'minimax'];

const assets = {};

/* --- 应用图标 --- */
const icns = path.join(RES, 'AppIcon.icns');
if (fs.existsSync(icns)) {
  assets.appIcon = normalize(icns, 'appicon.png');
  console.log(`✓ appIcon  <- AppIcon.icns  (${assets.appIcon.length}B)`);
}

/* --- 5 大平台品牌图标 --- */
for (const p of PROVIDERS) {
  const src = path.join(RES, `provider-${p}.png`);
  if (!fs.existsSync(src)) throw new Error(`缺少品牌图标: ${src}`);
  assets[p] = normalize(src, `provider-${p}.png`);
  console.log(`✓ ${p}  <- provider-${p}.png  (${assets[p].length}B)`);
}

/* --- 吉祥物 --- */
const mascot = path.join(RES, 'working-mascot.png');
if (fs.existsSync(mascot)) {
  assets.mascot = normalize(mascot, 'mascot.png');
  console.log(`✓ mascot  <- working-mascot.png  (${assets.mascot.length}B)`);
}

const dataUri = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

const lines = [
  '/* TokenUse 真实图标资产 —— 由 build-assets.mjs 从 Sources/TokenUse/Resources/ 自动生成，请勿手改 */',
  'window.ASSETS = {',
];
for (const [k, v] of Object.entries(assets)) {
  lines.push(`  ${k}: ${JSON.stringify(dataUri(v))},`);
}
lines.push('};');
lines.push('');

fs.writeFileSync(path.join(HERE, 'assets.js'), lines.join('\n'), 'utf8');
console.log(`\n✓ assets.js 已写入 (${Object.keys(assets).length} 个真实图标)`);
