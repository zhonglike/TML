/**
 * MONO — 发布检查
 * 在提交/推送前跑一遍：语法检查全部模块 + 冒烟测试 + 资源完整性检查。
 *   node scripts/release.mjs
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (cond, msg, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

/* 1. 语法检查（只对 src/scripts/tests，跳过生成的数据文件以免拖慢） */
async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      await walk(p, out);
    } else if (['.js', '.mjs'].includes(extname(e.name))) out.push(p);
  }
  return out;
}

const files = [];
await walk(join(ROOT, 'src'), files);
await walk(join(ROOT, 'scripts'), files);
await walk(join(ROOT, 'tests'), files);
let bad = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    bad++;
    console.log(` FAIL  syntax ${f.replace(ROOT, '.')}`);
    console.log(String(e.stderr || e.message).split('\n').slice(0, 4).join('\n'));
  }
}
ok(bad === 0, `语法检查 ${files.length} 个模块`, `${bad} 个失败`);

/* 2. 关键文件存在性 */
const required = [
  'index.html', 'manifest.webmanifest', 'sw.js', 'CNAME', 'README.md',
  'assets/icons/favicon.svg', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
  'src/main.js', 'src/styles/main.css',
  'src/core/const.js', 'src/core/util.js', 'src/core/rng.js', 'src/core/catalog.js',
  'src/core/state.js', 'src/core/market.js', 'src/core/engine.js', 'src/core/save.js', 'src/core/idb.js',
  'src/data/catalog-cs2.js', 'src/data/catalog-compute.js', 'src/data/catalog-hardware.js', 'src/data/catalog-assets.js',
  'src/systems/loot.js', 'src/systems/economy.js', 'src/systems/inventory.js',
  'src/systems/trade.js', 'src/systems/auction.js', 'src/systems/npc.js', 'src/systems/quest.js',
  'src/ui/ui.js', 'src/ui/charts.js', 'src/ui/sound.js', 'src/ui/views.js',
  'src/ui/views/dashboard.js', 'src/ui/views/bag.js', 'src/ui/views/draw.js', 'src/ui/views/market.js',
  'src/ui/views/item.js', 'src/ui/views/orders.js', 'src/ui/views/auction.js', 'src/ui/views/records.js',
  'src/ui/views/quests.js', 'src/ui/views/settings.js',
  'data/prices.seed.json', 'desktop/main.cjs', 'desktop/package.json',
  'mobile/capacitor.config.json', 'mobile/package.json',
  '.github/workflows/pages.yml',
];
for (const f of required) {
  const s = await stat(join(ROOT, f)).catch(() => null);
  ok(s && s.size > 0, `存在 ${f}`);
}

/* 3. index.html / sw.js 引用的本地资源必须存在 */
const html = await readFile(join(ROOT, 'index.html'), 'utf8');
const refs = Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g))
  .map((m) => m[1])
  .filter((u) => !u.startsWith('http') && !u.startsWith('data:') && !u.startsWith('#'));
for (const r of refs) {
  const s = await stat(join(ROOT, r)).catch(() => null);
  ok(!!s, `index.html 引用 ${r}`);
}
const swText = await readFile(join(ROOT, 'sw.js'), 'utf8');
const swRefs = Array.from(swText.matchAll(/'\.\/([^']+)'/g)).map((m) => m[1]);
let swBad = [];
for (const r of swRefs) {
  if (r === '') continue;
  const s = await stat(join(ROOT, r)).catch(() => null);
  if (!s) swBad.push(r);
}
ok(swBad.length === 0, `sw.js 预缓存清单 ${swRefs.length} 项全部存在`, swBad.join(', '));

/* 4. 冒烟测试（引擎 / 经济 / 市场） */
console.log('\n  → 运行冒烟测试');
let smokeOk = true;
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'tests/smoke.mjs')], { stdio: 'pipe', encoding: 'utf8' });
  const tail = out.trim().split('\n').slice(-6).join('\n');
  console.log(tail.split('\n').map((l) => '    ' + l).join('\n'));
  if (!/全部通过/.test(out)) smokeOk = false;
} catch (e) {
  smokeOk = false;
  console.log(String(e.stdout || '').split('\n').slice(-12).map((l) => '    ' + l).join('\n'));
  console.log(String(e.stderr || e.message).split('\n').slice(0, 6).map((l) => '    ' + l).join('\n'));
}
ok(smokeOk, '冒烟测试通过');

/* 5. UI 无头渲染测试（页面 / 交互 / 存档往返） */
console.log('\n  → 运行 UI 渲染测试');
let uiOk = true;
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'tests/ui.mjs')], { stdio: 'pipe', encoding: 'utf8' });
  const lines = out.trim().split('\n');
  console.log(lines.slice(-4).map((l) => '    ' + l).join('\n'));
  if (!/全部通过/.test(out)) uiOk = false;
} catch (e) {
  uiOk = false;
  console.log(String(e.stdout || '').split('\n').filter((l) => /FAIL/.test(l)).slice(0, 10).map((l) => '    ' + l).join('\n'));
  console.log(String(e.stderr || e.message).split('\n').slice(0, 6).map((l) => '    ' + l).join('\n'));
}
ok(uiOk, 'UI 渲染测试通过');

