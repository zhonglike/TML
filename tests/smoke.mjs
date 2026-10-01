/**
 * MONO — 无浏览器冒烟测试
 * 用法: node tests/smoke.mjs
 * 目的：在没有 DOM 的环境里验证 图鉴 / 市场 / 抽奖 / 交易 / 挂单 / 拍卖 全部可跑，
 * 并输出经济平衡指标（抽奖期望回收、市场漂移、GC 安全性）。
 */
import { ITEMS, ITEM_MAP, getItem, stats, priceFactor, rollCondition } from '../src/core/catalog.js';
import { RNG } from '../src/core/rng.js';
import { S, initMarket, mstate } from '../src/core/state.js';
import * as market from '../src/core/market.js';
import * as npc from '../src/systems/npc.js';
import * as loot from '../src/systems/loot.js';
import * as economy from '../src/systems/economy.js';
import * as trade from '../src/systems/trade.js';
import * as auction from '../src/systems/auction.js';
import * as inv from '../src/systems/inventory.js';
import * as quest from '../src/systems/quest.js';
import { wireCounters } from '../src/core/engine.js';
import { ECON, TIME, RARITY_ORDER } from '../src/core/const.js';

wireCounters();

let failures = 0;
function ok(cond, label, extra = '') {
  if (cond) {
    console.log(`  ok   ${label}${extra ? ' — ' + extra : ''}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`);
  }
}

console.log('\n== 图鉴 ==');
const st = stats();
console.log(`  物品总数 ${st.total}`);
console.log('  品类分布 ' + JSON.stringify(st.byCat, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)));
console.log('  稀有度   ' + JSON.stringify(st.byRar, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)));
ok(st.total >= 500, '物品数量 >= 500', `${st.total}`);
ok(ITEMS.every((d) => d.base > 0 && d.sigma > 0), '所有物品有正价格与波动率');
ok(ITEMS.filter((d) => d.float).length > 100, '带磨损的 CS2 物品 > 100', `${ITEMS.filter((d) => d.float).length}`);

console.log('\n== 市场初始化 ==');
const rng = new RNG('smoke-seed');
initMarket(rng);
npc.initNpcs(rng, 18);
ok(S.npcs.length === 18, 'NPC 生成', `${S.npcs.length}`);
ok(npc.totalNpcCash() > 0, 'NPC 现金池', `${Math.round(npc.totalNpcCash()).toLocaleString()}`);

console.log('\n== 推进 30 天 ==');
const t0 = Date.now();
const before = ITEMS.map((d) => S.market[d.id].p);
for (let i = 0; i < (30 * 24) / TIME.hoursPerTick; i++) {
  market.tick(rng, { hours: TIME.hoursPerTick });
  npc.tickNpcs(rng, TIME.hoursPerTick);
}
const ms = Date.now() - t0;
const after = ITEMS.map((d) => S.market[d.id].p);
let moved = 0;
let sumRet = 0;
let maxRet = 0;
for (let i = 0; i < before.length; i++) {
  const r = after[i] / before[i] - 1;
  if (Math.abs(r) > 0.001) moved++;
  sumRet += r;
  maxRet = Math.max(maxRet, Math.abs(r));
}
console.log(`  30 天共 ${(30 * 24) / TIME.hoursPerTick} tick，耗时 ${ms}ms（${(ms / ((30 * 24) / TIME.hoursPerTick)).toFixed(2)}ms/tick）`);
console.log(`  价格变动比例 ${(moved / before.length * 100).toFixed(1)}% | 平均涨跌 ${(sumRet / before.length * 100).toFixed(2)}% | 最大偏离 ${(maxRet * 100).toFixed(1)}%`);
ok(moved / before.length > 0.97, '几乎所有物品价格都在动');
ok(Math.abs(sumRet / before.length) < 0.35, '市场没有整体暴走（均值回归有效）');
ok(ITEMS.every((d) => {
  const m = S.market[d.id];
  return m.p >= d.min * 0.5 && m.p <= d.max * 1.6;
}), '所有价格落在锚价走廊内');
ok(S.session.index.index > 0, '市场指数有效', S.session.index.index.toFixed(1));
ok(market.candles('butterfly-doppler-ruby').length >= 28, 'K 线累积', `${market.candles('butterfly-doppler-ruby').length} 根`);

