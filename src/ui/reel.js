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
 * 播放一次轮盘（循环卡带）
 *
 * 卡带是循环的：把候选卡重复若干轮拼成一整条，中奖卡放在**中间那一轮**。
 * 这样落位时标记线左右都还有大量卡片 —— 永远不会出现
 * 「滚到头之后标记线落在卡带之外 → 空白」。（手机上卡片更宽、可见张数更少，
 * 卡带必须足够长，所以这里设了 MIN_CARDS 下限。）
 *
 * @param {HTMLElement} host 容器（会被清空）
 * @param {object} win 中奖结果 { def, inst, rarity, qty }
 * @param {object} opt { rng, dur, onTickPass, onSettle, reduceMotion, minCards }
 * @returns {Promise<void>}
 */
export function playReel(host, win, opt = {}) {
  const rng = opt.rng || {
    float: () => Math.random(),
    int: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),
    chance: (p) => Math.random() < p,
  };
  const dur = opt.dur || 6000;
  /** 一条卡带至少这么多张：手机一屏只能看到 2~3 张，太短就会「滚到头」 */
  const minCards = opt.minCards || 52;

  // 一轮的候选卡：中奖卡留一个占位，其余随机填充
  const perCycle = Math.max(8, Math.ceil(minCards / 3));
  const winnerSlot = perCycle - 4; // 一轮里中奖卡的位置（靠后，留出「快要出了」的铺垫）
  const cycle = [];
  for (let i = 0; i < perCycle; i++) {
    if (i === winnerSlot) cycle.push({ def: win.def, inst: win.inst, isWinner: true });
    else {
      const near = i > winnerSlot - 5;
      cycle.push({ def: filler(rng, near ? win.rarity : null), inst: null });
    }
  }
  // 重复若干轮，中奖卡落在**中间那一轮**
  const cycles = Math.max(3, Math.ceil(minCards / perCycle));
  const midCycle = Math.floor(cycles / 2);
  const items = [];
  for (let c = 0; c < cycles; c++) {
    for (let i = 0; i < perCycle; i++) {
      const base = cycle[i];
      const idx = c * perCycle + i;
      // 只有中轮的那张是真正的中奖卡，其余同位置卡换成普通卡（视觉上就是「循环」）
      if (base.isWinner && c === midCycle) {
        items.push({ def: win.def, inst: win.inst, isWinner: true });
      } else if (base.isWinner) {
        items.push({ def: filler(rng, null), inst: null });
      } else {
        items.push(base);
      }
    }
  }
  const winnerIndex = midCycle * perCycle + winnerSlot;

  const track = h('div.reel__track');
  mount(track, ...items.map((it) => reelCard(it, { dim: !it.isWinner })));
  const strip = h('div.reel__strip', null, track);
  const reel = h('div.reel', null,
    strip,
    h('div.reel__fade.reel__fade--l'),
    h('div.reel__fade.reel__fade--r'),
    h('div.reel__marker', null, h('i'), h('i')));
  mount(host, reel);

  // ---- 测量可视宽度 ----
  // 判据：宿主优先，其次沿父级链向上找第一个「比轮盘自身窄」的有效宽度。
  //   · 宿主（#draw-slot）代表真实可用宽度；
  //   · 轮盘自身不可信：它是 width:100% 的溢出裁剪容器，若父级被
  //     justify-items:center 收缩，它的 clientWidth 会等于整条卡带的宽度（上千像素），
  //     于是 center 被算成卡带中心 → 落位偏移（手机上表现为「停在空白处」）。
  //   · 父级链取第一个 < reel.clientWidth 的宽度，作为兜底。
  const measure = () => {
    const good = (w) => typeof w === 'number' && w > 40 && w < 4000;
    if (good(host.clientWidth)) return host.clientWidth;
    const reelW = reel.clientWidth;
    let node = host.parentElement;
    for (let i = 0; i < 8 && node; i++) {
      const w = node.clientWidth;
      if (good(w) && (!good(reelW) || w < reelW)) return w;
      node = node.parentElement;
    }
    const docEl = (typeof document !== 'undefined' && document.documentElement) ? document.documentElement : null;
    if (docEl && good(docEl.clientWidth - 32)) return docEl.clientWidth - 32;
    if (good(reelW)) return reelW;
    return 343; // 375px 手机的典型内容宽，最后兜底
  };
  const width = Math.max(240, measure());
  const center = width / 2;

  // 目标位移：让「中奖卡中心」对齐标记线，再留一点随机偏移避免每次都停在正中。
  // 注意：reel 左右各有 fade 覆盖，但标记线固定在 50%，因此按几何中心计算即可。
  const winnerCenter = winnerIndex * STEP + CARD_W / 2;
  const jitter = (rng.float() - 0.5) * (CARD_W * 0.4);
  // 位移必须为正数：负值意味着「卡带往右推」，中奖卡会被挤出可视区
  const finalX = -Math.max(CARD_W, winnerCenter - center + jitter);
  const startX = 0;

  const reduce = !!opt.reduceMotion;

  /**
   * 落位自校验：真机上布局可能晚一拍（首帧 width 为 0、字体/滚动条改变宽度、
   * 键盘弹出等），一旦中奖卡偏离标记线就修正回来。
   * 返回最终使用的位移。
   */
  const settle = () => {
    track.style.transform = `translate3d(${finalX.toFixed(2)}px,0,0)`;
    const cards = track.querySelectorAll('.reel__card');
    const card = cards[winnerIndex];
    const nowW = measure();
    if (card && nowW > 40 && Math.abs(nowW - width) > 24) {
      // 宽度变了：按新宽度重新对齐，并做一次短过渡，避免视觉上跳变
      const corrected = -Math.max(CARD_W, winnerCenter - nowW / 2 + jitter);
      track.style.transition = 'transform 220ms ease-out';
      track.style.transform = `translate3d(${corrected.toFixed(2)}px,0,0)`;
      setTimeout(() => {
        track.style.transition = '';
      }, 260);
    }
    if (card) card.classList.add('is-hit');
    if (opt.onSettle) opt.onSettle(win);
  };

  return new Promise((resolve) => {
    if (reduce) {
      settle();
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
        settle();
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

  // 首件已经在轮盘里落位展示过了，这里只列其余结果，避免第 1 件被画两遍
  const rest = results.slice(1);
  const limit = Math.min(rest.length, opt.limit || 40);
  const shown = rest.slice(0, limit);
  const fast = h('div.reel__fast');
  mount(fast, ...shown.map((r) => {
    const card = reelCard({ def: r.def, inst: r.inst }, {});
    card.classList.add('is-pop');
    if (r.rarity === 'gold' || r.rarity === 'red') card.classList.add('is-hit');
    return card;
  }));
  const extra = h('div.hint.text-c', {
    style: { width: '100%' },
    text: rest.length > limit
      ? `共 ${results.length} 件 · 下列 ${limit} 件（其余已进背包）`
      : `共 ${results.length} 件 · 其余 ${shown.length} 件如下`,
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
