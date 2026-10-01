/**
 * MONO — 拍卖行显示完整性测试
 * 复现「拍卖显示 NPC 为 undefined」：随机生成大量 NPC 拍卖 + 玩家送拍，
 * 推进到落槌，检查每一个会展示给用户的字符串都不是 undefined / 空。
 *   node tests/auction.mjs
 */
import { installDom } from './dom-stub.mjs';
installDom();

const engine = await import('../src/core/engine.js');
const { S } = await import('../src/core/state.js');
const auction = await import('../src/systems/auction.js');
const { getItem } = await import('../src/core/catalog.js');

engine.boot('auction-audit');
S.player.cash = 400000;
S.player.level = 10;

const failures = [];
const ok = (cond, label, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'fail'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures.push(label);
};

/** 一个字符串是否「坏」：undefined / null / 空 / 字面量 undefined */
const bad = (v) => {
  if (v == null) return true;
  const s = String(v).trim();
  return s === '' || s === 'undefined' || s === 'null' || s.includes('undefined') || s.includes('NaN');
};

console.log('\n== NPC 拍卖生成（200 次） ==');
let undefinedSeller = 0;
let undefinedBidder = 0;
let totalBids = 0;
let emptyBidders = 0;
for (let i = 0; i < 200; i++) {
  const a = auction.spawnNpcAuction(engine.engine.rng);
  if (!a) continue;
  if (bad(a.sellerName)) undefinedSeller++;
  if (!a.bidders || a.bidders.length === 0) emptyBidders++;
  for (const h of a.history || []) {
    totalBids++;
    if (bad(h.who)) undefinedBidder++;
  }
}
ok(undefinedSeller === 0, 'sellerName 永不为空/undefined', `200 次生成中 ${undefinedSeller} 次异常`);
ok(undefinedBidder === 0, '出价人名字永不为空/undefined', `${totalBids} 条出价中 ${undefinedBidder} 条异常`);
console.log(`        （空买家数组 ${emptyBidders} 次 —— 这正是 sellerName 会变 undefined 的成因）`);

console.log('\n== 推进 30 天，逐场检查 ==');
const live = () => S.player.auctions.filter((a) => a.status === 'live');
// 先生成一批，再推进，覆盖「中途加价 / 落槌 / 流拍」
for (let i = 0; i < 24; i++) auction.spawnNpcAuction(engine.engine.rng);
ok(live().length > 0, '存在进行中的拍卖', `${live().length} 场`);

let checked = 0;
let issues = [];
for (let d = 0; d < 30; d++) {
  engine.advance(24);
  for (const a of S.player.auctions) {
    checked++;
    const def = getItem(a.itemId);
    if (bad(a.name)) issues.push(`title:${a.itemId}`);
    if (bad(a.sellerName)) issues.push(`seller:${a.name}`);
    if (a.high && bad(a.high.name)) issues.push(`highName:${a.name}`);
    if (a.status !== 'live' && a.status !== 'unsold' && bad(a.winner)) issues.push(`winner:${a.name}`);
    if (!def) issues.push(`item:${a.itemId}`);
    for (const h of a.history || []) if (bad(h.who)) issues.push(`bid:${a.name}`);
  }
  if (issues.length) break;
}
ok(issues.length === 0, '归档/落槌后所有展示字段完整', issues.length ? `异常：${issues.slice(0, 6).join(', ')}` : `检查 ${checked} 场次`);

console.log('\n== 玩家送拍 ==');
{
  const inv = await import('../src/systems/inventory.js');
  const loot = await import('../src/systems/loot.js');
  loot.drawMany(6, engine.engine.rng, { priceEach: 500, charge: () => true });
  const entry = inv.bagEntries({ sort: 'price-desc' })[0];
  const r = auction.createAuction(entry.key, 1, entry.unitValue * 0.8, entry.unitValue * 1.6);
  ok(r.ok, '玩家可送拍', r.ok ? '' : String(r.reason));
  if (r.ok) {
    const a = r.auction;
    ok(!bad(a.sellerName), '玩家拍品 sellerName 正常', String(a.sellerName));
    ok(!bad(a.name), '玩家拍品名称正常', String(a.name));
    for (let d = 0; d < 20 && a.status === 'live'; d++) engine.advance(24);
    ok(a.status !== 'live', '玩家拍品已结算', String(a.status));
    if (a.status === 'sold') ok(!bad(a.winner), '落槌后显示买家名', String(a.winner));
  }
}

