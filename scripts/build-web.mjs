/**
 * MONO — 移动端打包输入（零依赖）
 * Capacitor 需要一个独立的 webDir，而 GitHub Pages 需要仓库根目录。
 * 这个脚本把「仓库根目录里的游戏文件」复制成一份干净的打包输入：
 *   desktop/../dist/index.html
 *   desktop/../dist/src/...
 *   desktop/../dist/assets/...
 * 因为游戏里所有路径都是相对路径（./src/...、assets/...），所以整套照搬即可运行。
 *
 *   node scripts/build-web.mjs
 */
import { cp, mkdir, rm, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist');

const INCLUDE = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'src',
  'assets',
  'data',
  'CNAME',
  'LICENSE',
];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

let files = 0;
let bytes = 0;

async function measure(p) {
  const s = await stat(p);
  if (s.isDirectory()) {
    for (const e of await readdir(p)) await measure(join(p, e));
  } else {
    files++;
    bytes += s.size;
  }
}

for (const name of INCLUDE) {
  const src = join(ROOT, name);
  const s = await stat(src).catch(() => null);
  if (!s) continue;
  const dst = join(OUT, name);
  await cp(src, dst, { recursive: true });
  await measure(dst);
}

// 打包输入提示文件（不进仓库根目录，避免与 Pages 冲突）
await writeFile(
  join(OUT, 'BUILD-INFO.txt'),
  `MONO static build\n` +
  `generated: ${new Date().toISOString()}\n` +
  `files: ${files}\n` +
  `bytes: ${bytes}\n` +
  `用途：Capacitor(android) / 任意静态托管 / 离线分发\n`,
  'utf8',
);

console.log(`dist/ 已生成：${files} 个文件 · ${(bytes / 1024).toFixed(1)} KB`);
console.log('  · Capacitor: cd mobile && npx cap sync android && npx cap open android');
console.log('  · Electron : cd desktop && npm start');
