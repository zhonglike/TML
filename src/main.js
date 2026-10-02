/**
 * MONO — 应用入口
 * 装配：设置 → 存档/离线结算 → 路由 → 各页面 → 主循环 → 通知 → 自动保存
 */
import { engine, boot, startLoop, stopLoop, setSpeed, advance, applyOffline, setAlert, clearAlert, saveExplicit, sinceManualSave, dashboard as dashboardOf } from './core/engine.js';
import { S, newPlayer, initMarket, bagLimit, bagCount } from './core/state.js';
import { APP, TIME, ECON, RARITY, RARITY_ORDER, CATS } from './core/const.js';
import { ITEMS, getItem, ITEM_MAP } from './core/catalog.js';
import { bus, h, mount, icon, money, price as fmtPrice, thousands, durStr, dateTimeStr, haptic, floatUp } from './core/util.js';
import { VIEWS, NAV, TABBAR } from './ui/views.js';
import { toast, modal, layer, rarityChip, confirmDialog } from './ui/ui.js';
import * as save from './core/save.js';
import * as market from './core/market.js';
import * as loot from './systems/loot.js';
import * as quest from './systems/quest.js';
import * as economy from './systems/economy.js';
import * as inventory from './systems/inventory.js';
import * as auction from './systems/auction.js';
import * as npc from './systems/npc.js';
import { RNG } from './core/rng.js';

/* ------------------------------------------------------------------ 上下文 */

const ctx = {
  rng: null,
  settings: S.settings,
  setSpeed,
  setAlert,
  clearAlert,
  itemOf: (id) => getItem(id),
  dashboard: () => dashboardOf(),
  watchlist: [],
  lastItemId: null,
  ledger: (e) => {
    const list = S.player.ledger;
    // 由引擎/系统模块写入的记录优先；此处仅用于 UI 侧补充
    return list;
  },
  go,
  back,
  newGame: () => {},
  loadSlot: () => Promise.resolve(),
  reload: () => window.location.reload(),
  saveSettings: () => {
    try {
      localStorage.setItem(APP.settingsKey, JSON.stringify(S.settings));
    } catch (e) { /* noop */ }
  },
  resetMarket: () => {
    market.resetMarket(engine.rng);
    npc.initNpcs(engine.rng, S.npcs.length || 18);
    bus.emit('day', Math.floor(S.clock.hours / 24));
  },
  haptic,
};

/* ------------------------------------------------------------------ 路由 */

let current = null;
const instances = {};
let stack = [];

function go(viewId, params) {
  if (!VIEWS[viewId]) return;
  if (current === 'item') stack.push({ id: 'item', params: { id: ctx.lastItemId } });
  if (current === viewId && viewId !== 'item') {
    instances[viewId].onEnter(params);
    return;
  }
  if (current && instances[current]) {
    const elEl = instances[current].el;
    elEl.classList.remove('is-active');
  }
  current = viewId;
  if (!instances[viewId]) {
    instances[viewId] = VIEWS[viewId].create(ctx);
    document.getElementById('views').appendChild(instances[viewId].el);
  }
  const inst = instances[viewId];
  inst.el.classList.add('is-active');
  if (inst.onEnter) inst.onEnter(params || {});
  inst.el.scrollTop = 0;
  window.location.hash = viewId === 'dashboard' ? '' : '#' + viewId;
  paintNav();
}

function back() {
  const last = stack.pop();
  if (last && last.id === 'item' && last.params && last.params.id) {
    go('item', last.params);
    return;
  }
  go('dashboard');
}

/* ------------------------------------------------------------------ 导航渲染 */

