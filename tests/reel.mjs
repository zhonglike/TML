/**
 * MONO — 开箱轮盘落位测试
 * 复现真机故障场景：容器宽度在首帧测不到（clientWidth = 0，元素刚插入 / 父级还没布局），
 * 旧实现会把落位位移算成「把卡带推出屏幕」，表现就是「滚过几张后停在空白」。
 *   node tests/reel.mjs
 */
import { installDom } from './dom-stub.mjs';

const { doc, win } = installDom();
win.innerWidth = 375;
doc.documentElement.clientWidth = 375;

const engine = await import('../src/core/engine.js');
const { getItem } = await import('../src/core/catalog.js');
const reel = await import('../src/ui/reel.js');
const { S } = await import('../src/core/state.js');

engine.boot('reel-layout');
S.player.cash = 100000;

const CARD_W = 112;
const STEP = CARD_W + 8;

const failures = [];
const ok = (cond, label, extra = '') => {
  if (cond) console.log(`  ok   ${label}${extra ? ' — ' + extra : ''}`);
  else {
    failures.push(label);
    console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`);
  }
};

/** 读取 translate3d 的 x */
function translateXOf(el) {
  const t = (el.style && el.style.transform) || '';
  const m = t.match(/translate3d\(\s*(-?[\d.]+)px/);
  return m ? Number(m[1]) : 0;
}

/** 计算「标记线位置」与「中奖卡中心」的偏差 */
function missBy(host, winDef, viewWidth) {
  const track = host.querySelector('.reel__track');
  const cards = host.querySelectorAll('.reel__card');
  const winner = cards.find((c) => c.classList.contains('is-winner'));
  if (!track || !winner) return null;
  const x = translateXOf(track);
  const idx = cards.indexOf(winner);
  const cardCenterInTrack = idx * STEP + CARD_W / 2;
  const cardCenterOnScreen = cardCenterInTrack + x;
  return { miss: Math.abs(cardCenterOnScreen - viewWidth / 2), center: viewWidth / 2, got: cardCenterOnScreen, idx, x };
}

const WIN_DEF = getItem('butterfly-doppler-ruby');
const winner = { def: WIN_DEF, inst: { wear: 'FN', float: 0.01, st: true }, rarity: 'red', qty: 1 };

/**
 * 测试桩没有真实布局，元素宽度默认是 0。
 * 这里模拟浏览器：把一个宽度赋给 shell，并沿子树向下传播
 * （浏览器里 block 容器的宽度就是这样继承下来的）。
 */
function attach(shellW, hostW = shellW) {
  const shell = document.createElement('div');
  shell.clientWidth = shellW;
  const host = document.createElement('div');
  host.clientWidth = hostW;
  shell.appendChild(host);
  document.getElementById('views').appendChild(shell);
  return host;
}

/** 把宽度往下传播给宿主子树（模拟 CSS width:100%） */
function layout(host, w) {
  const stack = [host];
  while (stack.length) {
    const n = stack.pop();
    n.clientWidth = w;
    for (const c of n.children || []) if (c && typeof c.tagName === 'string') stack.push(c);
  }
}

const syncReelWidth = layout;

console.log('\n== 轮盘落位 ==\n');

// 场景 A：容器能正常量到宽度
{
  const host = attach(343);
  const p = reel.playReel(host, winner, { rng: engine.engine.rng, reduceMotion: true });
  layout(host, 343);           // 挂载后布局生效（浏览器里 clientWidth 会强制回流）
  await p;
  const r = missBy(host, WIN_DEF, 343);
  ok(r && r.miss < 24, '正常宽度下中奖卡落在标记线附近', r ? `偏差 ${r.miss.toFixed(1)}px` : '未找到中奖卡');
  ok(r && r.x < 0, '卡带位移方向正确（向左滚动）', r ? `x=${r.x.toFixed(1)}` : '-');
}

// 场景 B：容器首帧量不到宽度（真机故障），靠父级兜底
{
  const host = attach(343, 0); // host 量不到，父级 343
  const p = reel.playReel(host, winner, { rng: engine.engine.rng, reduceMotion: true });
  // 只把宽度给父级和轮盘自身，host 仍然是 0 —— 复现「宿主测不到宽度」
  const shell = host.parentElement;
  shell.clientWidth = 343;
  const reelEl = host.querySelector('.reel');
  if (reelEl) reelEl.clientWidth = 343;
  await p;
  const r = missBy(host, WIN_DEF, 343);
  ok(r && r.miss < 24, '宽度测不到时用父级兜底，仍落在标记线', r ? `偏差 ${r.miss.toFixed(1)}px` : '未找到中奖卡');
  ok(r && r.x < -100 && r.x > -(44 * STEP), '位移是合理负数（不再把卡带推出屏幕）', r ? `x=${r.x.toFixed(1)}` : '-');
}

// 场景 C：极窄屏（320px）
{
  const host = attach(288);
  const p = reel.playReel(host, winner, { rng: engine.engine.rng, reduceMotion: true });
  layout(host, 288);
  await p;
  const r = missBy(host, WIN_DEF, 288);
  ok(r && r.miss < 24, '320px 窄屏落位正确', r ? `偏差 ${r.miss.toFixed(1)}px` : '未找到中奖卡');
}

// 场景 D：十连 —— 首件不重复出现在快速条里
{
  const host = attach(343);
  const results = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => {
    const def = getItem(i % 2 ? 'ak47-redline' : 'm4a4-black-mirage');
    return { def, inst: { wear: 'FT', float: 0.3 }, rarity: def.rarity, qty: 1 };
  });
  const p = reel.playMultiReel(host, results, { rng: engine.engine.rng, firstDur: 0, reduceMotion: true });
  layout(host, 343);
  await p;
  const fast = host.querySelectorAll('.reel__fast .reel__card');
  ok(fast.length === results.length - 1, '十连快速条只列其余结果（首件不重复）', `${fast.length} 张 / 应为 ${results.length - 1}`);
  const txt = host.querySelector('.hint') ? host.querySelector('.hint').textContent : '';
  ok(/共 10 件/.test(txt), '快速条标注总件数', txt.slice(0, 30));
}

// 场景 E：轮盘卡带长度足够，落位后左右都还有卡（不会顶到边缘出现空白）
{
  const host = attach(343);
  const p = reel.playReel(host, winner, { rng: engine.engine.rng, reduceMotion: true });
  layout(host, 343);
  await p;
  const cards = host.querySelectorAll('.reel__card');
  const track = host.querySelector('.reel__track');
  const x = translateXOf(track);
  const idx = cards.findIndex((c) => c.classList.contains('is-winner'));
  const rightEdge = idx * STEP + CARD_W + x;   // 中奖卡右边缘在屏幕上的位置
  const leftRemain = idx * STEP + x;
  ok(cards.length - idx >= 3, '中奖卡右侧仍有卡（落位处不会立刻空白）', `右侧 ${cards.length - idx - 1} 张`);
  ok(leftRemain > 0, '中奖卡左侧仍在卡带内', `左侧剩余 ${leftRemain.toFixed(0)}px`);
  ok(rightEdge > 100 && rightEdge < 343 + 200, '中奖卡落在可视区内', `右边缘 ${rightEdge.toFixed(0)}px`);
}

console.log(`\n结果：${failures.length ? failures.length + ' 项失败 → ' + failures.join(' / ') : '全部通过'}\n`);
process.exit(failures.length ? 1 : 0);