console.log('\n== 界面渲染：不得出现 undefined 字样 ==');
{
  const { VIEWS } = await import('../src/ui/views.js');
  const ctx = {
    rng: engine.engine.rng,
    settings: S.settings,
    setSpeed: engine.setSpeed,
    setAlert: engine.setAlert,
    clearAlert: engine.clearAlert,
    itemOf: getItem,
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
  const inst = VIEWS.auction.create(ctx);
  document.getElementById('views').appendChild(inst.el);
  // 故意制造「失效的 NPC 引用」：把最高出价人换成不存在的 id，
  // 复现旧存档 / 跨版本读档后 id 对不上的情况，压测显示层兜底
  const liveOnes = S.player.auctions.filter((a) => a.status === 'live' && a.high);
  let poisoned = 0;
  for (const a of liveOnes.slice(0, 3)) {
    a.high = { who: 'npc-gone-999', name: undefined, price: a.high.price, at: a.high.at };
    a.history = [{ who: undefined, price: a.high.price, at: a.high.at, mine: false }];
    a.bidders = ['npc-gone-999'];
    poisoned++;
  }
  const doneOne = S.player.auctions.filter((a) => a.status !== 'live')[0];
  if (doneOne) {
    doneOne.winnerWho = 'npc-gone-999';
    doneOne.winner = undefined;
    poisoned++;
  }
  console.log(`        已注入 ${poisoned} 处失效 NPC 引用用于压测显示层`);

  for (const [tab, label] of [['live', '进行中'], ['mine', '我的'], ['done', '落槌']]) {
    const seg = inst.el.querySelectorAll('.segmented__item');
    const target = Array.from(seg).find((b) => b.textContent && b.textContent.includes(label));
    if (target) target.click();
    const text = inst.el.textContent || '';
    const hit = text.includes('undefined') || text.includes('NaN');
    ok(!hit, `拍卖「${tab}」分栏无 undefined/NaN`,
      hit ? '...' + text.slice(Math.max(0, text.indexOf('undefined') - 30), text.indexOf('undefined') + 20) + '...' : `${text.length} 字`);
  }

  // 出价记录弹窗同样不能出现 undefined
  const histBtn = Array.from(inst.el.querySelectorAll('.btn')).find((b) => /出价记录/.test(b.textContent || ''));
  if (histBtn) {
    histBtn.click();
    const layer = document.getElementById('layer');
    const t = layer.textContent || '';
    ok(!t.includes('undefined'), '出价记录弹窗无 undefined', t.slice(0, 60));
    layer.children.slice().forEach((c) => c.remove());
  }
}

console.log('\n== 跨存档：重启后再读档，NPC 引用必须仍能对上 ==');
{
  const save = await import('../src/core/save.js');
  // 先清掉压测注入的失效引用，再来一次「保存 → 重启 → 读档」的干净往返
  for (const a of S.player.auctions) {
    if (a.high && a.high.who === 'npc-gone-999') a.high = null;
    a.bidders = (a.bidders || []).filter((id) => id !== 'npc-gone-999');
    a.history = (a.history || []).filter((h) => h.who !== undefined);
  }
  // 模拟「关掉页面再打开」：先把存档内容记下来，再重启引擎（NPC 重建），最后读档。
  // 注意顺序：boot 必须在诊断之前 —— 否则 boot 内部的市场 tick 会推进游戏日，
  // 而日子变化会触发自动保存，把引擎状态写回存档。
  const namesBeforeSave = S.npcs.map((n) => n.name).join(',');
  const liveBeforeSave = S.player.auctions.filter((a) => a.status === 'live').length;
  const cashBeforeSave = S.player.cash;
  await save.save(0, { silent: true });

  engine.boot('reload-sim');
  ok(S.npcs.map((n) => n.name).join(',') !== namesBeforeSave,
    '重启后 NPC 已经变了（证明确实是重启场景）', S.npcs[0].name);

  const r = await save.load(0);
  ok(r.ok, '读档成功');
  ok(S.npcs.map((n) => n.name).join(',') === namesBeforeSave,
    '读档后 NPC 名字完全还原为存档内容', `${S.npcs.length} 位`);
  ok(S.player.auctions.filter((a) => a.status === 'live').length === liveBeforeSave,
    '读档后进行中的拍卖数量一致', `${liveBeforeSave} 场`);
  ok(Math.abs(S.player.cash - cashBeforeSave) < 1, '读档后现金一致', `${Math.round(S.player.cash)}`);

  let unresolvable = 0;
  let staleIds = 0;
  let highRefs = 0;
  for (const a of S.player.auctions) {
    if (a.high && a.high.who !== 'player') {
      highRefs++;
      if (!S.npcs.some((n) => n.id === a.high.who)) staleIds++;
      if (bad(a.high.name)) unresolvable++;
    }
    for (const h of a.history || []) if (bad(h.who)) unresolvable++;
    for (const id of a.bidders || []) if (!S.npcs.some((n) => n.id === id)) unresolvable++;
  }
  console.log(`        存档内 NPC 最高出价 ${highRefs} 处，id 失配 ${staleIds} 处`);
  ok(unresolvable === 0, '读档后拍卖记录里的 NPC 名字都可解析',
    unresolvable ? `${unresolvable} 处无法解析` : `检查 ${S.player.auctions.length} 场`);
}

console.log('\n== 并发上限：NPC 拍卖最多 2 场进行中 ==');
{
  let maxLive = 0;
  let over = 0;
  for (let d = 0; d < 40; d++) {
    engine.advance(24);
    const n = S.player.auctions.filter((a) => a.status === 'live' && !a.mine).length;
    if (n > maxLive) maxLive = n;
    if (n > 2) over++;
  }
  ok(maxLive <= 2, '进行中的 NPC 拍卖从不超过 2 场', `峰值 ${maxLive} 场`);
  ok(over === 0, '没有任何一天超出上限');
}

console.log('\n== 挂单簿深度：每边最多 2 笔 ==');
{
  const npc = await import('../src/systems/npc.js');
  const { BY_RARITY } = await import('../src/core/catalog.js');
  let maxAsk = 0;
  let maxBid = 0;
  // 取样多种物品，覆盖不同流动性
  const sample = [
    ...BY_RARITY.blue.slice(0, 6),
    ...BY_RARITY.green.slice(0, 4),
    ...BY_RARITY.gold.slice(0, 3),
  ];
  for (const def of sample) {
    const b = npc.book(def, engine.engine.rng);
    maxAsk = Math.max(maxAsk, b.asks.length);
    maxBid = Math.max(maxBid, b.bids.length);
  }
  ok(maxAsk <= 2, '卖盘最多 2 档', `峰值 ${maxAsk}`);
  ok(maxBid <= 2, '买盘最多 2 档', `峰值 ${maxBid}`);
}

console.log('\n== 破产补贴 ==');
{
  const quest = await import('../src/systems/quest.js');
  // 有现金：不给
  S.player.cash = 5000;
  ok(!quest.checkBailout().ok, '现金充足时不发放');

  // 现金不足但仓库有货：不给（避免囤货领补贴）
  const inv = await import('../src/systems/inventory.js');
  const loot = await import('../src/systems/loot.js');
  loot.drawMany(3, engine.engine.rng, { priceEach: 100, charge: () => true });
  S.player.cash = 500;
  const r1 = quest.checkBailout();
  ok(!r1.ok && r1.reason === 'has-items', '仓库有货时不发放', `reason=${r1.reason} items=${r1.items}`);
  ok(quest.bailoutStatus().eligible === false, '状态提示不可领');

  // 清空仓库 + 现金见底：发放 3000
  S.player.bag = {};
  S.player.listings = [];
  S.player.buyOrders = [];
  S.player.auctions = [];
  S.player.cash = 500;
  const r2 = quest.checkBailout();
  ok(r2.ok && r2.amount === 3000, '仓库清空且现金不足时发放 3000', r2.ok ? `+${r2.amount}` : `reason=${r2.reason}`);
  ok(Math.abs(S.player.cash - 3500) < 1, '到账后现金正确', `${Math.round(S.player.cash)}`);

  // 同日不重复发放
  S.player.cash = 500;
  const r3 = quest.checkBailout();
  ok(!r3.ok && r3.reason === 'already-today', '同一游戏日只发一次', `reason=${r3.reason}`);

  // 跨日：把「领过的日子」往回拨一天，模拟进入新的一天
  S.player.bailoutDay = (S.player.bailoutDay || 0) - 1;
  S.player.cash = 500;
  S.player.bag = {};
  const r4 = quest.checkBailout();
  ok(r4.ok, '新的一天可以再领', r4.ok ? `+${r4.amount}` : `reason=${r4.reason}`);
}

console.log('\n== 存档导出 / 导入（保存到手机 → 下次拖回来） ==');
{
  const save = await import('../src/core/save.js');
  const name = save.saveFileName();
  ok(/^MONO-存档-第\d+天-Lv\d+-[\d-]+\.json$/.test(name), '存档文件名可读', name);
  const size = save.saveSize();
  ok(size > 1000, '存档体积合理', `${Math.round(size / 1024)} KB`);

  // 导出 → 反序列化 → 导入，验证往返一致
  const beforeCash = S.player.cash;
  const beforeDay = S.clock.hours;
  const beforeNpc = S.npcs.map((n) => n.name).join(',');
  const beforeBag = Object.keys(S.player.bag).join(',');

  const blob = save.exportBlob();
  const text = typeof blob.text === 'function'
    ? await blob.text()
    : JSON.stringify(await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(JSON.parse(String(fr.result)));
      fr.readAsText(blob, 'utf-8');
    }));
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* ignore */ }
  ok(!!parsed && !!parsed.player && !!parsed.market && !!parsed.npcs, '导出内容是完整快照',
    parsed ? `keys=${Object.keys(parsed).length}` : '解析失败');
  ok(parsed && parsed.seed === S.__seed, '快照带种子（可复现市场）', String(parsed && parsed.seed));

  // 破坏当前状态，再导入还原
  S.player.cash = 1;
  S.clock.hours = 0;
  S.npcs = [];
  S.player.bag = {};
  const r = await save.importText(text, 0);
  ok(r.ok, '导入成功', r.ok ? '' : String(r.reason));
  ok(Math.abs(S.player.cash - beforeCash) < 1, '导入后现金还原', `${Math.round(S.player.cash)}`);
  ok(Math.abs(S.clock.hours - beforeDay) < 0.001, '导入后游戏时间还原', String(S.clock.hours));
  ok(S.npcs.map((n) => n.name).join(',') === beforeNpc, '导入后 NPC 还原', `${S.npcs.length} 位`);
  ok(Object.keys(S.player.bag).join(',') === beforeBag, '导入后背包还原', `${Object.keys(S.player.bag).length} 组`);
}

