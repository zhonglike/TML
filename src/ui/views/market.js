/**
 * MONO — 市场
 * 总览（指数 / K 线 / 成交 / 涨跌榜 / 热度）+ 品类浏览 + 搜索筛选。
 */
import {
  h, mount, icon, fmtPrice, money, sectionTitle, chips, searchBar, segmented, emptyState,
  rarityChip, deltaEl, toast, modal,
} from '../ui.js';
import { drawKLine, drawArea, drawVolume, drawSpark, attachCrosshair } from '../charts.js';
import { S } from '../../core/state.js';
import { CATS, CAT_LIST, RARITY, RARITY_ORDER, SORTS } from '../../core/const.js';
import { ITEMS, getItem, searchItems, sortItems, BY_CATEGORY, SUBTYPES } from '../../core/catalog.js';
import * as market from '../../core/market.js';
import * as npc from '../../systems/npc.js';
import * as economy from '../../systems/economy.js';
import * as inv from '../../systems/inventory.js';
import * as trade from '../../systems/trade.js';
import { thousands, clamp, pct } from '../../core/util.js';

const TABS = [
  { id: 'overview', label: '总览' },
  { id: 'browse', label: '品类' },
  { id: 'watch', label: '自选' },
];

export function create(ctx) {
  const el = h('section.view', { dataset: { view: 'market' } });
  const st = {
    tab: 'overview',
    cat: 'all',
    rarity: 'all',
    sort: 'volume-desc',
    search: '',
    size: 1,
    watch: ctx.watchlist || [],
  };
  let bodyHost = null;

  function render() {
    mount(el, h('div.content', null,
      h('div.view__head', null,
        h('div', null,
          h('div.view__title', { text: '市场' }),
          h('div.view__sub', { text: `${ITEMS.length} 种标的 · 指数 ${market.computeIndex().index.toFixed(1)} · ${S.npcs.length} 位 NPC 做市` })),
        h('div.row', null,
          segmented(TABS, st.tab, (id) => {
            st.tab = id;
            render();
          }))),
      (bodyHost = h('div', { id: 'market-body' }))));
    paint();
  }

  function paint() {
    if (st.tab === 'overview') return paintOverview();
    if (st.tab === 'browse') return paintBrowse();
    return paintWatch();
  }

  /* ------------------------------------------------------------ 总览 */
  function paintOverview() {
    const idx = market.computeIndex();
    const moodInfo = market.mood();
    const klineHost = h('div.card.card--pad');
    mount(bodyHost,
      h('div.grid.grid--4', null,
        kpiCard('市场指数', idx.index.toFixed(2), (idx.changeDay >= 0 ? '↑ ' : '↓ ') + Math.abs(idx.changeDay * 100).toFixed(2) + '%', idx.changeDay >= 0),
        kpiCard('情绪', moodInfo.cn, `区间 ${(S.session.mood * 100).toFixed(0)}`, S.session.mood >= 0),
        kpiCard('活跃事件', String(S.events.length), S.events[0] ? S.events[0].cn.slice(0, 14) : '市场平静', S.events.length === 0),
        kpiCard('今日成交额', '¥' + fmtPrice(ITEMS.reduce((s, d) => s + (S.market[d.id] ? S.market[d.id].vol24 * S.market[d.id].p : 0), 0)), '全市场估算', true)),
      h('div.spacer', { style: { height: '14px' } }),
      h('div.card.card--pad', null,
        h('div.row.row--between', null,
          sectionTitle('指数走势'),
          segmented([{ id: '1', label: '日' }, { id: '3', label: '周' }, { id: '9', label: '月' }], String(st.size), (id) => {
            st.size = Number(id);
            paintOverview();
          })),
        h('div.chartbox', { style: { marginTop: '8px' } }, h('canvas.chart', { id: 'idx-chart' }))),
      h('div.spacer', { style: { height: '14px' } }),
      h('div.grid.grid--2', null,
        h('div.card.card--pad', null,
          sectionTitle('24 小时涨幅榜'),
          rankList(market.rankings({ limit: 10, by: 'change-desc', minBase: 1 }), true)),
        h('div.card.card--pad', null,
          sectionTitle('24 小时跌幅榜'),
          rankList(market.rankings({ limit: 10, by: 'change-asc', minBase: 1 }), false))),
      h('div.spacer', { style: { height: '14px' } }),
      h('div.grid.grid--2', null,
        h('div.card.card--pad', null,
          sectionTitle('成交额榜'),
          rankList(market.rankings({ limit: 10, by: 'turnover' }).map((r) => ({ ...r, change: r.change })), true, 'turnover')),
        h('div.card.card--pad', null,
          sectionTitle('事件清单'),
          eventList())));
    const canvas = bodyHost.querySelector('#idx-chart');
    if (canvas) {
      const series = market.indexSeries(160);
      const agg = market.aggregate(series.map((v) => [v, v, v, v, 0]), st.size);
      drawArea(canvas, agg.length > 2 ? agg.map((r) => r[3]) : series, { height: 200 });
    }
    void klineHost;
  }

  function kpiCard(label, value, foot, up) {
    return h('div.kpi', null,
      h('div.stat__label', { text: label }),
      h('div.stat__value.stat__value--sm', { text: value }),
      h('div.stat__delta' + (up ? '.up' : '.dn'), { text: foot }));
  }

  function rankList(rows, isUp, mode) {
    if (!rows.length) return emptyState('暂无数据');
    return h('div.stack.stack--tight', { style: { marginTop: '8px' } },
      ...rows.map((r, i) => h('div.row', { style: { cursor: 'pointer' }, onclick: () => ctx.go('item', { id: r.def.id }) },
        h('span.rank__no', { text: String(i + 1).padStart(2, '0') }),
        h('div.col', { style: { flex: '1', minWidth: 0 } },
          h('div.fs-12.ellipsis', { text: r.def.name }),
          h('div.hint', { text: mode === 'turnover' ? '成交 ¥' + fmtPrice(r.turnover) : r.def.subType })),
        h('div.col', { style: { alignItems: 'flex-end' } },
          h('div.fs-12.num', { text: '¥' + fmtPrice(r.price) }),
          h('span.fs-11' + (r.change >= 0 ? '.up' : '.dn'), { text: (r.change >= 0 ? '↑ ' : '↓ ') + Math.abs(r.change * 100).toFixed(2) + '%' })))));
  }

  function eventList() {
    if (!S.events.length) return h('div.hint', { style: { marginTop: '8px' }, text: '当前没有活跃事件。事件会按品类或单品影响价格，持续一段时间后衰减。' });
    return h('div.stack.stack--tight', { style: { marginTop: '8px' } },
      ...S.events.slice(0, 10).map((e) => h('div.row.row--between', null,
        h('div.col', { style: { minWidth: 0 } },
          h('div.fs-12', { text: e.cn }),
          h('div.hint', { text: e.detail })),
        h('div.col', { style: { alignItems: 'flex-end' } },
          h('span.fs-12' + (e.mult >= 0 ? '.up' : '.dn'), { text: (e.mult >= 0 ? '↑ +' : '↓ ') + (e.mult * 100).toFixed(1) + '%' }),
          h('span.hint', { text: Math.max(0, Math.round(e.endsAt - S.clock.hours)) + ' 小时后结束' })))));
  }

  /* ------------------------------------------------------------ 品类浏览 */
  function paintBrowse() {
    let list = searchItems(st.search, { category: st.cat, rarity: st.rarity });
    list = sortItems(list, st.sort, (d) => (S.market[d.id] ? S.market[d.id].p : d.base), (d, vol) => {
      const m = S.market[d.id];
      if (!m) return 0;
      return vol ? m.vol24 : m.mom;
    });
    const shown = list.slice(0, 240);
    const subList = Array.from(new Set(shown.map((d) => d.subType))).slice(0, 14);

    mount(bodyHost,
      h('div.stack.stack--tight', { style: { marginBottom: '12px' } },
        h('div.row.row--wrap', null,
          searchBar(st.search, (v) => {
            st.search = v;
            paintBrowse();
          }),
          h('select.select', {
            style: { width: 'auto', minWidth: '110px' },
            onchange: (e) => {
              st.sort = e.target.value;
              paintBrowse();
            },
          }, ...SORTS.map((s) => h('option', { value: s.id, selected: s.id === st.sort }, s.cn)))),
        h('div.row.row--wrap', null,
          chips([{ id: 'all', label: '全部品类' }, ...CAT_LIST.map((c) => ({ id: c.id, label: c.name, count: BY_CATEGORY[c.id].length }))], st.cat, (id) => {
            st.cat = id;
            paintBrowse();
          })),
        h('div.row.row--wrap', null,
          chips([{ id: 'all', label: '全稀有度' }, ...RARITY_ORDER.map((r) => ({ id: r, label: RARITY[r].cn }))], st.rarity, (id) => {
            st.rarity = id;
            paintBrowse();
          }))),
      h('div.hint', { style: { marginBottom: '8px' }, text: `匹配 ${list.length} 种${list.length > shown.length ? `，展示前 ${shown.length} 种（请用搜索或筛选缩小范围）` : ''} · 类型：${subList.join(' / ')}` }),
      h('div.iview.iview--list', null,
        ...shown.map((def) => itemRow(def))));
  }

  function itemRow(def) {
    const m = S.market[def.id];
    const p = m ? m.p : def.base;
    const row = h('div.item', {
      style: { '--rc': RARITY[def.rarity].color },
      dataset: { item: def.id },
      onclick: () => ctx.go('item', { id: def.id }),
    },
      h('i.item__bit'),
      h('div.col', { style: { flex: '1', minWidth: 0 } },
        h('div.item__name', { text: def.name }),
        h('div.item__sub', { text: `${def.subType} · 基准 ¥${fmtPrice(def.base)} · 周波动 ${(def.volWeek * 100).toFixed(1)}%` })),
      h('div.col', { style: { width: '54px', flex: '0 0 54px' } },
        h('canvas', { height: 24, style: { width: '54px', height: '24px' } })),
      h('div.col', { style: { alignItems: 'flex-end' } },
        h('div.item__price', { id: 'p-' + def.id, text: '¥' + fmtPrice(p) }),
        h('div.item__meta', { text: (m && m.mom >= 0 ? '↑ ' : '↓ ') + Math.abs((m ? m.mom : 0) * 100).toFixed(2) + '%' })),
      h('button.iconbtn', {
        style: { width: '30px', height: '30px' },
        title: '加入自选',
        onclick: (e) => {
          e.stopPropagation();
          toggleWatch(def.id);
        },
      }, icon('star', 14)));
    setTimeout(() => {
      const c = row.querySelector('canvas');
      if (c) {
        const s = market.series(def.id, 1, 40).map((r) => r[3]);
        drawSpark(c, s, { height: 24 });
      }
    }, 0);
    return row;
  }

  /* ------------------------------------------------------------ 自选 */
  function paintWatch() {
    const ids = st.watch;
    if (!ids.length) {
      mount(bodyHost, h('div.card.card--pad', null,
        emptyState('自选列表为空', '在品类页点击右侧星标即可加入自选', 'star')));
      return;
    }
    mount(bodyHost, h('div.iview.iview--list', null,
      ...ids.map((id) => getItem(id)).filter(Boolean).map((def) => itemRow(def))));
  }

  function toggleWatch(id) {
    const i = st.watch.indexOf(id);
    if (i >= 0) {
      st.watch.splice(i, 1);
      toast('已移出自选');
    } else {
      st.watch.push(id);
      toast('已加入自选');
    }
    ctx.watchlist = st.watch;
    if (st.tab === 'browse') paintBrowse();
    else if (st.tab === 'watch') paintWatch();
  }

  render();
  return {
    el,
    onEnter: (params) => {
      if (params && params.tab) st.tab = params.tab;
      render();
    },
    onTick: () => {
      if (!el.classList.contains('is-active')) return;
      // 增量刷新价格：只改文本，不重建 DOM
      el.querySelectorAll('[data-item]').forEach((node) => {
        const id = node.dataset.item;
        const m = S.market[id];
        if (!m) return;
        const pEl = node.querySelector('.item__price');
        if (pEl) pEl.textContent = '¥' + fmtPrice(m.p);
        const dEl = node.querySelector('.item__meta');
        if (dEl) dEl.textContent = (m.mom >= 0 ? '↑ ' : '↓ ') + Math.abs(m.mom * 100).toFixed(2) + '%';
      });
    },
    onDestroy: () => {},
  };
}
