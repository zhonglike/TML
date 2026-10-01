/**
 * MONO — UI 无头渲染测试
 * 装载 DOM 桩 + 真实引擎 + 真实页面模块，逐个渲染并模拟一次常见操作，
 * 用于在没有浏览器的环境里抓 import/导出/渲染错误。
 *   node tests/ui.mjs
 */
import { installDom } from './dom-stub.mjs';

installDom();

const failures = [];
const ok = (cond, label, extra = '') => {
  if (cond) console.log(`  ok   ${label}${extra ? ' — ' + extra : ''}`);
  else {
    failures.push(label);
    console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`);
  }
};

console.log('\n== 模块加载 ==');
const T0 = Date.now();
let engine;
let S;
let VIEWS;
let NAV;
let quest;
let economy;
let loot;
let trade;
let auction;
let inv;
let market;
let ui;
let bagLimit;

try {
  engine = await import('../src/core/engine.js');
  ({ S, bagLimit } = await import('../src/core/state.js'));
  ({ VIEWS, NAV } = await import('../src/ui/views.js'));
  quest = await import('../src/systems/quest.js');
  economy = await import('../src/systems/economy.js');
  loot = await import('../src/systems/loot.js');
  trade = await import('../src/systems/trade.js');
  auction = await import('../src/systems/auction.js');
  inv = await import('../src/systems/inventory.js');
  market = await import('../src/core/market.js');
  ui = await import('../src/ui/ui.js');
  ok(true, '全部 UI 模块加载成功', `${Date.now() - T0}ms`);
} catch (e) {
  ok(false, '模块加载', e && e.message);
  console.error(e);
  process.exit(1);
}

// 仅加载入口做语法/副作用验证（不执行 bootApp，避免与测试抢状态）
try {
  await import('../src/main.js');
  ok(true, 'src/main.js 可被加载');
} catch (e) {
  ok(false, 'src/main.js 加载', e && e.message);
}

console.log('\n== 引擎启动 ==');
const en = engine.engine; // 内部状态对象（含 rng）
engine.boot('ui-test-seed');
ok(S.run.booted, '引擎 boot 完成', `seed=${S.__seed}`);
ok(!!en.rng && typeof en.rng.weightedIndex === 'function', 'RNG 可用');
ok(Object.keys(S.market).length > 500, '市场状态初始化', `${Object.keys(S.market).length} 项`);
ok(S.npcs.length === 18, 'NPC 初始化', `${S.npcs.length}`);

// 给玩家一点资源和库存，让页面有内容可渲染
S.player.cash = 500000;
S.player.level = 6;
S.player.rep = 400;
const drawRes = loot.drawMany(30, en.rng, {
  priceEach: 1000,
  charge: (n) => {
    S.player.cash -= n;
    return true;
  },
});
ok(drawRes.results.length === 30, '预置开箱', `${drawRes.results.length} 件`);

console.log('\n== 页面渲染 ==');
const ctx = {
  rng: en.rng,
  settings: S.settings,
  setSpeed: engine.setSpeed,
  setAlert: engine.setAlert,
  clearAlert: engine.clearAlert,
  itemOf: (id) => market.ITEMS ? null : null,
  dashboard: () => engine.dashboard(),
  watchlist: [],
  lastItemId: 'ak47-redline',
  ledger: () => {},
  go: () => {},
  back: () => {},
  newGame: () => {},
  loadSlot: async () => true,
  reload: () => {},
  saveSettings: () => {},
  resetMarket: () => {},
  haptic: () => {},
};
const { getItem } = await import('../src/core/catalog.js');
ctx.itemOf = getItem;

const viewsHost = document.getElementById('views');
const instances = {};
for (const id of Object.keys(VIEWS)) {
  const mod = VIEWS[id];
  try {
    const params = id === 'item' ? { id: 'ak47-redline' } : {};
    const inst = mod.create(ctx);
    instances[id] = inst;
    viewsHost.appendChild(inst.el);
    inst.el.classList.add('is-active');
    if (inst.onEnter) inst.onEnter(params);
    const nodes = inst.el.querySelectorAll('*').length;
    ok(nodes > 8, `页面 ${id} 渲染`, `${nodes} 个节点`);
  } catch (e) {
    ok(false, `页面 ${id} 渲染`, e && e.message);
    console.error('    ', (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n     ') : e));
  }
}

console.log('\n== 交互模拟 ==');
for (const id of Object.keys(instances)) {
  const inst = instances[id];
  try {
    const btns = inst.el.querySelectorAll('.btn');
    let clicked = 0;
    for (const b of btns.slice(0, 14)) {
      if (b.hasAttribute('disabled')) continue;
      b.click();
      clicked++;
    }
    const taps = inst.el.querySelectorAll('.item');
    for (const t of taps.slice(0, 2)) t.click();
    ok(true, `页面 ${id} 点击 ${clicked} 个按钮 / ${Math.min(2, taps.length)} 个条目无异常`);
  } catch (e) {
    ok(false, `页面 ${id} 交互`, e && e.message);
    console.error('    ', (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n     ') : e));
  }
}

console.log('\n== 增量刷新 ==');
try {
  for (let i = 0; i < 3; i++) {
    engine.advance(24);
    for (const id of Object.keys(instances)) {
      if (instances[id].onTick) instances[id].onTick();
    }
  }
  ok(true, '连续推进 3 天 + 全页面 onTick 无异常');
} catch (e) {
  ok(false, 'onTick 刷新', e && e.message);
  console.error('    ', (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n     ') : e));
}

console.log('\n== 弹窗 / 提示 ==');
try {
  // 先清掉交互模拟里可能残留的弹窗
  const layer = document.getElementById('layer');
  layer.children.slice().forEach((c) => c.remove());
  ui.toast('测试提示 <b>ok</b>', { kind: 'good' });
  const m = ui.modal({
    title: '测试弹窗',
    render: (body) => body.appendChild(ui.h('div', { text: '内容' })),
    foot: [ui.h('button.btn', { onclick: () => m.close() }, '关闭')],
  });
  ok(layer.children.length === 1, '弹窗挂载');
  m.close();
  ok(layer.children.length === 0, '弹窗关闭后移除');
  ok(document.getElementById('toasts').children.length >= 1, '提示已显示');
} catch (e) {
  ok(false, '弹窗/提示', e && e.message);
}

console.log('\n== 开箱轮盘（CS 式） ==');
try {
  const reel = await import('../src/ui/reel.js');
  const host = ui.h('div');
  document.getElementById('views').appendChild(host);
  const win = { def: getItem('butterfly-doppler-ruby'), inst: { wear: 'FN', float: 0.01, st: true, patternScore: 0.5 }, rarity: 'red', qty: 1 };
  const t0 = Date.now();
  let settled = false;
  await reel.playReel(host, win, {
    rng: en.rng,
    dur: 120,
    reduceMotion: false,
    onSettle: () => {
      settled = true;
    },
  });
  const cards = host.querySelectorAll('.reel__card');
  const hit = host.querySelectorAll('.reel__card.is-hit');
  ok(cards.length >= 30, '轮盘生成卡带', `${cards.length} 张`);
  ok(settled, '轮盘回调触发');
  ok(hit.length === 1, '唯一中奖卡被标记', `${hit.length} 张`);
  const winnerCards = host.querySelectorAll('.reel__card.is-winner');
  ok(
    winnerCards.length === 1 && winnerCards[0].dataset.item === win.def.id,
    '中奖卡就是抽到的物品',
    winnerCards[0] ? winnerCards[0].dataset.item : '-',
  );
  const marker = host.querySelectorAll('.reel__marker');
  ok(marker.length === 1, '存在判定标记线');
  ok(Date.now() - t0 < 4000, '动画时长可控', `${Date.now() - t0}ms`);

  // 十连：首抽完整播放 + 其余快速扫过
  const host2 = ui.h('div');
  document.getElementById('views').appendChild(host2);
  const results = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => {
    const def = getItem(i % 2 ? 'ak47-redline' : 'm4a4-black-mirage');
    return { def, inst: { wear: 'FT', float: 0.3 }, rarity: def.rarity, qty: 1 };
  });
  await reel.playMultiReel(host2, results, { rng: en.rng, firstDur: 100, reduceMotion: false });
  ok(host2.querySelectorAll('.reel__card').length >= 10, '十连轮盘渲染', `${host2.querySelectorAll('.reel__card').length} 张`);

  // 降低动效时应当立即落位
  const host3 = ui.h('div');
  document.getElementById('views').appendChild(host3);
  const t1 = Date.now();
  await reel.playReel(host3, win, { rng: en.rng, dur: 5000, reduceMotion: true });
  ok(Date.now() - t1 < 300, '开启「关闭动效」后立即落位', `${Date.now() - t1}ms`);
} catch (e) {
  ok(false, '开箱轮盘', e && e.message);
  console.error('    ', (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n     ') : e));
}

console.log('\n== 存档往返（localStorage 路径） ==');
try {
  const save = await import('../src/core/save.js');
  const before = S.player.cash;
  await save.save(0, { silent: true });
  S.player.cash = 12345;
  const r = await save.load(0);
  ok(r.ok, '读档成功');
  ok(Math.abs(S.player.cash - before) < 1, '现金被正确恢复', `${S.player.cash} vs ${before}`);
  const idx = save.slotIndex();
  ok(idx.length === 1 && idx[0].slot === 0, '存档索引写入', JSON.stringify(idx[0] || {}));
} catch (e) {
  ok(false, '存档往返', e && e.message);
  console.error('    ', (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n     ') : e));
}

console.log(`\n结果：${failures.length ? failures.length + ' 项失败 → ' + failures.join(' / ') : '全部通过'}\n`);
process.exit(failures.length ? 1 : 0);