console.log('\n== 手动刷新拍卖行 ==');
{
  // 首次刷新应当成功
  S.player.auctionRefreshAt = null;
  const r1 = auction.refreshAuctions(engine.engine.rng);
  ok(r1.ok, '首次手动刷新成功', `新增 ${r1.spawned} 场 · 结算 ${r1.settled} 场 · 出价 ${r1.bid} 场`);
  const live1 = S.player.auctions.filter((a) => a.status === 'live' && !a.mine).length;
  ok(live1 <= 2, '刷新后 NPC 场次仍不超过 2', `${live1} 场`);

  // 冷却中不能再刷
  const r2 = auction.refreshAuctions(engine.engine.rng);
  ok(!r2.ok && r2.reason === 'cooldown', '冷却期内拒绝刷新', `还需 ${r2.wait} 小时`);
  ok(auction.refreshCooldownLeft() > 0, '冷却计数可读', `${auction.refreshCooldownLeft().toFixed(1)} 小时`);

  // 推进一天后可再刷
  S.clock.hours += auction.REFRESH_COOLDOWN_HOURS + 1;
  ok(auction.refreshCooldownLeft() === 0, '冷却结束后可再次刷新');
  const r3 = auction.refreshAuctions(engine.engine.rng);
  ok(r3.ok, '冷却结束后刷新成功', `新增 ${r3.spawned} 场`);
}

console.log('\n== 不再自动保存：只有主动保存才落盘 ==');
{
  const save = await import('../src/core/save.js');
  // 先主动存一次，拿到基线
  await engine.saveExplicit(0);
  const base = save.readCache(0);
  const baseCash = base.player.cash;

  // 大幅改变状态并推进 3 天（过去这里每个 day 都会自动落盘）
  S.player.cash = baseCash + 123456;
  S.player.bag = {};
  engine.advance(24 * 3);
  const after = save.readCache(0);
  ok(after.player.cash === baseCash, '推进 3 天后存档未被自动写回', `存档内现金 ${Math.round(after.player.cash)}`);

  // 主动保存后才写入
  await engine.saveExplicit(0);
  const now = save.readCache(0);
  ok(Math.abs(now.player.cash - S.player.cash) < 1, '主动保存后存档与内存一致', `${Math.round(now.player.cash)}`);
  ok(engine.sinceManualSave() != null, '记录了上次主动保存时间', `${Math.round(engine.sinceManualSave() / 1000)} 秒前`);
}

console.log(`\n结果：${failures.length ? failures.length + ' 项失败 → ' + failures.join(' / ') : '全部通过'}\n`);
process.exit(failures.length ? 1 : 0);
