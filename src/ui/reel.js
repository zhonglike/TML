/**
 * MONO — CS 风格开箱轮盘
 * 一条横向卡带高速滚过，中间标记线判定归属，末段减速停在目标卡上，
 * 每擦过一张卡播放一次「咔」声。整体保持黑白灰，仅卡面用稀有度色条。
 */
import { h, mount, icon } from '../core/util.js';
import { RARITY } from '../core/const.js';
import { ITEMS, BY_RARITY } from '../core/catalog.js';
import { sfx } from './sound.js';

const CARD_W = 112;
const CARD_GAP = 8;
const STEP = CARD_W + CARD_GAP;

/** 卡面缩写（无 emoji，纯文字标记） */
function markOf(def) {
  const map = { cs2: 'SKIN', compute: 'GPU', hardware: 'PC', assets: 'AST' };
  return map[def.category] || 'ITEM';
}

/** 单张卡 */
function reelCard(item, opt = {}) {
  const { def, inst, isWinner } = item;
  const rar = (RARITY[def.rarity] || RARITY.white);
  const rows = [];
  if (inst && inst.wear) rows.push(inst.wear);
  if (inst && inst.st) rows.push('暗金');
  if (inst && inst.pattern) rows.push(inst.pattern);
  const el = h('div.reel__card' + (opt.dim ? '.is-dim' : '') + (isWinner ? '.is-winner' : ''), {
    style: { '--rc': rar.color, width: CARD_W + 'px' },
    dataset: { rarity: def.rarity, item: def.id },
  },
    h('div.reel__band'),
    h('div.reel__img', null, h('b', { text: markOf(def) })),
    h('div.reel__meta', null,
      h('div.reel__name', { text: def.name }),
      h('div.reel__sub', { text: rows.join(' · ') || def.subType })));
  return el;
}

/**
 * 随机填充卡：按与真实掉率同量级的密度取样，
 * 并在中奖卡前几格提高同稀有度出现概率（视觉上「快要出了」的感觉）。
 */
function filler(rng, rarityBias) {
  if (rarityBias && rng.chance(0.06)) {
    const list = BY_RARITY[rarityBias] || [];
    if (list.length) return list[Math.floor(rng.float() * list.length)];
  }
  const pool = [];
  const density = { white: 1, green: 0.5, blue: 0.25, purple: 0.1, gold: 0.03, red: 0.01 };
  for (const rar of ['white', 'green', 'blue', 'purple', 'gold', 'red']) {
    const list = BY_RARITY[rar] || [];
    if (rng.float() < density[rar]) pool.push(...list);
  }
  if (!pool.length) return ITEMS[Math.floor(rng.float() * ITEMS.length)];
  return pool[Math.floor(rng.float() * pool.length)];
}

const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
const easeInOutQuint = (t) => (t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2);

/**
 * 播放一次轮盘
 * @param {HTMLElement} host 容器（会被清空）
 * @param {object} win 中奖结果 { def, inst, rarity, qty }
 * @param {object} opt { rng, dur, spins, onTickPass, onSettle, reduceMotion }
 * @returns {Promise<void>}
 */