function paintNav() {
  const total = dashboardOf();
  const groups = {};
  for (const item of NAV) {
    groups[item.group] = groups[item.group] || [];
    groups[item.group].push(item);
  }
  // 侧边栏
  const navHost = document.getElementById('sidebar-nav');
  mount(navHost, ...Object.keys(groups).map((g) => h('div.sidebar__group', null,
    h('i', { text: g }),
    ...groups[g].map((item) => h('div.sidebar__item' + (current === item.id ? '.is-active' : ''), {
      onclick: () => go(item.id),
      dataset: { nav: item.id },
    },
      icon(item.icon, 16),
      h('span', { text: item.label }),
      badgeFor(item.id, total) ? h('span.kbd', { text: badgeFor(item.id, total) }) : null)))));
  // 桌面账户区
  mount(document.getElementById('sidebar-account'),
    h('div.sidebar__item', { onclick: () => go('settings') }, icon('settings', 16), h('span', { text: '设置' })),
    h('div', { style: { padding: '10px' } },
      h('div.stat__label', { text: '总资产' }),
      h('div.fs-13.num', { id: 'nav-equity', text: '¥' + fmtPrice(total.equity) }),
      h('div.hint', { text: `Lv.${total.level} ${total.rank} · 现金 ¥${fmtPrice(total.cash)}` })));
  mount(document.getElementById('sidebar-foot'),
    h('div', { style: { lineHeight: '1.7' } },
      h('div', { text: `背包 ${total.bagCount}/${total.bagLimit} · 挂单 ${total.listings}` }),
      h('div', { text: `种子 ${total.seed}` })));
  // 标签栏
  mount(document.getElementById('tabbar'), ...TABBAR.map((id) => {
    const item = NAV.find((x) => x.id === id);
    const dot = badgeFor(id, total);
    return h('button.tabbar__item' + (current === id ? '.is-active' : ''), {
      onclick: () => go(id),
      dataset: { tab: id },
    }, icon(item.icon, 19), h('span', { text: item.label }),
      dot ? h('i.dot-badge') : null);
  }));
}

function badgeFor(viewId, d) {
  if (viewId === 'market' && S.events.length) return String(S.events.length);
  if (viewId === 'orders') {
    const n = S.player.listings.length + S.player.buyOrders.length;
    return n ? String(n) : null;
  }
  if (viewId === 'auction') {
    const n = auction.liveAuctions().length;
    return n ? String(n) : null;
  }
  if (viewId === 'quests' && d.canSignIn) return '•';
  if (viewId === 'bag') return null;
  return null;
}

/* ------------------------------------------------------------------ 顶栏 */

function paintAppbar() {
  const d = dashboardOf();
  document.getElementById('appbar-date').textContent = d.dateText;
  const idxEl = document.getElementById('appbar-index');
  const moodEl = document.getElementById('appbar-mood');
  const dir = d.indexChangeDay >= 0 ? '↑' : '↓';
  idxEl.textContent = `IDX ${d.index.toFixed(1)} ${dir}${Math.abs(d.indexChangeDay * 100).toFixed(2)}%`;
  moodEl.textContent = `情绪 ${d.moodInfo.cn}`;
  const eq = document.getElementById('nav-equity');
  if (eq) eq.textContent = '¥' + fmtPrice(d.equity);
  // 速度控件
  mount(document.getElementById('speed-ctl'), ...TIME.speeds.map((s) => h('button.segmented__item' + (S.clock.speed === s.id ? '.is-active' : ''), {
    title: s.cn || s.label,
    onclick: () => {
      setSpeed(s.id);
    },
  }, s.label)));
  paintSaveFlag();
}

/**
 * 存档状态徽标：让玩家一眼看到「还没保存」，而不是靠自动保存兜底。
 * 不再自动落盘后，这个提示是防止丢档的主要手段。
 */
function paintSaveFlag() {
  const host = document.getElementById('save-flag');
  const btn = document.getElementById('btn-save');
  if (!host) return;
  const since = sinceManualSave();
  const mins = since == null ? null : Math.floor(since / 60000);
  let text = '';
  let cls = 'saveflag';
  if (since == null) {
    text = '未保存';
    cls += ' is-dirty';
  } else if (mins >= 10) {
    text = mins >= 60 ? `${Math.floor(mins / 60)} 小时前保存` : `${mins} 分钟前保存`;
    cls += ' is-stale';
  } else {
    text = '已保存';
  }
  host.textContent = text;
  host.className = cls;
  if (btn) {
    mount(btn, icon('save', 15));
    btn.classList.toggle('is-active', since != null && (mins == null || mins < 10));
  }
}

