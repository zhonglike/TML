/**
 * MONO — 物品详情
 * K 线 / 成交量、报价与盘口、一口价买卖、挂单、价格提醒、我的持仓。
 */
import {
  h, mount, icon, fmtPrice, money, sectionTitle, toast, modal, promptDialog, confirmDialog,
  rarityChip, floatBar, emptyState, segmented, deltaEl,
} from '../ui.js';
import { drawKLine, drawVolume, attachCrosshair } from '../charts.js';
import { S, bagLimit, bagCount } from '../../core/state.js';
import { RARITY, WEAR_BY_ID, WEARS } from '../../core/const.js';
import { getItem, priceFactor, rollCondition } from '../../core/catalog.js';
import * as market from '../../core/market.js';
import * as npc from '../../systems/npc.js';
import * as economy from '../../systems/economy.js';
import * as inv from '../../systems/inventory.js';
import * as trade from '../../systems/trade.js';
import * as quest from '../../systems/quest.js';
import { pushLedger } from '../../core/state.js';
import { bus, thousands, clamp, pct, dateTimeStr, durStr } from '../../core/util.js';

export function create(ctx) {
  const el = h('section.view', { dataset: { view: 'item' } });
  const st = { id: null, size: 1, qty: 1 };
  let unbindCross = null;

  function render() {
    const def = getItem(st.id);
    if (!def) {
      mount(el, h('div.content', null, emptyState('物品不存在', '它可能已被移除', 'info')));
      return;
    }
    const m = S.market[def.id];
    const book = npc.book(def, ctx.rng);
    const best = npc.bestOffer(def);
    const holdings = inv.bagEntries({}).filter((e) => e.def.id === def.id);
    const holdingQty = holdings.reduce((s, e) => s + e.qty, 0);
    const series = market.series(def.id, st.size, 120);
    const volSeries = market.series(def.id, 1, 90);
    const alert = S.player.alerts[def.id];
    const spread = book.asks.length && book.bids.length
      ? (book.asks[0].price / book.bids[0].price - 1)
      : null;

    mount(el, h('div.content', null,
      h('div.row', { style: { marginBottom: '12px' } },
        h('button.iconbtn', { onclick: () => ctx.back(), title: '返回' }, backIcon()),
        h('div.col', { style: { flex: '1', minWidth: 0 } },
          h('div.view__title', { style: { fontSize: '19px' }, text: def.name }),
          h('div.view__sub', { text: `${def.subType} · ${RARITY[def.rarity].cn} · 锚价 ¥${fmtPrice(def.base)} · 周波动 ${(def.volWeek * 100).toFixed(1)}% · 流动性 ${(def.liq * 100).toFixed(0)}%` })),
        h('button.iconbtn', {
          title: alert ? '取消提醒' : '设置价格提醒',
          onclick: () => alertDialog(def),
        }, icon('bell', 15))),
      h('div.grid.grid--4', null,
        kpi('最新价', '¥' + fmtPrice(m.p), (m.mom >= 0 ? '↑ ' : '↓ ') + Math.abs(m.mom * 100).toFixed(2) + '% vs 锚价', m.mom >= 0),
        kpi('24 小时', (market.changeOf(def.id, 24) >= 0 ? '↑ ' : '↓ ') + Math.abs(market.changeOf(def.id, 24) * 100).toFixed(2) + '%', '昨收 ¥' + fmtPrice(market.prevPrice(def.id, 24)), market.changeOf(def.id, 24) >= 0),
        kpi('7 日', (market.changeOf(def.id, 168) >= 0 ? '↑ ' : '↓ ') + Math.abs(market.changeOf(def.id, 168) * 100).toFixed(2) + '%', '一周前 ¥' + fmtPrice(market.prevPrice(def.id, 168)), market.changeOf(def.id, 168) >= 0),
        kpi('今日成交', thousands(m.vol24) + ' 件', spread != null ? '价差 ' + (spread * 100).toFixed(2) + '%' : '盘口稀薄', true)),
      h('div.spacer', { style: { height: '14px' } }),
      h('div.card.card--pad', null,
        h('div.row.row--between', null,
          sectionTitle('价格走势'),
          segmented([{ id: '1', label: '日K' }, { id: '7', label: '周K' }, { id: '30', label: '月K' }], String(st.size), (id) => {
            st.size = Number(id);
            render();
          })),
        h('div.chartbox', { id: 'k-box', style: { marginTop: '8px' } },
          h('canvas.chart', { id: 'k-line' })),
        h('div.legend', { style: { marginTop: '8px' } },
          h('span', null, h('i', { style: { background: 'rgba(255,255,255,0.9)' } }), 'MA7'),
          h('span', null, h('i', { style: { background: 'rgba(255,255,255,0.35)' } }), 'MA30'),
          h('span', { text: '实心亮色 = 收涨，暗灰 = 收跌' })),
        h('div.chartbox', { id: 'v-box', style: { marginTop: '10px' } },
          h('canvas.chart', { id: 'k-vol' }))),
      h('div.spacer', { style: { height: '14px' } }),
      h('div.grid.grid--2', null,
        // 交易面板
        h('div.card.card--pad', null,
          sectionTitle('交易'),
          h('div.stack.stack--tight', { style: { marginTop: '8px' } },
            h('div.row.row--between', null,
              h('div.col', null,
                h('div.field__label', { text: '一口价买入（吃卖单）' }),
                h('div.fs-13.num', { text: '≈ ¥' + fmtPrice(ctx.dashboard().equity >= 0 ? buyEstimate(def) : 0) })),
              h('div.col', { style: { alignItems: 'flex-end' } },
                h('div.field__label', { text: '立即卖出' }),
                h('div.fs-13.num', { text: '≈ ¥' + fmtPrice(economy.quoteSell(def, {}).net) }))),
            qtyRow(def, book),
            h('div.btn-group', null,
              h('button.btn.btn--sm.btn--primary', { onclick: () => doBuy(def, book) }, '买入'),
              h('button.btn.btn--sm', { onclick: () => doSellNow(def, holdings) }, '一口价卖出'),
              h('button.btn.btn--sm', { onclick: () => buyOrderDialog(def) }, '挂买单'),
              h('button.btn.btn--sm', { onclick: () => listHoldingsDialog(def, holdings) }, '挂卖单')),
            h('div.hint', { text: `买入价包含 ${(ctx.dashboard() && 0)}手续费与价差；回收商折价约 ${((1 - economy.recycleRate()) * 100).toFixed(0)}%，市价卖出按 NPC 买盘成交。` }))),
        // 盘口
        h('div.card.card--pad', null,
          sectionTitle('盘口'),
          h('div.stack.stack--tight', { style: { marginTop: '8px' } },
            book.asks.length || book.bids.length
              ? h('div', null, ...book.asks.slice(0, 5).reverse().map(askRow), askRow({ price: m.p, qty: 0, mid: true }), ...book.bids.slice(0, 5).map(bidRow))
              : h('div.hint', { text: '当前没有 NPC 挂单。等待市场刷新，或直接在品类页用一口价交易。' }),
            h('div.hint', { text: `最佳买盘 ${book.bids[0] ? '¥' + fmtPrice(book.bids[0].price) : '—'} · 最佳卖盘 ${book.asks[0] ? '¥' + fmtPrice(book.asks[0].price) : '—'} · 最后成交 ${m.lastTradeHour ? durStr(Math.max(0, S.clock.hours - m.lastTradeHour)) + '前' : '—'}` })))),
      h('div.spacer', { style: { height: '14px' } }),
      h('div.grid.grid--2', null,
        h('div.card.card--pad', null,
          sectionTitle('我的持仓'),
          holdingQty
            ? h('div.stack.stack--tight', { style: { marginTop: '8px' } },
              ...holdings.map((e) => h('div.row.row--between', null,
                h('div.col', { style: { minWidth: 0 } },
                  h('div.fs-12', { text: [e.inst.wear, e.inst.st ? '暗金' : '', e.inst.pattern].filter(Boolean).join(' · ') || '标准品相' }),
                  h('div.hint', { text: `成本 ¥${fmtPrice(e.inst.cost)} · 现值 ¥${fmtPrice(e.unitValue)}` })),
                h('div.col', { style: { alignItems: 'flex-end' } },
                  h('div.fs-12.num', { text: '×' + e.qty }),
                  h('div.fs-11' + (e.pnl >= 0 ? '.up' : '.dn'), { text: (e.pnl >= 0 ? '+' : '') + '¥' + fmtPrice(e.pnl) })))))
            : h('div.hint', { style: { marginTop: '8px' }, text: '未持有该物品。' })),
        h('div.card.card--pad', null,
          sectionTitle('物品说明'),
          h('div.stack.stack--tight', { style: { marginTop: '8px' } },
            h('div', { style: { marginBottom: '6px' } }, rarityChip(def.rarity)),
            h('div.hint', { text: def.desc || '暂无说明。' }),
            h('div.divider'),
            h('div.kv-grid', null,
              kv('品类', def.category),
              kv('类型', def.subType),
              kv('基准价', '¥' + fmtPrice(def.base)),
              kv('价格区间', '¥' + fmtPrice(def.min) + '–¥' + fmtPrice(def.max)),
              kv('是否带磨损', def.float ? '是' : '否'),
              kv('暗金版本', def.stattrak ? '有' : '无'),
              def.pattern ? kv('模板', def.pattern) : null,
              def.unit ? kv('单位', def.unit) : null),
            def.float ? h('div', { style: { marginTop: '10px' } },
              h('div.field__label', { text: '磨损档位与价格系数' }),
              h('div.stack--tight.stack', null,
                ...WEARS.map((w) => h('div.row.row--between', null,
                  h('span.fs-11', { text: `${w.cn} ${w.id}` }),
                  h('span.fs-11.num.dim', { text: (w.scale * 100).toFixed(0) + '% 锚价' }))))) : null,
            alert ? h('div.alert', { style: { marginTop: '10px' } },
              icon('bell', 15),
              h('div', null,
                h('div', { text: `提醒中：${alert.above ? '涨到 ¥' + fmtPrice(alert.above) : ''}${alert.above && alert.below ? ' / ' : ''}${alert.below ? '跌到 ¥' + fmtPrice(alert.below) : ''}` }),
                h('div.hint', { text: '设置基准 ¥' + fmtPrice(alert.base) }))) : null)))
    ));

    // 图表
    const kc = el.querySelector('#k-line');
    if (kc) {
      const meta = { labelOf: (i) => `第 ${i + 1} 根` };
      drawKLine(kc, series, { height: 220, ma: true });
      if (unbindCross) unbindCross();
      unbindCross = attachCrosshair(kc, series, meta);
    }
    const vc = el.querySelector('#k-vol');
    if (vc) drawVolume(vc, volSeries, { height: 72 });
  }

  function backIcon() {
    const s = icon('arrowRight', 15);
    s.style.transform = 'rotate(180deg)';
    return s;
  }

  function kpi(label, value, foot, up) {    return h('div.kpi', null,
      h('div.stat__label', { text: label }),
      h('div.stat__value.stat__value--sm', { text: value }),
      h('div.stat__delta' + (up ? '.up' : '.dn'), { text: foot }));
  }

  function kv(k, v) {
    return h('div.kv', null, h('span.kv__k', { text: k }), h('span.kv__v', { text: String(v) }));
  }

  function askRow(a) {
    const max = Math.max(1, ...(S.market[st.id].asks || []).map((x) => x.qty));
    return h('div.depth__row' + (a.mid ? '' : '.depth__row--ask'), null,
      h('i.depth__bar', { style: { width: a.mid ? '100%' : ((a.qty / max) * 100) + '%', opacity: a.mid ? 0.3 : 1 } }),
      h('span', { text: (a.mid ? '— 当前 ' : '') + '¥' + fmtPrice(a.price) }),
      h('span', { text: a.mid ? '' : '×' + thousands(Math.round(a.qty)) }));
  }

  function bidRow(b) {
    const max = Math.max(1, ...(S.market[st.id].bids || []).map((x) => x.qty));
    return h('div.depth__row', null,
      h('i.depth__bar', { style: { width: ((b.qty / max) * 100) + '%' } }),
      h('span', { text: '¥' + fmtPrice(b.price) }),
      h('span', { text: '×' + thousands(Math.round(b.qty)) }));
  }

  function buyEstimate(def) {
    return economy.quoteBuy(def, {}).total;
  }

  function qtyRow(def, book) {
    const input = h('input.input.input--mono', {
      type: 'number', min: 1, value: String(st.qty), style: { width: '92px' },
    });
    input.addEventListener('input', () => {
      st.qty = Math.max(1, Math.floor(Number(input.value) || 1));
    });
    const max = Math.max(1, book.asks.reduce((s, a) => s + a.qty, 0));
    return h('div.row', null,
      h('span.field__label', { text: '数量' }),
      input,
      h('button.btn.btn--sm.btn--ghost', { onclick: () => { st.qty = 1; input.value = '1'; } }, '1'),
      h('button.btn.btn--sm.btn--ghost', { onclick: () => { st.qty = Math.min(50, max); input.value = String(st.qty); } }, '盘口量'),
      S.player.cash > 0 ? h('span.hint', { text: '可用现金 ¥' + fmtPrice(S.player.cash) }) : null);
  }

  function roomLeft() {
    return bagLimit() - bagCount();
  }

  function doBuy(def, book) {
    const qty = st.qty;
    const r = npc.takeAsks(def, qty, ctx.rng);
    if (!r.qty) {
      toast('盘口没有足够的卖单', { kind: 'bad' });
      return;
    }
    if (S.player.cash < r.total) {
      toast('现金不足，需要 ¥' + fmtPrice(r.total), { kind: 'bad' });
      return;
    }
    if (roomLeft() < r.qty) {
      toast('背包空间不足', { kind: 'bad' });
      return;
    }
    S.player.cash -= r.total;
    const key = inv.add(def.id, { qty: r.qty, cost: r.avg, from: 'market' });
    market.applyImpact(def, r.total, 1);
    quest.bump('buys', 1);
    quest.daily('d_buys', 1);
    S.player.stats.buyVolume += r.total;
    S.player.stats.trades++;
    pushLedger({ type: 'buy', itemId: def.id, name: def.name, qty: r.qty, price: r.avg, amount: -r.total, note: '一口价买入' });
    bus.emit('trade', { side: 'buy', def, qty: r.qty, unit: r.avg, total: r.total });
    toast(`买入 <b>×${r.qty}</b> @ ¥${fmtPrice(r.avg)} · 支出 <b>¥${fmtPrice(r.total)}</b>`, { kind: 'good' });
    quest.checkAchievements();
    void key;
    render();
  }

  function doSellNow(def, holdings) {
    if (!holdings.length) {
      toast('未持有该物品', { kind: 'bad' });
      return;
    }
    const e = holdings[0];
    const r = economy.sell(e.key, Math.min(st.qty, e.qty), { instant: false });
    if (r.ok) toast(`卖出 <b>×${r.qty}</b> · 收入 <b>¥${fmtPrice(r.total)}</b>`, { kind: 'good' });
    else toast('卖出失败', { kind: 'bad' });
    quest.checkAchievements();
    render();
  }

  function listHoldingsDialog(def, holdings) {
    if (!holdings.length) {
      toast('未持有该物品', { kind: 'bad' });
      return;
    }
    const e = holdings[0];
    const sug = trade.suggestPrice(def, e.inst, 'sell');
    promptDialog({
      title: '挂单卖出',
      label: '单件挂单价（¥）',
      value: sug.toFixed(2),
      hint: `市价参考 ¥${fmtPrice(S.market[def.id].p)} · 当前品相估值 ¥${fmtPrice(e.unitValue)}`,
    }).then((v) => {
      if (v == null) return;
      const r = trade.listSell(e.key, Math.min(st.qty, e.qty), Number(v));
      if (r.ok) {
        toast('已挂单', { kind: 'good' });
        ctx.go('orders');
      } else toast('挂单失败：' + r.reason, { kind: 'bad' });
    });
  }

  function buyOrderDialog(def) {
    const p = S.market[def.id].p;
    promptDialog({
      title: '挂买单：' + def.name,
      label: '单件出价（¥）',
      value: (p * 0.97).toFixed(2),
      hint: `当前市价 ¥${fmtPrice(p)}。出价越接近或高于市价，成交越快；资金会被冻结直到成交或过期。`,
    }).then((v) => {
      if (v == null) return;
      const r = trade.listBuy(def.id, st.qty, Number(v));
      if (r.ok) {
        toast('买单已挂出', { kind: 'good' });
        ctx.go('orders');
      } else toast('挂单失败：' + r.reason, { kind: 'bad' });
    });
  }

  function alertDialog(def) {
    const m = S.market[def.id];
    const above = S.player.alerts[def.id] ? S.player.alerts[def.id].above : null;
    const below = S.player.alerts[def.id] ? S.player.alerts[def.id].below : null;
    let aIn;
    let bIn;
    const dlg = modal({
      title: '价格提醒：' + def.name,
      render: (body) => {
        aIn = h('input.input.input--mono', { type: 'number', value: above != null ? String(above) : '', placeholder: '涨到该价格时提醒' });
        bIn = h('input.input.input--mono', { type: 'number', value: below != null ? String(below) : '', placeholder: '跌到该价格时提醒' });
        body.appendChild(h('div.stack', null,
          h('div.hint', { text: `当前价 ¥${fmtPrice(m.p)}。留空表示不设置该方向。` }),
          h('label.field__label', { text: '上限提醒' }), aIn,
          h('label.field__label', { text: '下限提醒' }), bIn));
      },
      foot: [
        h('button.btn.btn--ghost', { type: 'button', onclick: () => { ctx.clearAlert(def.id); dlg.close(); toast('已取消提醒'); render(); } }, '清除'),
        h('button.btn.btn--primary', {
          type: 'button',
          onclick: () => {
            ctx.setAlert(def.id, { above: Number(aIn.value) || null, below: Number(bIn.value) || null });
            dlg.close();
            toast('提醒已设置', { kind: 'good' });
            render();
          },
        }, '保存'),
      ],
    });
  }

  render();
  return {
    el,
    onEnter: (params) => {
      if (params && params.id) st.id = params.id;
      if (!st.id) st.id = ctx.lastItemId || 'ak47-redline';
      ctx.lastItemId = st.id;
      render();
    },
    onTick: () => {
      if (!el.classList.contains('is-active') || !st.id) return;
      const m = S.market[st.id];
      const def = getItem(st.id);
      if (!m || !def) return;
      const kc = el.querySelector('#k-line');
      if (kc) drawKLine(kc, market.series(st.id, st.size, 120), { height: 220, ma: true });
      const vc = el.querySelector('#k-vol');
      if (vc) drawVolume(vc, market.series(st.id, 1, 90), { height: 72 });
    },
    onDestroy: () => {
      if (unbindCross) unbindCross();
    },
  };
}