export function playReel(host, win, opt = {}) {
  const rng = opt.rng || { float: () => Math.random(), int: (a, b) => a + Math.floor(Math.random() * (b - a + 1)), chance: (p) => Math.random() < p };
  const dur = opt.dur || 6000;
  const spins = opt.spins || 3;
  const total = Math.max(36, Math.round(spins * 12) + 8);
  const winnerIndex = total - 6;

  const items = [];
  for (let i = 0; i < total; i++) {
    items.push(i === winnerIndex
      ? { def: win.def, inst: win.inst, isWinner: true }
      : { def: filler(rng, i > winnerIndex - 5 && i < winnerIndex ? win.rarity : null), inst: null });
  }

  const track = h('div.reel__track');
  mount(track, ...items.map((it) => reelCard(it, { dim: !it.isWinner })));
  const strip = h('div.reel__strip', null, track);
  const reel = h('div.reel', null,
    strip,
    h('div.reel__fade.reel__fade--l'),
    h('div.reel__fade.reel__fade--r'),
    h('div.reel__marker', null, h('i'), h('i')));
  mount(host, reel);

  const width = Math.max(240, host.clientWidth || 720);
  const center = width / 2;
  // 目标位移：让「中奖卡中心」对齐标记线，再留一点随机偏移避免每次都停在正中。
  // 注意：reel 左右各有 fade 覆盖，但标记线固定在 50%，因此按几何中心计算即可。
  const winnerCenter = winnerIndex * STEP + CARD_W / 2;
  const jitter = (rng.float() - 0.5) * (CARD_W * 0.4);
  const finalX = -(Math.max(0, winnerCenter - center) + jitter);
  const startX = 0;

  const reduce = !!opt.reduceMotion;

  return new Promise((resolve) => {
    if (reduce) {
      track.style.transform = `translate3d(${finalX}px,0,0)`;
      if (opt.onSettle) opt.onSettle(win);
      resolve();
      return;
    }
    const t0 = performance.now();
    let lastSlot = -1;
    const frame = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      // 前 12% 用 easeInOut 起步，之后 easeOut 长尾减速
      const e = k < 0.12 ? easeInOutQuint(k / 0.12) * 0.06 : 0.06 + easeOutQuint((k - 0.12) / 0.88) * 0.94;
      const x = startX + (finalX - startX) * e;
      track.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
      // 经过标记线时发声
      const slot = Math.floor((center - x) / STEP);
      if (slot !== lastSlot) {
        lastSlot = slot;
        if (slot >= 0 && slot < items.length) {
          const it = items[slot];
          if (it.isWinner) {
            /* 中奖那一刻由调用方播报 */
          } else {
            sfx('tick');
          }
          if (opt.onTickPass) opt.onTickPass(slot, it);
        }
      }
      if (k < 1) requestAnimationFrame(frame);
      else {
        track.style.transform = `translate3d(${finalX.toFixed(2)}px,0,0)`;
        const cards = track.querySelectorAll('.reel__card');
        if (cards[winnerIndex]) cards[winnerIndex].classList.add('is-hit');
        if (opt.onSettle) opt.onSettle(win);
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
}

/**
 * 多连抽：首抽用完整轮盘揭晓，其余用「快速条」扫过，
 * 避免十连/百连等一分钟。返回时快速条包含全部结果（超过 40 件只展示前 40）。
 */
export async function playMultiReel(host, results, opt = {}) {
  const rng = opt.rng;
  if (!results.length) return;
  await playReel(host, results[0], {
    rng,
    dur: opt.firstDur || 5200,
    reduceMotion: opt.reduceMotion,
    onSettle: opt.onSettle,
  });
  if (results.length === 1) return;

  const limit = Math.min(results.length, opt.limit || 40);
  const shown = results.slice(0, limit);
  const fast = h('div.reel__fast');
  mount(fast, ...shown.map((r) => {
    const card = reelCard({ def: r.def, inst: r.inst }, {});
    card.classList.add('is-pop');
    if (r.rarity === 'gold' || r.rarity === 'red') card.classList.add('is-hit');
    return card;
  }));
  const extra = h('div.hint.text-c', {
    style: { width: '100%' },
    text: `共 ${results.length} 件${results.length > limit ? `（展示前 ${limit} 件，其余已进背包）` : ''}`,
  });
  mount(host, fast, extra);

  if (opt.reduceMotion) return;
  // 顺序弹出的节奏感：只对前若干张发声，避免噪声堆叠
  for (let i = 0; i < Math.min(shown.length, 12); i++) {
    const r = shown[i];
    sfx(r.rarity === 'gold' || r.rarity === 'red' ? 'coin' : 'tap');
    await new Promise((r2) => setTimeout(r2, 70));
  }
  await new Promise((r2) => setTimeout(r2, 260));
}