/* ------------------------------------------------------------------ 提示与通知 */

function wireNotifications() {
  bus.on('event', (e) => {
    toast(`<b>${e.cn}</b> · ${e.mult >= 0 ? '+' : ''}${(e.mult * 100).toFixed(1)}% · ${e.detail}`, {
      kind: e.mult >= 0 ? 'info' : 'bad', ms: 4200, iconName: 'bell',
    });
    paintNav();
  });
  bus.on('alert', (a) => {
    toast(`价格提醒：<b>${a.name}</b> ${a.up ? '涨到' : '跌到'} ¥${fmtPrice(a.price)}（目标 ¥${fmtPrice(a.target)}）`, {
      kind: a.up ? 'good' : 'bad', ms: 5200, iconName: 'bell',
    });
    haptic('medium');
  });
  bus.on('fill', (e) => {
    toast(`${e.side === 'sell' ? '挂单成交' : '买单成交'}：<b>${e.order.name}</b> ×${e.qty} @ ¥${fmtPrice(e.price)}`, {
      kind: 'good', iconName: 'check',
    });
  });
  bus.on('order-expired', (o) => {
    toast(`挂单过期退回：<b>${o.name}</b> ×${o.qty - o.filled}`, { kind: 'info', iconName: 'clock' });
    paintNav();
  });
  bus.on('auction-settled', ({ auction: a, win, unsold }) => {
    if (a.mine) {
      toast(unsold
        ? `流拍：<b>${a.name}</b> 已退回背包`
        : `拍出：<b>${a.name}</b> 由 ${a.winner} 以 ¥${fmtPrice(a.high.price)} 拿下`, {
        kind: unsold ? 'info' : 'good', iconName: 'winner',
      });
    } else if (win) {
      toast(`拍卖中标：<b>${a.name}</b>（¥${fmtPrice(a.high.price)}）`, { kind: 'good', ms: 4200, iconName: 'winner' });
    } else {
      toast(`拍卖结束：<b>${a.name}</b> 被 ${a.winner} 拿下`, { kind: 'info' });
    }
    paintNav();
  });
  bus.on('quest-done', (q) => toast(`任务完成：<b>${q.cn}</b>`, { kind: 'good', iconName: 'check' }));
  bus.on('achievements', (list) => {
    for (const a of list) {
      toast(`成就达成：<b>${a.cn}</b> · ${a.desc}`, { kind: 'good', ms: 4200, iconName: 'star' });
    }
    haptic('heavy');
  });
  bus.on('day', (d) => {
    paintNav();
    paintAppbar();
    checkLevelUp();
  });
  bus.on('saved', () => {});
}

let lastLevel = 1;
function checkLevelUp() {
  if (S.player.level > lastLevel) {
    toast(`等级提升：<b>Lv.${S.player.level}</b>（背包 ${bagLimit()} 格 · 挂单上限提升）`, {
      kind: 'good', ms: 4200, iconName: 'arrowUp',
    });
    haptic('heavy');
  }
  lastLevel = S.player.level;
}

/* ------------------------------------------------------------------ 离线结算 */

function offlineModal(info) {
  if (!info || info.hours < 6) return;
  modal({
    title: '离线结算',
    render: (b) => {
      b.appendChild(h('div.stack.stack--loose', null,
        h('div', null,
          h('div.field__label', { text: '离开时长（游戏内）' }),
          h('div', { style: { fontSize: '20px' }, class: 'num', text: durStr(info.hours) + (info.capped ? '（已达上限）' : '') })),
        h('div', null,
          h('div.field__label', { text: '期间资产变化' }),
          h('div', { style: { fontSize: '20px' }, class: 'num ' + (info.pnl >= 0 ? 'up' : 'dn'), text: (info.pnl >= 0 ? '+' : '') + '¥' + fmtPrice(info.pnl) })),
        h('div.kv-grid', null,
          kv('当前总资产', '¥' + fmtPrice(info.equity)),
          kv('恢复时刻', dateTimeStr(info.toHour)),
          kv('市场状态', market.mood().cn),
          kv('活跃事件', String(S.events.length))),
        h('div.hint', {
          text: '离线期间市场照常波动（价格、事件、NPC 库存），但你的挂单不会逐 tick 结算，避免离线刷单。回到游戏后一切照常推进。',
        })));
    },
    foot: [h('button.btn.btn--primary', { type: 'button', onclick: () => layer().querySelector('.modal').remove() }, '继续经营')],
  });
  function kv(k, v) {
    return h('div.kv', null, h('span.kv__k', { text: k }), h('span.kv__v', { text: v }));
  }
}