console.log('\n== 抽奖经济（10000 次抽样） ==');
const tally = {};
let recycleSum = 0;
let marketSum = 0;
let golds = 0;
let reds = 0;
const draws = 20000;
for (let i = 0; i < draws; i++) {
  const r = loot.drawOne(rng);
  tally[r.rarity] = (tally[r.rarity] || 0) + 1;
  const marketUnit = economy.marketUnit(r.def, r.inst);
  recycleSum += marketUnit * r.qty * economy.recycleRateFor(r.def);
  marketSum += marketUnit * r.qty;
  if (r.rarity === 'gold') golds++;
  if (r.rarity === 'red') reds++;
}
const odds = loot.odds();
const eff = loot.effectiveOdds(20000);
console.log('  实际分布 ' + RARITY_ORDER.map((r) => `${r}:${((tally[r] || 0) / draws * 100).toFixed(2)}%`).join(' '));
console.log('  长期概率 ' + RARITY_ORDER.map((r) => `${r}:${(eff[r] * 100).toFixed(2)}%`).join(' '));
const evRec = recycleSum / draws;
const evMkt = marketSum / draws;
console.log(`  单抽成本 ${ECON.drawPrice} | 期望回收价 ${evRec.toFixed(1)} (${(evRec / ECON.drawPrice * 100).toFixed(1)}%) | 期望市场价 ${evMkt.toFixed(1)} (${(evMkt / ECON.drawPrice * 100).toFixed(1)}%)`);
ok(evRec < ECON.drawPrice, '回收价期望低于抽奖成本（抽奖不是印钞机）', `${(evRec / ECON.drawPrice * 100).toFixed(1)}%`);
ok(evRec / ECON.drawPrice > 0.35, '回收价期望不至于毫无意义', `${(evRec / ECON.drawPrice * 100).toFixed(1)}%`);
ok(Math.abs((tally.white || 0) / draws - 0.6) < 0.05, '白色概率接近 60%', `${((tally.white || 0) / draws * 100).toFixed(1)}%`);
ok(golds + reds > 0, '金红可被开出', `gold ${golds} / red ${reds}`);

// 分档验证：低等级略亏、高等级接近持平，但任何等级都不得变成印钞机。
// 注意：单抽收益是重尾分布（一件红色可以顶几千抽），因此必须用大样本让均值收敛。
console.log('\n== 抽奖经济 · 按稀有度的期望贡献（Lv.1，200000 抽） ==');
const sampleLevel = S.player.level;
S.player.level = 1;
const BIG = 200000;
const byRar = {};
for (let i = 0; i < BIG; i++) {
  const r = loot.drawOne(rng);
  const v = economy.marketUnit(r.def, r.inst) * r.qty * economy.recycleRateFor(r.def);
  const b = byRar[r.rarity] || (byRar[r.rarity] = { n: 0, sum: 0, max: 0 });
  b.n++;
  b.sum += v;
  if (v > b.max) b.max = v;
}
let totalEv = 0;
for (const k of RARITY_ORDER) {
  const b = byRar[k];
  if (!b) continue;
  const ev = b.sum / BIG;
  totalEv += ev;
  console.log(
    `  ${k.padEnd(6)} 占比 ${((b.n / BIG) * 100).toFixed(2).padStart(6)}%  ` +
    `EV贡献 ${ev.toFixed(1).padStart(9)}  (${((ev / ECON.drawPrice) * 100).toFixed(1).padStart(6)}% of 成本)  ` +
    `单件最大回收 ${Math.round(b.max).toLocaleString()}`,
  );
}
console.log(`  合计 EV ${totalEv.toFixed(1)} = 成本的 ${((totalEv / ECON.drawPrice) * 100).toFixed(1)}%`);