/* 6. 启动回归测试：真的把 src/main.js 启动一遍（抓只有启动才暴露的错误） */
console.log('\n  → 运行启动回归测试');
let bootOk = true;
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'tests/boot.mjs')], { stdio: 'pipe', encoding: 'utf8' });
  const lines = out.trim().split('\n');
  console.log(lines.slice(-3).map((l) => '    ' + l).join('\n'));
  if (!/全部通过/.test(out)) bootOk = false;
} catch (e) {
  bootOk = false;
  console.log(String(e.stdout || '').split('\n').filter((l) => /FAIL|boot failed/.test(l)).slice(0, 8).map((l) => '    ' + l).join('\n'));
  console.log(String(e.stderr || e.message).split('\n').slice(0, 6).map((l) => '    ' + l).join('\n'));
}
ok(bootOk, '启动回归测试通过');

/* 7. 移动端适配审计：按多种手机宽度渲染所有页面，检查溢出 */
console.log('\n  → 运行移动端适配审计');
let mobileOk = true;
for (const w of [320, 375, 414, 430]) {
  try {
    const out = execFileSync(process.execPath, [join(ROOT, 'tests/mobile.mjs'), String(w)], { stdio: 'pipe', encoding: 'utf8' });
    const m = out.match(/合计 (\d+) 处/);
    const n = m ? Number(m[1]) : -1;
    if (n !== 0) {
      mobileOk = false;
      console.log(`    FAIL @${w}px — ${n} 处问题`);
      out.split('\n').filter((l) => /·|\[/.test(l)).slice(0, 6).forEach((l) => console.log('      ' + l.trim()));
    } else {
      console.log(`    ok   @${w}px 无溢出`);
    }
  } catch (e) {
    mobileOk = false;
    console.log(`    FAIL @${w}px 审计执行失败`);
    console.log(String(e.stdout || '').split('\n').filter((l) => /\[|·/.test(l)).slice(0, 6).map((l) => '      ' + l.trim()).join('\n'));
  }
}
ok(mobileOk, '移动端适配审计通过（320 / 375 / 414 / 430px）');

/* 8. 开箱轮盘落位测试 */
console.log('\n  → 运行开箱轮盘落位测试');
let reelOk = true;
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'tests/reel.mjs')], { stdio: 'pipe', encoding: 'utf8' });
  if (!/全部通过/.test(out)) reelOk = false;
  out.trim().split('\n').slice(-4).forEach((l) => console.log('    ' + l));
} catch (e) {
  reelOk = false;
  console.log(String(e.stdout || '').split('\n').filter((l) => /FAIL/.test(l)).slice(0, 8).map((l) => '    ' + l.trim()).join('\n'));
}
ok(reelOk, '开箱轮盘落位测试通过');

/* 9. 手机比例审计：按真实机型宽高检查 appbar 挤压、图表/轮盘尺寸、视口留白 */
console.log('\n  → 运行手机比例审计');
let ratioOk = true;
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'tests/ratios.mjs')], { stdio: 'pipe', encoding: 'utf8' });
  const tail = out.trim().split('\n').slice(-3).join('\n');
  console.log(tail.split('\n').map((l) => '    ' + l).join('\n'));
  if (!/硬性问题 0 项/.test(out)) ratioOk = false;
} catch (e) {
  ratioOk = false;
  console.log(String(e.stdout || '').split('\n').filter((l) => /FAIL/.test(l)).slice(0, 8).map((l) => '    ' + l.trim()).join('\n'));
}
ok(ratioOk, '手机比例审计通过（10 组机型）');

/* 10. 拍卖行显示完整性：不得出现 undefined */
console.log('\n  → 运行拍卖行显示测试');
let aucOk = true;
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'tests/auction.mjs')], { stdio: 'pipe', encoding: 'utf8' });
  console.log(out.trim().split('\n').slice(-3).map((l) => '    ' + l).join('\n'));
  if (!/全部通过/.test(out)) aucOk = false;
} catch (e) {
  aucOk = false;
  console.log(String(e.stdout || '').split('\n').filter((l) => /fail|FAIL/.test(l)).slice(0, 8).map((l) => '    ' + l.trim()).join('\n'));
}
ok(aucOk, '拍卖行显示测试通过（无 undefined / 跨存档可还原）');

console.log(`\n${fails === 0 ? '发布检查全部通过。' : fails + ' 项检查失败。'}\n`);
process.exit(fails ? 1 : 0);