/* ------------------------------------------------------------------ 帮助 */

function helpModal() {
  const eff = loot.effectiveOdds(4000);
  modal({
    title: 'MONO 玩法与公式',
    render: (b) => {
      b.appendChild(h('div.stack.stack--loose', null,
        h('div', null,
          h('div.field__label', { text: '核心循环' }),
          h('div.fs-13', { text: '赚金币 → 购买抽奖机会 → 开箱获得物品 → 在市场倒买倒卖 → 赚更多钱' })),
        h('div', null,
          h('div.field__label', { text: '时间' }),
          h('div.fs-13', { text: `1 秒 ≈ ${TIME.hoursPerTick} 游戏小时（1×）；最高 8× 加速；离线最多推进 ${TIME.offlineCapDays} 天。` })),
        h('div', null,
          h('div.field__label', { text: '价格模型' }),
          h('div.fs-13', { text: '锚价 + 几何随机游走 + 趋势动量 + 均值回归 + 玩家成交冲击 + 事件乘数，并被限制在锚价的 0.18~5.5 倍走廊内。' })),
        h('div', null,
          h('div.field__label', { text: '抽奖' }),
          h('div.fs-13', { text: `单抽 ¥${fmtPrice(ECON.drawPrice)}，十连 9 折、百连 85 折；${ECON.pitySoft} 抽未出金后概率提升，${ECON.pityHard} 抽必出金/红。` }),
          h('div.row', { style: { gap: '6px', flexWrap: 'wrap', marginTop: '6px' } },
            ...RARITY_ORDER.map((r) => h('span.tag', { style: { borderColor: RARITY[r].color } },
              `${RARITY[r].cn} ${(eff[r] * 100).toFixed(2)}%`)))),
        h('div', null,
          h('div.field__label', { text: '赚钱方式' }),
          h('div.stack--tight.stack', null,
            h('div.hint', { text: '· 低买高卖：关注相对锚价被低估的标的，等均值回归。' }),
            h('div.hint', { text: '· 事件交易：事件期间被错杀或错涨的品类最有价差。' }),
            h('div.hint', { text: '· 挂单套利：愿意等就用挂单，成交价通常明显高于回收商。' }),
            h('div.hint', { text: '· 拍卖捡漏：流拍与低关注度标的常有折价。' }),
            h('div.hint', { text: '· 品质溢价：同款皮肤的磨损与模板差异可以带来数倍价差。' }))),
        h('div.alert', null, icon('info', 15),
          h('div', { html: '抽奖是<b>负期望</b>的：长期把开箱物直接回收一定亏。真正的收益来自判断市场。' }))));
    },
  });
}

/* ------------------------------------------------------------------ 启动 */