console.log('\n== 抽奖经济 · 等级曲线（每档 40000 抽） ==');
const curve = [];
const PER_LEVEL = 40000;
for (const lv of [1, 10, 20, 35, 60]) {
  S.player.level = lv;
  let sum = 0;
  for (let i = 0; i < PER_LEVEL; i++) {
    const r = loot.drawOne(rng);
    sum += economy.marketUnit(r.def, r.inst) * r.qty * economy.recycleRateFor(r.def);
  }
  const rate = sum / PER_LEVEL / ECON.drawPrice;
  curve.push({ lv, rate });
  console.log(`  Lv.${String(lv).padStart(2)}  回收/成本 = ${(rate * 100).toFixed(1)}%   （基础回收率 ${(economy.recycleRate() * 100).toFixed(0)}%）`);
}
S.player.level = sampleLevel;
ok(curve.every((c) => c.rate < 1), '所有等级下抽奖都保持负期望',
  curve.map((c) => `Lv${c.lv}:${(c.rate * 100).toFixed(0)}%`).join(' '));
ok(curve[0].rate > 0.4 && curve[0].rate < 0.85, '低等级回收期望落在 40%~85%', `${(curve[0].rate * 100).toFixed(1)}%`);
ok(curve[curve.length - 1].rate < 0.95, '满级也不会靠抽奖套利', `${(curve[curve.length - 1].rate * 100).toFixed(1)}%`);

console.log('\n== 玩家流程（抽奖 → 入包 → 卖出 → 挂单 → 拍卖） ==');
S.player = {
  ...S.player,
  cash: 200000,
  bag: {},
};
const res = loot.drawMany(50, rng, { charge: (n) => economy.canPay(n) && economy.pay(n, 'draw'), priceEach: ECON.drawPrice });
ok(res.results.length === 50, '50 连抽成功', `实际 ${res.results.length}`);
ok(Object.keys(S.player.bag).length > 0, '背包有物品', `${Object.keys(S.player.bag).length} 组`);
ok(S.player.cash < 200000, '现金被正确扣除', `剩余 ${Math.round(S.player.cash)}`);

const entries = inv.bagEntries({ sort: 'price-desc' });
ok(entries.length > 0, '背包条目可读', `${entries.length}`);
const top = entries[0];
console.log(`  最贵一件：${top.def.name} ×${top.qty} @ ${top.unitValue.toFixed(2)}（成本 ${top.inst.cost.toFixed(2)}）`);
// 公平对比：同一件物品的「回收价」与「市价」必须不同人不同价
const cmpEntry = entries.find((e) => e.def.liq < 0.9) || entries[0];
const keyA = cmpEntry.key;
const recQ = economy.recycleUnit(cmpEntry.def, cmpEntry.inst);
const mktQ = economy.quoteSell(cmpEntry.def, cmpEntry.inst).net;
ok(recQ < mktQ, '回收价低于市价（折价有效）', `回收 ${recQ.toFixed(2)} vs 市价 ${mktQ.toFixed(2)}`);
const sellRes = economy.sell(top.key, Math.min(top.qty, 2), { instant: true });
ok(sellRes.ok, '一口价卖出成功', `收入 ${sellRes.total ? sellRes.total.toFixed(2) : 0}，原因 ${sellRes.reason || '-'}`);
const second = inv.bagEntries({ sort: 'price-desc' }).find((e) => e.key !== top.key) || inv.bagEntries({ sort: 'price-desc' })[0];
const sell2 = economy.sell(second.key, 1, { instant: false });
ok(sell2.ok, '市价卖出成功', sell2.total ? sell2.total.toFixed(2) : `原因 ${sell2.reason}`);

