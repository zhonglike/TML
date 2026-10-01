/**
 * MONO — 交易记录 / 经营报表
 * 流水账、统计指标、资产净值曲线、导出 CSV。
 */
import {
  h, mount, icon, fmtPrice, sectionTitle, emptyState, segmented, toast, chips,
} from '../ui.js';
import { drawArea } from '../charts.js';
import { S } from '../../core/state.js';
import * as quest from '../../systems/quest.js';
import { getItem } from '../../core/catalog.js';
import { dateTimeStr, thousands, pct, clamp } from '../../core/util.js';

const KIND_CN = {
  buy: '买入',
  sell: '卖出',
  draw: '开箱',
  'limit-sell': '挂单成交',
  'limit-buy': '买单成交',
  'list-done': '挂单完成',
  cancel: '撤单',
  expired: '过期退回',
  quest: '任务奖励',
  signin: '签到',
  achievement: '成就',
  scrap: '熔炼',
  'auction-win': '拍卖中标',
  'auction-sell': '拍卖卖出',
  'auction-unsold': '流拍退回',
};

const FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'trade', label: '交易' },
  { id: 'draw', label: '开箱' },
  { id: 'reward', label: '奖励' },
  { id: 'auction', label: '拍卖' },
];

export function create(ctx) {
  const el = h('section.view', { dataset: { view: 'records' } });
  const st = { filter: 'all' };
  let body = null;

  function pass(e) {
    if (st.filter === 'all') return true;
    if (st.filter === 'trade') return ['buy', 'sell', 'limit-sell', 'limit-buy', 'list-done', 'cancel', 'expired'].includes(e.type);
    if (st.filter === 'draw') return e.type === 'draw';
    if (st.filter === 'reward') return ['quest', 'signin', 'achievement'].includes(e.type);
    if (st.filter === 'auction') return String(e.type).startsWith('auction');
    return true;
  }

  function render() {
    const stats = S.player.stats;
    const ledger = S.player.ledger;
    const rows = ledger.filter(pass);
    const d = ctx.dashboard();

    mount(el, h('div.content', null,
      h('div.view__head', null,
        h('div', null,
          h('div.view__title', { text: '交易记录' }),
          h('div.view__sub', { text: `${ledger.length} 条流水（最近 500 条保留）· 实现盈亏 ${stats.realizedPnl >= 0 ? '+' : ''}¥${fmtPrice(stats.realizedPnl)}` })),
        h('div.row', null,
          h('button.btn.btn--sm', { onclick: exportCsv }, icon('download', 14), '导出 CSV'))),
      h('div.grid.grid--4', null,
        kpi('总成交额', '¥' + fmtPrice(stats.buyVolume + stats.sellVolume), `买入 ¥${fmtPrice(stats.buyVolume)} / 卖出 ¥${fmtPrice(stats.sellVolume)}`),
        kpi('盈亏笔数', `${stats.wins} : ${stats.losses}`, `胜率 ${stats.wins + stats.losses ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(0) : '—'}%`),
        kpi('手续费合计', '¥' + fmtPrice(stats.feesPaid), '含挂单费、佣金与成交税'),
        kpi('最大回撤', (stats.maxDrawdown * 100).toFixed(1) + '%', `峰值资产 ¥${fmtPrice(stats.peakEquity)}`)),
      h('div.spacer', { style: { height: '14px' } }),
      h('div.card.card--pad', null,
        sectionTitle('资产净值曲线'),
        h('div.chartbox', { style: { marginTop: '8px' } },
          h('canvas.chart', { id: 'eq-chart' })),
        h('div.legend', { style: { marginTop: '8px' } },
          h('span', { text: `起始 ¥${fmtPrice(5000)}` }),
          h('span', { text: `当前 ¥${fmtPrice(d.equity)}` }),
          h('span', { text: `倍数 ${(d.equity / 5000).toFixed(2)}×` }))),
      h('div.spacer', { style: { height: '14px' } }),
      h('div.card.card--pad', { style: { padding: 0 } },
        h('div.row.row--between', { style: { padding: '12px 14px' } },
          sectionTitle('流水'),
          chips(FILTERS, st.filter, (id) => {
            st.filter = id;
            render();
          })),
        h('div', { id: 'ledger-host', style: { padding: '0 14px 14px' } },
          rows.length
            ? h('div.table-wrap', null, h('table.table', null,
              h('thead', null, h('tr', null,
                h('th', { text: '类型' }),
                h('th', { text: '标的' }),
                h('th.num', { text: '数量' }),
                h('th.num', { text: '单价' }),
                h('th.num', { text: '金额' }),
                h('th.num', { text: '盈亏' }),
                h('th', { text: '游戏时间' }))),
              h('tbody', null, ...rows.slice(0, 200).map((e) => h('tr', null,
                h('td', null, h('span.tag', { text: KIND_CN[e.type] || e.type })),
                h('td', null, h('div.ellipsis', { style: { maxWidth: '230px' }, text: e.name || e.note || '—' })),
                h('td.num', { text: e.qty ? '×' + e.qty : e.n ? e.n + ' 连' : '—' }),
                h('td.num', { text: e.price ? '¥' + fmtPrice(e.price) : '—' }),
                h('td.num', { class: (e.amount || 0) >= 0 ? 'up' : 'dn', text: (e.amount >= 0 ? '+' : '') + (e.amount ? '¥' + fmtPrice(e.amount) : '—') }),
                h('td.num', { class: (e.profit || 0) >= 0 ? 'up' : 'dn', text: e.profit != null ? (e.profit >= 0 ? '+' : '') + '¥' + fmtPrice(e.profit) : '—' }),
                h('td.dim', { text: dateTimeStr(e.hour) }))))))
            : emptyState('还没有流水记录', '完成一次开箱或交易后这里会留下记录', 'records'))),
      h('div.spacer', { style: { height: '14px' } }),
      h('div.card.card--pad', null,
        sectionTitle('经营指标'),
        h('div.kv-grid', null,
          kv('累计开箱', thousands(stats.draws) + ' 次'),
          kv('开箱支出', '¥' + fmtPrice(stats.spentOnDraws)),
          kv('金色出货', stats.goldsFound + ' 件'),
          kv('红色出货', stats.redsFound + ' 件'),
          kv('最好一笔', '+' + '¥' + fmtPrice(Math.max(0, stats.bestTrade))),
          kv('最差一笔', '-' + '¥' + fmtPrice(Math.abs(Math.min(0, stats.worstTrade)))),
          kv('单项最大持仓', inventoryMaxHold() + ' 件'),
          kv('图鉴进度', Object.keys(S.player.seen).length + ' / 535')),
        h('div.divider'),
        h('div.hint', { text: '资产净值曲线按游戏日记录，数值 = 现金 + 库存市值（按当前市价计）。' }))
    ));
    const canvas = el.querySelector('#eq-chart');
    if (canvas) {
      const series = S.session.equity.slice(-160);
      drawArea(canvas, series.length >= 2 ? series : [5000, d.equity], { height: 190 });
    }
  }

  function inventoryMaxHold() {
    const byDef = {};
    for (const k in S.player.bag) {
      const inst = S.player.bag[k];
      byDef[inst.defId] = (byDef[inst.defId] || 0) + inst.qty;
    }
    return Object.values(byDef).reduce((a, b) => Math.max(a, b), 0);
  }

  function kpi(label, value, foot) {
    return h('div.kpi', null,
      h('div.stat__label', { text: label }),
      h('div.stat__value.stat__value--sm', { text: value }),
      h('div.stat__delta', { text: foot }));
  }

  function kv(k, v) {
    return h('div.kv', null, h('span.kv__k', { text: k }), h('span.kv__v', { text: v }));
  }

  function exportCsv() {
    const head = ['时间', '类型', '标的', '数量', '单价', '金额', '成本', '盈亏'];
    const lines = [head.join(',')];
    for (const e of S.player.ledger) {
      lines.push([
        dateTimeStr(e.hour),
        KIND_CN[e.type] || e.type,
        '"' + String(e.name || e.note || '').replace(/"/g, '""') + '"',
        e.qty || e.n || '',
        e.price != null ? e.price.toFixed(2) : '',
        e.amount != null ? e.amount.toFixed(2) : '',
        e.cost != null ? e.cost.toFixed(2) : '',
        e.profit != null ? e.profit.toFixed(2) : '',
      ].join(','));
    }
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mono-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 800);
    toast('已导出流水 CSV', { kind: 'good' });
  }

  render();
  return {
    el,
    onEnter: () => render(),
    onTick: () => {},
    onDestroy: () => {},
  };
}