async function bootApp() {
  // 1) 设置
  try {
    const saved = JSON.parse(localStorage.getItem(APP.settingsKey) || 'null');
    if (saved) Object.assign(S.settings, saved);
  } catch (e) { /* noop */ }
  document.documentElement.setAttribute('data-lum', S.settings.lum || 'default');
  document.documentElement.setAttribute('data-motion', S.settings.motion || 'on');

  // 2) 启动引擎（生成市场 + NPC + 预热 20 天历史）
  const t0 = performance.now();
  const slot = save.latestSlot();
  const seed = slot != null ? (save.readCache(slot) || {}).seed : null;
  engine.seed = seed || 'mono-' + Math.random().toString(36).slice(2, 10);
  ctx.rng = engine.rng = new RNG(engine.seed);
  S.__seed = engine.seed;
  boot(engine.seed);

  // 3) 读取存档 / 新建
  let loaded = false;
  if (slot != null) {
    const r = await save.load(slot);
    if (r.ok) {
      loaded = true;
      S.meta.slot = slot;
      if (r.warnings && r.warnings.length) {
        r.warnings.forEach((w) => toast(w, { kind: 'info', ms: 4200 }));
      }
      const info = applyOffline(S.meta.savedAt);
      setTimeout(() => offlineModal(info), 600);
    }
  }
  if (!loaded) {
    S.player = newPlayer();
    S.clock.speed = 1;
    // 新游戏不再重复预热
    boot(engine.seed);
    S.meta.slot = 0;
    await save.save(0, { silent: true });
    setTimeout(() => welcomeModal(), 700);
  }
  lastLevel = S.player.level;
  ctx.rng = engine.rng;

  // 4) 载入今日 K 线（若存档里有）
  if (S.session.dailyCandles && Object.keys(S.session.dailyCandles).length) {
    for (const id in S.session.dailyCandles) market.candles(id);
  }

  // 5) 导航与顶栏
  document.getElementById('btn-help').onclick = helpModal;
  // 顶栏「保存」：玩家主动落盘（不再有周期性自动保存）
  document.getElementById('btn-save').onclick = () => {
    saveExplicit().then((r) => {
      if (r && r.ok) {
        toast('已保存到存档位 ' + (S.meta.slot + 1), { kind: 'good', iconName: 'save' });
      } else {
        toast('保存失败，请检查浏览器存储权限', { kind: 'bad' });
      }
      paintSaveFlag();
    });
  };
  paintNav();
  paintAppbar();
  wireNotifications();

  go('dashboard');

  // 6) 主循环
  startLoop();

  // 7) 存档：只保留「关闭页面前落盘 + 玩家主动保存」，不再周期性自动保存。
  //    （用户要求：不要自动保存，只有玩家自己保存时才写档。）
  window.addEventListener('beforeunload', () => {
    try {
      save.save(S.meta.slot, { silent: true });
    } catch (e) { /* noop */ }
    quest.syncMilestones();
    const best = save.bestRecords();
    const eq = quest.equity();
    if (!best.length || eq > best[0].equity) {
      save.pushBest({ name: S.player.name, equity: Math.round(eq), day: Math.floor(S.clock.hours / 24) });
    }
  });
  // 手机切后台也算「离开」，补一次静默落盘，避免真正丢档
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      try {
        save.save(S.meta.slot, { silent: true });
      } catch (e) { /* noop */ }
    }
  });

  // 8) 每帧驱动各页面的增量刷新
  let lastPaint = 0;
  function frame(ts) {
    if (ts - lastPaint > 120) {
      lastPaint = ts;
      const inst = instances[current];
      if (inst && inst.onTick) {
        try {
          inst.onTick();
        } catch (e) {
          console.error('[mono] onTick error', e);
        }
      }
      paintAppbar();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 9) 首次交互解锁音频 + 全局触感
  const unlockOnce = () => {
    unlockAudio();
    document.removeEventListener('pointerdown', unlockOnce);
    document.removeEventListener('keydown', unlockOnce);
  };
  document.addEventListener('pointerdown', unlockOnce);
  document.addEventListener('keydown', unlockOnce);

  // 10) 键盘快捷键（桌面）
  document.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === ' ') {
      e.preventDefault();
      setSpeed(S.clock.speed === 0 ? 1 : 0);
      paintAppbar();
      return;
    }
    if (e.key >= '1' && e.key <= '8') {
      setSpeed(Number(e.key));
      paintAppbar();
      return;
    }
    const map = { d: 'dashboard', b: 'bag', m: 'market', o: 'orders', a: 'auction', r: 'records', q: 'quests', s: 'settings' };
    if (map[e.key.toLowerCase()]) go(map[e.key.toLowerCase()]);
  });

  // 11) PWA：注册 SW；发现新版本立刻接管，并在接管后重载一次拿新模块
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      const activate = (worker) => {
        if (worker) worker.postMessage({ type: 'SKIP_WAITING' });
      };
      activate(reg.waiting);
      reg.addEventListener('updatefound', () => activate(reg.installing));
      reg.update().catch(() => {});
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        location.reload();
      });
    }).catch(() => {});
  }
  console.log(`[mono] booted in ${(performance.now() - t0).toFixed(0)}ms · ${ITEMS.length} items · seed ${engine.seed}`);
}

