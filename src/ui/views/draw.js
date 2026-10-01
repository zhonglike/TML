/**
 * MONO — 抽奖中心
 * 单抽 / 十连 / 百连（含折扣）、CS 开箱式横向轮盘揭晓、概率公示、保底进度、开箱记录。
 */
import {
  h, mount, icon, fmtPrice, money, sectionTitle, toast, itemUnit, emptyState,
  rarityChip, deltaEl, confirmDialog, segmented,
} from '../ui.js';
import { S, bagCount, bagLimit } from '../../core/state.js';
import { ECON, RARITY, RARITY_ORDER } from '../../core/const.js';
import * as loot from '../../systems/loot.js';
import * as economy from '../../systems/economy.js';
import * as quest from '../../systems/quest.js';
import * as inv from '../../systems/inventory.js';
import * as trade from '../../systems/trade.js';
import { sfx, sfxRarity } from '../sound.js';
import { playReel, playMultiReel } from '../reel.js';
import { sleep, clamp, thousands, dateTimeStr, durStr } from '../../core/util.js';

const LS_MODE = 'mono.draw.mode';

export function create(ctx) {
  const el = h('section.view', { dataset: { view: 'draw' } });
  const st = {
    busy: false,
    results: [],
    /** 'reel' = CS 式轮盘；'flip' = 3D 翻卡 */
    mode: localStorage.getItem(LS_MODE) || 'reel',
  };
  let stageHost = null;
  let infoHost = null;
  let resultHost = null;

  function costOf(n) {
    if (n >= 100) return Math.round(ECON.drawPrice * n * ECON.multi100);
    if (n >= 10) return Math.round(ECON.drawPrice * n * ECON.multi10);
    return ECON.drawPrice * n;
  }

  function roomLeft() {
    return Math.max(0, bagLimit() - bagCount());
  }

  function reduceMotion() {
    return S.settings.motion === 'off'
      || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function render() {
    const eff = loot.effectiveOdds(6000);
    const pool = loot.poolInfo();
    const pity = S.player.pity;
    const toSoft = Math.max(0, ECON.pitySoft - pity.sinceGold);
    const toHard = Math.max(0, ECON.pityHard - pity.sinceGold);
    const boost = Math.round((clamp(1 + Math.sqrt(Math.max(0, S.player.level - 1)) / 25, 1, 1.2) - 1) * 100);

    stageHost = h('div.card.card--pad', null,
      h('div.row.row--between', { style: { marginBottom: '10px' } },
        h('div.stat__label', { text: '开箱' }),
        h('div.row', { style: { gap: '6px', flexWrap: 'wrap' } },
          h('span.tag', { text: '软保底 ' + (pity.sinceGold >= ECON.pitySoft ? '已触发' : `还差 ${toSoft} 抽`) }),
          h('span.tag', { text: '硬保底 还差 ' + toHard + ' 抽' }),
          segmented([{ id: 'reel', label: '轮盘' }, { id: 'flip', label: '翻卡' }], st.mode, (id) => {
            st.mode = id;
            localStorage.setItem(LS_MODE, id);
            render();
          }))),
      h('div', { id: 'draw-slot' }),
      h('div.row.row--wrap', { style: { justifyContent: 'center', marginTop: '10px' } },
        drawBtn(1, '单抽'),
        drawBtn(10, '十连'),
        drawBtn(100, '百连')),
      h('div.hint.text-c', { style: { marginTop: '8px' }, text: `物品直接进入背包；等级越高掉落数量与成色越好（当前加成 +${boost}%）。` }));

    infoHost = h('div.grid.grid--2', null,
      h('div.card.card--pad', null,
        sectionTitle('概率公示'),
        h('div.stack.stack--tight', null,
          ...pool.map((p) => h('div.prob', null,
            h('span', { style: { width: '52px' }, class: 'rarity rarity--' + p.rarity }, p.cn),
            h('div.prob__bar', { style: { '--rc': p.color } }, h('i.prob__fill', { style: { width: clamp(p.p * 100, 0.4, 100) + '%', background: p.color } })),
            h('span.num', { style: { width: '52px', textAlign: 'right' }, text: (p.p * 100).toFixed(2) + '%' }),
            h('span.num.dim', { style: { width: '62px', textAlign: 'right' }, text: (eff[p.rarity] * 100).toFixed(2) + '%' })))),
        h('div.hint', { style: { marginTop: '8px' }, text: `左列为当前单抽概率（受保底影响实时变化），右列为长期统计概率。连续 ${ECON.pitySoft} 抽未出金后金/红概率逐级提升，${ECON.pityHard} 抽必出金或红。` }),
        h('div.divider'),
        h('div.kv-grid', null,
          kv('物品总量', thousands(535)),
          kv('白色均价', '¥' + fmtPrice(pool[0].avg)),
          kv('金色均价', '¥' + fmtPrice(pool[4].avg)),
          kv('红色均价', '¥' + fmtPrice(pool[5].avg)),
          kv('已开箱', thousands(S.player.stats.draws)),
          kv('累计投入', '¥' + fmtPrice(S.player.stats.spentOnDraws)))),
      h('div.card.card--pad', null,
        sectionTitle('开箱记录'),
        historyList()));

    resultHost = h('div', { id: 'draw-results' });
    mount(el, h('div.content', null,
      h('div.view__head', null,
        h('div', null,
          h('div.view__title', { text: '抽奖中心' }),
          h('div.view__sub', { text: `单抽 ¥${fmtPrice(ECON.drawPrice)} · 十连 9 折 · 百连 85 折 · 背包 ${bagCount()} / ${bagLimit()} 格` })),
        h('div.row', null,
          h('button.btn.btn--sm', { onclick: () => ctx.go('bag') }, icon('bag', 14), '背包'))),
      stageHost,
      h('div.spacer', { style: { height: '14px' } }),
      infoHost,
      resultHost));
    renderIdle();
  }

  function kv(k, v) {
    return h('div.kv', null, h('span.kv__k', { text: k }), h('span.kv__v', { text: v }));
  }

  function historyList() {
    const hist = loot.drawHistory(8);
    if (!hist.length) return h('div.hint', { style: { marginTop: '8px' }, text: '还没有开箱记录。' });
    return h('div.stack.stack--tight', { style: { marginTop: '8px' } },
      ...hist.map((e) => h('div.row.row--between', null,
        h('div.col', { style: { minWidth: 0 } },
          h('div.fs-12.ellipsis', { text: e.best || '开箱' }),
          h('div.hint', { text: `${e.n} 连 · ${dateTimeStr(e.hour)}` })),
        h('span.fs-12.num.dn', { text: '-¥' + fmtPrice(e.amount ? -e.amount : 0) }))));
  }

  function drawBtn(n, label) {
    const cost = costOf(n);
    const afford = S.player.cash >= cost;
    const disabled = st.busy || !afford || roomLeft() < 1;
    return h('button.btn' + (n === 10 ? '.btn--primary' : ''), {
      disabled,
      dataset: { drawN: String(n) },
      onclick: () => runDraw(n),
      title: roomLeft() < 1 ? '背包已满' : !afford ? '金币不足' : '',
    },
      h('span', { text: label }),
      h('span.num', { style: { opacity: 0.72 }, text: '¥' + fmtPrice(cost) }),
      n > 1 ? h('span.tag', { text: (n === 10 ? ECON.multi10 : ECON.multi100) * 10 + '折' }) : null);
  }

  /** 待机画面：轮盘模式放一条静态卡带，翻卡模式放一张背面卡 */
  function renderIdle() {
    const slot = el.querySelector('#draw-slot');
    if (!slot) return;
    if (st.mode === 'reel') {
      const track = h('div.reel__track');
      const idle = h('div.reel', null,
        h('div.reel__strip', null, track),
        h('div.reel__fade.reel__fade--l'),
        h('div.reel__fade.reel__fade--r'),
        h('div.reel__marker', null, h('i'), h('i')));
      mount(track, ...idleCards(14));
      // 用 .draw__slot--reel 抵消 .draw__stage 的内边距，让卡带与视口等宽，
      // 否则在手机上卡带会被 stage 的 18px 内边距挤压/错位
      mount(slot, h('div.draw__slot--reel', null,
        idle,
        h('div.hint.text-c', { style: { marginTop: '10px' }, text: '选择下方按钮开始开箱 · 卡带滚动后停在你的出货上' })));
      return;
    }
    mount(slot, h('div.draw__stage.draw__stage--center', null,
      h('div.draw__card', { style: { transform: 'rotateY(0deg)' } },
        h('div.draw__face.draw__face--front', null, h('span', { text: 'MONO' }))),
      h('div.hint.text-c', { style: { marginTop: '12px' }, text: '点击下方按钮开始开箱' })));
  }

  /** 待机卡带的填充卡（纯视觉预告，不预支任何掉落随机） */
  function idleCards(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const rar = i % 5 === 0 ? 'blue' : i % 3 === 0 ? 'green' : 'white';
      const list = loot.poolByRarity(rar);
      if (!list.length) continue;
      const def = list[Math.floor(Math.random() * list.length)];
      out.push(h('div.reel__card.reel__preview', {
        style: { '--rc': (RARITY[def.rarity] || RARITY.white).color },
      },
        h('div.reel__band'),
        h('div.reel__img', null, h('b', { text: shortMark(def) })),
        h('div.reel__meta', null,
          h('div.reel__name', { text: def.name }),
          h('div.reel__sub', { text: def.subType }))));
    }
    return out;
  }

  /* ------------------------------------------------------------ 抽奖流程 */

  async function runDraw(n) {
    if (st.busy) return;
    const cost = costOf(n);
    if (S.player.cash < cost) {
      toast('金币不足', { kind: 'bad' });
      return;
    }
    st.busy = true;
    st.results = [];
    const slot = el.querySelector('#draw-slot');
    if (slot) mount(slot, h('div.hint.text-c', { style: { padding: '40px 0' }, text: '正在抽取…' }));

    // 1) 抽奖（扣费 + 入包）
    const per = Math.floor(cost / n);
    const res = loot.drawMany(n, ctx.rng, {
      priceEach: per,
      charge: (amount) => {
        if (S.player.cash < amount) return false;
        S.player.cash -= amount;
        return true;
      },
    });
    st.results = res.results;

    // 2) 揭晓
    if (slot) {
      if (st.mode === 'reel') await runReel(slot, res.results);
      else await runFlip(slot, res.results);
    }

    // 3) 结算
    st.busy = false;
    const best = res.results.reduce(
      (a, b) => (RARITY_ORDER.indexOf(b.rarity) > RARITY_ORDER.indexOf(a.rarity) ? b : a),
      res.results[0],
    );
    const spent = res.spent;
    const back = res.results.reduce((s, r) => s + economy.recycleUnit(r.def, r.inst) * r.qty, 0);
    if (res.blocked) toast(`背包空间不足，仅完成 ${res.results.length} 次`, { kind: 'bad' });
    if (best && (best.rarity === 'gold' || best.rarity === 'red')) {
      toast(`开出 <b>${best.def.name}</b>（${RARITY[best.rarity].cn}）`, { kind: 'good', iconName: 'star', ms: 3600 });
    }
    renderResults(res, { best, spent, back });
    // 不在这里重新 render()：那会把刚渲染好的结算面板整块重建掉，
    // 用户就看不到开箱结果了。按钮可用状态由 onTick 增量刷新。
  }

  /** CS 式轮盘：单抽完整播放，十连/百连首抽完整播放、其余快速扫过 */
  async function runReel(slot, results) {
    if (!results.length) return;
    sfx('suspense');
    const reduce = reduceMotion();
    const first = results[0];
    const wrap = h('div');
    mount(slot, wrap, h('div.hint.text-c', { style: { marginTop: '8px' }, text: '卡带滚动中…' }));

    try {
      if (results.length === 1) {
        await playReel(wrap, first, {
          rng: ctx.rng,
          dur: reduce ? 0 : 5600,
          reduceMotion: reduce,
          onSettle: () => sfxRarity(first.rarity),
        });
      } else {
        await playReel(wrap, first, {
          rng: ctx.rng,
          dur: reduce ? 0 : 5000,
          reduceMotion: reduce,
          onSettle: () => sfxRarity(first.rarity),
        });
        await playMultiReel(wrap, results, { rng: ctx.rng, reduceMotion: reduce });
      }
    } catch (e) {
      console.error('[mono] reel error', e);
      sfxRarity(first.rarity);
    }

    // 结果小标签
    const best = results.reduce(
      (a, b) => (RARITY_ORDER.indexOf(b.rarity) > RARITY_ORDER.indexOf(a.rarity) ? b : a),
      results[0],
    );
    const hint = h('div.hint.text-c', { style: { marginTop: '8px' } },
      h('span', { text: `本次共 ${results.length} 件 · 最佳 ` }),
      h('span', { class: 'rarity rarity--' + best.rarity, text: best.def.name }));
    wrap.appendChild(hint);
    await sleep(reduce ? 60 : 520);
  }

  /** 3D 翻卡：保留为可选表现（十连/百连时逐张翻开） */
  async function runFlip(slot, results) {
    if (!results.length) return;
    sfx('suspense');
    const show = results.slice(0, 60);
    mount(slot, h('div.draw__stage.draw__stage--center', null,
      h('div.row.row--wrap', { style: { justifyContent: 'center', gap: '10px' } },
        ...show.map((r) => cardNode(r)))));
    const cards = Array.from(slot.querySelectorAll('.draw__card'));
    const reduce = reduceMotion();
    for (let i = 0; i < cards.length; i++) {
      await sleep(reduce ? 10 : (i === 0 ? 140 : Math.max(40, 260 - results.length * 2)));
      cards[i].classList.add('is-flipped');
      sfxRarity(show[i].rarity);
      if (i % 12 === 11) await sleep(reduce ? 10 : 120);
    }
    await sleep(reduce ? 20 : 320);
  }

  function cardNode(r) {
    const def = r.def;
    const face = h('div.draw__face.draw__face--back', { style: { '--rc': (RARITY[r.rarity] || RARITY.white).color } },
      h('div.item__bit'),
      h('div.draw__thumb', null, h('b', { text: shortMark(def) })),
      h('div.draw__info', null,
        h('div.item__name', { text: def.name }),
        h('div.row.row--between', { style: { marginTop: '4px' } },
          h('span.fs-11.dim', { text: r.qty > 1 ? '×' + r.qty : def.subType }),
          h('span.fs-11.num', { text: '¥' + fmtPrice(r.unitPrice * r.qty) }))));
    return h('div.draw__card' + (r.rarity === 'gold' || r.rarity === 'red' ? '.draw__reveal' : ''), {
      dataset: { rarity: r.rarity },
    },
      h('div.draw__face.draw__face--front', null, h('span', { text: 'MONO' })),
      face);
  }

  function shortMark(def) {
    const map = { cs2: 'SKIN', compute: 'GPU', hardware: 'PC', assets: 'AST' };
    return map[def.category] || 'ITEM';
  }

  function renderResults(res, agg) {
    if (!res.results.length) {
      mount(resultHost, h('div'));
      return;
    }
    const byRar = {};
    res.results.forEach((r) => {
      byRar[r.rarity] = (byRar[r.rarity] || 0) + 1;
    });
    mount(resultHost, h('div', { style: { marginTop: '14px' } },
      h('div.card.card--pad', null,
        h('div.row.row--between', null,
          h('div.col', { style: { minWidth: 0 } },
            h('div.stat__label', { text: '本次开箱结算' }),
            h('div.row', { style: { gap: '10px', marginTop: '4px', flexWrap: 'wrap' } },
              h('span.fs-13.num', { text: '支出 ¥' + fmtPrice(agg.spent) }),
              h('span.fs-13.num.dn', { text: '回收值 ¥' + fmtPrice(agg.back) }),
              h('span.fs-13', {
                class: agg.back >= agg.spent ? 'up' : 'dn',
                text: (agg.back >= agg.spent ? '↑ ' : '↓ ') + ((agg.back / Math.max(1, agg.spent) - 1) * 100).toFixed(1) + '%',
              })),
            h('div.row', { style: { gap: '6px', marginTop: '8px', flexWrap: 'wrap' } },
              ...RARITY_ORDER.filter((k) => byRar[k]).map((k) => h('span.tag', { style: { borderColor: RARITY[k].color, opacity: 0.9 } }, `${RARITY[k].cn} ×${byRar[k]}`)))),
          h('div.btn-group', null,
            h('button.btn.btn--sm', { onclick: () => ctx.go('bag') }, '查看背包'),
            h('button.btn.btn--sm', { onclick: () => sellAllResults(res.results) }, '全部回收'),
            h('button.btn.btn--sm', { onclick: () => listAllResults(res.results) }, '全部挂单')))),
      h('div.spacer', { style: { height: '12px' } }),
      h('div.iview.iview--list', null,
        ...res.results.slice(0, 30).map((r) => itemUnit({
          def: r.def, inst: r.inst, qty: r.qty, key: r.key,
          price: inv.instValue(r.def, r.inst), showQty: true,
          onClick: () => ctx.go('item', { id: r.def.id }),
        }))),
      res.results.length > 30
        ? h('div.hint.text-c', { style: { marginTop: '10px' }, text: `仅展示前 30 件，其余 ${res.results.length - 30} 件已进入背包` })
        : null));
  }

  function sellAllResults(results) {
    const keys = results.map((r) => r.key).filter((k) => S.player.bag[k]);
    if (!keys.length) {
      toast('这些物品已经不在背包里了', { kind: 'info' });
      return;
    }
    const entries = keys.map((k) => ({ key: k, qty: S.player.bag[k].qty }));
    const total = entries.reduce((s, e) => {
      const inst = S.player.bag[e.key];
      const def = inst && ctx.itemOf(inst.defId);
      return s + (def ? economy.recycleUnit(def, inst) * e.qty : 0);
    }, 0);
    confirmDialog({
      title: '全部回收',
      text: `回收本次开出的 <b>${entries.length}</b> 组物品，预计收入 <b>¥${fmtPrice(total)}</b>。`,
      detail: '回收价低于市价，但无需等待成交；金色/红色档折价更狠，建议走市场。',
    }).then((ok) => {
      if (!ok) return;
      const r = economy.sellBatch(entries, { instant: true });
      toast(`已回收 <b>×${r.n}</b> · 收入 <b>¥${fmtPrice(r.total)}</b>`, { kind: 'good' });
      quest.checkAchievements();
      mount(resultHost, h('div'));
      render();
    });
  }

  function listAllResults(results) {
    const keys = results.map((r) => r.key).filter((k) => S.player.bag[k]).slice(0, 6);
    if (!keys.length) {
      toast('没有可挂单的物品', { kind: 'info' });
      return;
    }
    let done = 0;
    for (const k of keys) {
      const inst = S.player.bag[k];
      const def = inst && ctx.itemOf(inst.defId);
      if (!def) continue;
      const p = trade.suggestPrice(def, inst, 'sell');
      const res = trade.listSell(k, inst.qty, p);
      if (res.ok) done++;
    }
    toast(`已挂单 ${done} 组（按市价 ×1.02 自动定价）`, { kind: done ? 'good' : 'bad' });
    if (done) ctx.go('orders');
  }

  render();
  return {
    el,
    onEnter: () => render(),
    onTick: () => {
      if (st.busy || !el.classList.contains('is-active')) return;
      // 只更新抽奖按钮可用状态，不重建 DOM（重建会打断正在播放的轮盘）
      const room = roomLeft();
      el.querySelectorAll('[data-draw-n]').forEach((b) => {
        const n = Number(b.dataset.drawN);
        const ok = S.player.cash >= costOf(n) && room > 0;
        if (ok) b.removeAttribute('disabled');
        else b.setAttribute('disabled', '');
      });
    },
    onDestroy: () => {},
  };
}
