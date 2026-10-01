/**
 * MONO — 仪表盘
 * 总资产 / 今日盈亏 / 市场指数 / 情绪 / 事件 / 涨幅榜 / 持仓结构 / 快捷入口
 */
import {
  h, mount, icon, money, fmtPrice, pct, kpi, stat, numEl, sectionTitle, itemUnit, emptyState,
  rarityChip, deltaEl, toast, modal, patchNum, chips,
} from '../ui.js';
import { drawArea } from '../charts.js';
import { S, bagLimit, bagCount } from '../../core/state.js';
import { ITEMS, getItem } from '../../core/catalog.js';
import * as market from '../../core/market.js';
import * as inventory from '../../systems/inventory.js';
import * as quest from '../../systems/quest.js';
import * as economy from '../../systems/economy.js';
import * as loot from '../../systems/loot.js';
import { ECON, RARITY, RARITY_ORDER, CATS } from '../../core/const.js';
import { dateTimeStr, durStr, thousands } from '../../core/util.js';

export function create(ctx) {
  const el = h('section.view', { dataset: { view: 'dashboard' } });
  let refs = {};

  function render() {
    mount(el, h('div.content', null,
      h('div.view__head', null,
        h('div', null,
          h('div.view__title', { text: '仪表盘' }),
          h('div.view__sub', { text: S.player.name + ' · 第 ' + (Math.floor(S.clock.hours / 24) + 1) + ' 天 · 种子 ' + (S.__seed || '—') })),
        h('div.row', null,
          h('button.btn.btn--sm', { onclick: () => ctx.go('records') }, icon('records', 14), '交易记录'),
          h('button.btn.btn--sm.btn--primary', { onclick: () => ctx.go('draw') }, icon('draw', 14), '去开箱'))),
      // KPI 行
      h('div.grid.grid--4', { id: 'dash-kpi' }),
      h('div.spacer', { style: { height: '14px' } }),
      // 指数 + 情绪
      h('div.grid.grid--2', { id: 'dash-index' }),
      h('div.spacer', { style: { height: '14px' } }),
      // 事件 + 快捷
      h('div.grid.grid--2', { id: 'dash-mid' }),
      h('div.spacer', { style: { height: '14px' } }),
      h('div.grid.grid--2', { id: 'dash-lists' }),
      h('div.spacer', { style: { height: '14px' } }),
      h('div', { id: 'dash-holdings' }),
    ));
    capture();
    paint();
  }

  function capture() {
    refs = {
      kpi: el.querySelector('#dash-kpi'),
      index: el.querySelector('#dash-index'),
      mid: el.querySelector('#dash-mid'),
      lists: el.querySelector('#dash-lists'),
      holdings: el.querySelector('#dash-holdings'),
      idxCanvas: null,
      nums: {},
    };
  }

  function paint() {
    const d = ctx.dashboard();
    const stats = S.player.stats;
    // --- KPI
    mount(refs.kpi,
      kpi('总资产', d.equity, { prefix: '¥', foot: `现金 ¥${fmtPrice(d.cash)} · 库存 ¥${fmtPrice(d.bagValue)}` }),
      kpi('今日盈亏', d.dayPnl, {
        prefix: d.dayPnl >= 0 ? '+' : '',
        foot: (d.dayPnlPct >= 0 ? '↑ ' : '↓ ') + Math.abs(d.dayPnlPct * 100).toFixed(2) + '% · 相对开盘',
        class: d.dayPnl >= 0 ? 'up' : 'dn',
      }),
      kpi('市场指数', d.index, {
        prefix: '',
        foot: (d.indexChangeDay >= 0 ? '↑ ' : '↓ ') + Math.abs(d.indexChangeDay * 100).toFixed(2) + '% · 基准 1000',
      }),
      kpi('等级 / 声望', `Lv.${d.level} ${d.rank}`, {
        foot: `经验 ${Math.round(d.xp)} / ${d.xpNeed} · 声望 ${Math.round(d.rep)}`,
        bar: d.xpNeed ? d.xp / d.xpNeed : 0,
        mono: false,
      }));
    // --- 指数图
    const idxBox = h('div.card.card--pad',
      h('div.row.row--between', null,
        h('div.col', null,
          h('div.stat__label', { text: 'MONO 市场指数' }),
          h('div.row', { style: { alignItems: 'baseline', gap: '8px' } },
            numEl(d.index, { style: { fontSize: '22px' } }),
            deltaEl(d.indexChangeDay))),
        h('div.mood', null,
          h('span', { text: d.moodInfo.cn }),
          h('div.mood__mrk', null, h('i', { style: { left: ((S.session.mood + 1) / 2) * 100 + '%' } })))),
      h('div.chartbox', { style: { marginTop: '10px' } },
        h('canvas.chart', { height: 150 })));
    const cand = h('div.card.card--pad',
      h('div.stat__label', { text: '市场气温' }),
      h('div.row.row--between', { style: { marginTop: '6px' } },
        h('span.fs-12.muted', { text: '12 档热度：越亮表示越热' }),
        h('span.fs-11.dim', { text: '成分 ' + 56 + ' 种' })),
      h('div.heat', { style: { marginTop: '8px' } }, ...Array.from({ length: 12 }, (_, i) => {
        const active = Math.round(((S.session.mood + 1) / 2) * 11) >= i;
        return h('i.heat__cell', { style: active ? {} : { background: '#0A0A0A' } });
      })),
      h('div.divider'),
      h('div.kv-grid', null,
        kv('开箱次数', thousands(stats.draws)),
        kv('累计投入', '¥' + fmtPrice(stats.spentOnDraws)),
        kv('实现盈亏', '¥' + fmtPrice(stats.realizedPnl)),
        kv('胜 / 负', stats.wins + ' / ' + stats.losses),
        kv('最大回撤', (S.player.stats.maxDrawdown * 100).toFixed(1) + '%'),
        kv('红装', stats.redsFound + ' 件')));
    mount(refs.index, idxBox, cand);
    drawArea(idxBox.querySelector('canvas'), market.indexSeries(160), { height: 150 });

    // --- 事件 + 快捷入口
    const evCard = h('div.card.card--pad',
      h('div.row.row--between', null,
        h('div.stat__label', { text: '正在发生的市场事件' }),
        h('span.fs-11.dim', { text: S.events.length ? S.events.length + ' 条' : '平静' })));
    if (!S.events.length) {
      evCard.appendChild(h('div.hint', { style: { marginTop: '10px' }, text: '当前没有活跃事件。市场由供需、趋势与随机波动共同驱动。' }));
    } else {
      const list = h('div.stack.stack--tight', { style: { marginTop: '10px' } });
      for (const e of S.events.slice(0, 4)) {
        const remain = Math.max(0, e.endsAt - S.clock.hours);
        list.appendChild(h('div.row.row--between', null,
          h('div.col', { style: { minWidth: 0 } },
            h('div.fs-12', { text: e.cn }),
            h('div.hint.ellipsis', { text: e.detail })),
          h('div.col', { style: { alignItems: 'flex-end' } },
            h('span.fs-12', { class: e.mult >= 0 ? 'up' : 'dn', text: (e.mult >= 0 ? '↑ +' : '↓ ') + (e.mult * 100).toFixed(1) + '%' }),
            h('span.hint', { text: durStr(remain) }))));
      }
      evCard.appendChild(list);
    }

    const quick = h('div.card.card--pad',
      h('div.stat__label', { text: '快捷操作' }),
      h('div.stack.stack--tight', { style: { marginTop: '10px' } },
        quickRow('draw', '抽奖中心', `单抽 ¥${fmtPrice(ECON.drawPrice)} · 十连 ${(ECON.multi10 * 100).toFixed(0)}% · 百连 ${(ECON.multi100 * 100).toFixed(0)}%`, 'draw'),
        quickRow('bag', '背包 / 一键回收', `${d.bagCount} / ${d.bagLimit} 格 · 材料 ${fmtPrice(d.scrap)}`, 'bag'),
        quickRow('market', '市场总览', 'K 线 · 涨跌榜 · 挂单簿', 'market'),
        quickRow('auction', '拍卖行', `${d.auctionsLive} 场进行中`, 'auction'),
        quickRow('quests', '任务与成就', d.canSignIn ? '今日可签到' : `每日交易额度 ${d.dailyLeft} 笔`, 'quests')));
    mount(refs.mid, evCard, quick);

    // --- 涨跌榜
    const up = market.rankings({ limit: 8, by: 'change-desc', minBase: 1 });
    const down = market.rankings({ limit: 8, by: 'change-asc', minBase: 1 });
    mount(refs.lists,
      rankCard('24 小时涨幅榜', up, true),
      rankCard('24 小时跌幅榜', down, false));

    // --- 持仓结构
    const portfolio = inventory.portfolioStats({ rateOf: () => 1 });
    const holdings = h('div.card.card--pad',
      h('div.row.row--between', null,
        h('div.stat__label', { text: '持仓结构' }),
        h('button.btn.btn--sm.btn--quiet', { onclick: () => ctx.go('bag') }, '查看背包', icon('arrowRight', 13))));
    if (!portfolio.count) {
      holdings.appendChild(emptyState('还没有任何持仓', '去抽奖中心开箱，或者直接在市场买入', 'bag'));
    } else {
      const top = inventory.bagEntries({ sort: 'price-desc' }).slice(0, 6);
      const breakdown = inventory.bagBreakdown();
      const total = Object.values(breakdown.byCat).reduce((a, b) => a + b, 0) || 1;
      const barEl = h('div.bar-stack', { style: { marginTop: '10px' } });
      const legend = h('div.legend', { style: { marginTop: '8px' } });
      Object.keys(breakdown.byCat).sort((a, b) => breakdown.byCat[b] - breakdown.byCat[a]).forEach((cat, i) => {
        const w = (breakdown.byCat[cat] / total) * 100;
        const shade = ['rgba(255,255,255,0.85)', 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0.38)', 'rgba(255,255,255,0.2)'][i % 4];
        barEl.appendChild(h('i', { style: { width: w + '%', background: shade }, title: CATS[cat].name }));
        legend.appendChild(h('span', null, h('i', { style: { background: shade } }), CATS[cat].name + ' ' + w.toFixed(0) + '%'));
      });
      holdings.appendChild(barEl);
      holdings.appendChild(legend);
      holdings.appendChild(h('div.divider'));
      const list = h('div.iview.iview--list');
      top.forEach((e) => list.appendChild(itemUnit({
        def: e.def, inst: e.inst, price: e.unitValue, change: e.change, qty: e.qty, key: e.key,
        onClick: () => ctx.go('item', { id: e.def.id }),
      })));
      holdings.appendChild(list);
    }
    mount(refs.holdings, holdings);
  }

  function quickRow(viewId, title, sub, iconName) {
    return h('div.tile', { onclick: () => ctx.go(viewId) },
      h('div.row', null,
        h('span', { style: { color: 'var(--text-2)' } }, icon(iconName, 16)),
        h('div.col', { style: { flex: '1', minWidth: 0 } },
          h('div.fs-13', { text: title }),
          h('div.hint.ellipsis', { text: sub })),
        icon('arrowRight', 14)));
  }

  function rankCard(title, rows, isUp) {
    const card = h('div.card.card--pad', h('div.stat__label', { text: title }));
    if (!rows.length) {
      card.appendChild(emptyState('暂无数据'));
      return card;
    }
    const list = h('div.stack--tight.stack', { style: { marginTop: '8px' } });
    rows.forEach((r, i) => {
      list.appendChild(h('div.row', {
        style: { cursor: 'pointer' },
        onclick: () => ctx.go('item', { id: r.def.id }),
      },
        h('span.rank__no', { text: String(i + 1).padStart(2, '0') }),
        h('div.col', { style: { flex: '1', minWidth: 0 } },
          h('div.fs-12.ellipsis', { text: r.def.name }),
          h('div.hint', { text: r.def.subType })),
        h('div.col', { style: { alignItems: 'flex-end' } },
          h('div.fs-12.num', { text: '¥' + fmtPrice(r.price) }),
          h('span.fs-11', { class: isUp ? 'up' : 'dn', text: (isUp ? '↑ +' : '↓ ') + Math.abs(r.change * 100).toFixed(2) + '%' }))));
    });
    card.appendChild(list);
    return card;
  }

  function kv(k, v) {
    return h('div.kv', null, h('span.kv__k', { text: k }), h('span.kv__v', { text: v }));
  }

  /** 增量刷新：只改数字节点，不重建 DOM */
  function onTick() {
    if (!el.classList.contains('is-active')) return;
    const d = ctx.dashboard();
    const cards = refs.kpi ? Array.from(refs.kpi.children) : [];
    if (cards[0]) patchNum(cards[0].querySelector('.stat__value') ? cards[0] : null, d.equity);
    if (cards[1]) patchNum(cards[1].querySelector('.stat__value') ? cards[1] : null, d.dayPnl);
    if (cards[2]) patchNum(cards[2].querySelector('.stat__value') ? cards[2] : null, d.index);
    const idxVal = refs.index ? refs.index.querySelector('canvas') : null;
    if (idxVal) drawArea(idxVal, market.indexSeries(160), { height: 150 });
    const heat = el.querySelectorAll('.heat__cell');
    const lvl = Math.round(((S.session.mood + 1) / 2) * 11);
    heat.forEach((c, i) => {
      c.style.background = i <= lvl ? '' : '#0A0A0A';
    });
  }

  render();
  return {
    el,
    onEnter: () => {
      render();
    },
    onTick,
    onDestroy: () => {},
  };
}