// 挂单：找一个便宜的库存挂出去
const listingsBefore = S.player.listings.length;
let listed = false;
for (const e of inv.bagEntries({ sort: 'price-asc' })) {
  const r = trade.listSell(e.key, 1, e.unitValue * 1.05);
  if (r.ok) {
    listed = true;
    break;
  }
}
ok(listed || S.player.listings.length > listingsBefore, '挂单成功');
if (S.player.listings.length) {
  let filled = false;
  for (let i = 0; i < (12 * 24) / TIME.hoursPerTick; i++) {
    market.tick(rng, { hours: TIME.hoursPerTick });
    trade.tickOrders(rng, TIME.hoursPerTick);
    if (S.player.listings.length === 0) {
      filled = true;
      break;
    }
  }
  ok(filled, '挂单在 12 天内被 NPC 吃单', filled ? '' : `仍剩 ${S.player.listings.length} 单`);
}

// 拍卖
let auctionOk = false;
for (const e of inv.bagEntries({ sort: 'price-desc' })) {
  const r = auction.createAuction(e.key, 1, e.unitValue * 0.8, e.unitValue * 1.6);
  if (r.ok) {
    auctionOk = true;
    const a = r.auction;
    for (let i = 0; i < (10 * 24) / TIME.hoursPerTick; i++) {
      market.tick(rng, { hours: TIME.hoursPerTick });
      auction.tickAuctions(rng, TIME.hoursPerTick);
      if (a.status !== 'live') break;
    }
    console.log(`  拍卖结果：${a.status}${a.winner ? ' 由 ' + a.winner + ' 以 ' + Math.round(a.high.price) + ' 获得' : ''}`);
    break;
  }
}
ok(auctionOk, '玩家可发起拍卖');
ok(auction.liveAuctions().length + auction.auctionHistory().length > 0, '拍卖列表非空');

console.log('\n== NPC 挂单簿 ==');
const probe = ITEMS.filter((d) => d.rarity === 'blue').sort((a, b) => b.liq - a.liq)[0];
let book = npc.book(probe, rng);
for (let i = 0; i < 8 && book.asks.length + book.bids.length === 0; i++) {
  market.tick(rng, { hours: TIME.hoursPerTick });
  book = npc.book(probe, rng);
}
console.log(`  ${probe.name}: 卖单 ${book.asks.length} 档 / 买单 ${book.bids.length} 档 / 中间价 ${book.mid.toFixed(2)}`);
ok(book.asks.length + book.bids.length > 0, '挂单簿有深度');
if (book.asks.length) {
  const r = npc.takeAsks(probe, 2, rng);
  ok(r.qty > 0, '可从挂单簿买入', `${r.qty} 件，均价 ${r.avg.toFixed(2)}`);
}
if (book.bids.length) {
  const r = npc.takeBids(probe, 1, rng);
  ok(r.total >= 0, '可向买盘卖出', `${r.qty} 件，均价 ${r.avg.toFixed(2)}`);
}

console.log('\n== 任务 / 成就 / 资产 ==');
quest.syncMilestones();
const un = quest.checkAchievements();
console.log(`  本轮解锁成就 ${un.length} 个`);
const eq = quest.equity();
console.log(`  总资产 ${Math.round(eq).toLocaleString()} | 现金 ${Math.round(S.player.cash).toLocaleString()} | 等级 ${S.player.level} | 声望 ${Math.round(S.player.rep)}`);
ok(eq > 0, '资产统计有效');
ok(S.player.quests.counter.draws > 0, '任务计数器工作', `draws=${S.player.quests.counter.draws}`);
ok(S.player.quests.counter.sells > 0, '卖出计数器工作', `sells=${S.player.quests.counter.sells}`);

console.log('\n== 分布健全性 ==');
const lowPrice = ITEMS.filter((d) => d.base < 5).length;
const highPrice = ITEMS.filter((d) => d.base > 100000).length;
console.log(`  < ¥5 的物品 ${lowPrice} 种 | > ¥10万 的物品 ${highPrice} 种`);
ok(lowPrice >= 10, '低价段物品充足');
ok(highPrice >= 10, '高价段物品充足');
const noDesc = ITEMS.filter((d) => !d.desc).length;
ok(noDesc === 0, '每个物品都有描述');

console.log(`\n结果：${failures === 0 ? '全部通过' : failures + ' 项失败'}\n`);
process.exit(failures ? 1 : 0);