function welcomeModal() {
  modal({
    title: '欢迎来到 MONO',
    render: (b) => {
      b.appendChild(h('div.stack.stack--loose', null,
        h('div', { style: { fontSize: '15px' }, text: '极简 · 暗黑经营模拟' }),
        h('div.hint', { text: '你手上有 ¥5,000 启动资金。抽奖能让你快速拥有资产，但它是负期望的；真正的收益来自在市场里低买高卖。' }),
        h('div.stack--tight.stack', null,
          step('01', '去抽奖中心开箱', '单抽 ¥1,000，十连 9 折。'),
          step('02', '认识市场', '看 K 线、涨跌榜与锚价偏离，找到被低估的标的。'),
          step('03', '在背包里卖出', '回收商瞬间成交但折价；挂单等待能卖更高。'),
          step('04', '参与拍卖', '流拍与低关注度标的常有折价。')),
        h('div.alert', null, icon('info', 15),
          h('div', { html: '建议先做<b>经营指引</b>里的任务链，会给你启动资金与材料。' }))));
      function step(no, title, sub) {
        return h('div.row', { style: { alignItems: 'flex-start' } },
          h('span.rank__no', { text: no }),
          h('div.col', null,
            h('div.fs-13', { text: title }),
            h('div.hint', { text: sub })));
      }
    },
    foot: [
      h('button.btn.btn--ghost', { type: 'button', onclick: () => { layer().querySelector('.modal').remove(); helpModal(); } }, '玩法与公式'),
      h('button.btn.btn--primary', { type: 'button', onclick: () => layer().querySelector('.modal').remove() }, '开始经营'),
    ],
  });
}

/* ------------------------------------------------------------------ 上下文补全 */

ctx.newGame = () => {
  S.player = newPlayer();
  S.clock.hours = 0;
  S.clock.speed = 1;
  S.events = [];
  S.session.equity = [];
  S.session.index = { index: 1000, prev: 1000, history: [] };
  market.resetMarket(engine.rng);
  npc.initNpcs(engine.rng, 18);
  engine.seed = 'mono-' + Math.random().toString(36).slice(2, 10);
  engine.rng = new RNG(engine.seed);
  ctx.rng = engine.rng;
  S.__seed = engine.seed;
  boot(engine.seed);
  lastLevel = S.player.level;
  save.save(S.meta.slot, { silent: true });
  for (const k in instances) {
    if (instances[k].onEnter) instances[k].onEnter({});
  }
  paintNav();
  paintAppbar();
};

ctx.loadSlot = async (slot) => {
  const r = await save.load(slot);
  if (!r.ok) return false;
  S.meta.slot = slot;
  engine.seed = S.__seed || engine.seed;
  ctx.rng = engine.rng = new RNG(engine.seed);
  lastLevel = S.player.level;
  for (const k in instances) {
    if (instances[k].onEnter) instances[k].onEnter({});
  }
  paintNav();
  paintAppbar();
  return true;
};

/* ------------------------------------------------------------------ GO */

// 启动入口：用 readyState 判断，而不是只监听 DOMContentLoaded。
// 模块可能在 DOMContentLoaded 已经触发之后才执行，此时事件不会再触发、页面会白屏。
function startApp() {
  bootApp().catch((e) => {
    console.error('[mono] boot failed', e);
    const host = document.getElementById('views');
    if (host) {
      mount(host, h('div.empty', { style: { padding: '80px 20px' } },
        icon('info', 26),
        h('b', { text: '启动失败' }),
        h('span', { text: String(e && e.message ? e.message : e) }),
        h('button.btn.btn--sm', { onclick: () => location.reload() }, '重新载入')));
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
