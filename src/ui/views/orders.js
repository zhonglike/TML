/**
 * MONO — 挂单中心
 * 我的卖单 / 买单：成交进度、成交概率、改价、撤单、剩余时间。
 */
import {
  h, mount, icon, fmtPrice, sectionTitle, toast, confirmDialog, promptDialog, emptyState,
  segmented, rarityChip,
} from '../ui.js';
import { S, listingLimit } from '../../core/state.js';
import { TIME } from '../../core/const.js';
import { getItem } from '../../core/catalog.js';
import * as trade from '../../systems/trade.js';
import { fillChance as fillChanceOf } from '../../systems/trade.js';
import * as economy from '../../systems/economy.js';
import * as inv from '../../systems/inventory.js';
import * as quest from '../../systems/quest.js';
import { durStr, thousands, clamp, dateTimeStr } from '../../core/util.js';

export function create(ctx) {
  const el = h('section.view', { dataset: { view: 'orders' } });
  const st = { tab: 'sell' };
  let body = null;

  function render() {
    const stats = trade.orderStats();
    mount(el, h('div.content', null,
      h('div.view__head', null,
        h('div', null,
          h('div.view__title', { text: '挂单中心' }),
          h('div.view__sub', { text: `${S.player.listings.length}/${listingLimit()} 卖单 · ${S.player.buyOrders.length} 买单 · 冻结资金 ¥${fmtPrice(stats.locked)}` })),
        h('div.row', null,
          segmented([{ id: 'sell', label: '我的卖单' }, { id: 'buy', label: '我的买单' }, { id: 'guide', label: '挂单规则' }], st.tab, (id) => {
            st.tab = id;
            render();
          }))),
      (body = h('div'))));
    paint();
  }

  function paint() {
    if (st.tab === 'sell') return paintSell();
    if (st.tab === 'buy') return paintBuy();
    return paintGuide();
  }

  function paintSell() {
    const list = S.player.listings;
    if (!list.length) {
      mount(body, h('div.card.card--pad', null,
        emptyState('没有在手的卖单', '在背包里选择物品 →「挂单卖出」，设定目标价等待 NPC 吃单', 'list'),
        h('div.row', { style: { justifyContent: 'center' } },
          h('button.btn.btn--sm', { onclick: () => ctx.go('bag') }, '去背包'))));
      return;
    }
    mount(body, h('div.stack', null, ...list.map(sellRow)));
  }

  function sellRow(o) {
    const def = getItem(o.itemId);
    const m = S.market[o.itemId];
    const remain = o.qty - o.filled;
    const price = m ? m.p : (def ? def.base : 0);
    const p = fillChanceOf(o, def, m);
    const refRatio = price ? o.price / price - 1 : 0;
    const remainH = Math.max(0, o.expires - S.clock.hours);
    const progress = o.qty ? o.filled / o.qty : 0;
    return h('div.card.card--pad', null,
      h('div.row.row--between', { style: { alignItems: 'flex-start' } },
        h('div.col', { style: { minWidth: 0, flex: '1' } },
          h('div.fs-13.ellipsis', { text: o.name }),
          h('div.hint', { text: [o.wear, o.st ? '暗金' : '', o.pattern].filter(Boolean).join(' · ') || '标准品相' }),
          h('div.row', { style: { gap: '6px', marginTop: '6px', flexWrap: 'wrap' } },
            h('span.tag', { text: `挂单 ¥${fmtPrice(o.price)}` }),
            h('span.tag', { text: `${refRatio >= 0 ? '高于' : '低于'}市价 ${Math.abs(refRatio * 100).toFixed(1)}%` }),
            h('span.tag', { text: `成交概率 ${(p * 100).toFixed(0)}%/tick` }),
            h('span.tag', { text: `剩余 ${durStr(remainH)}` }))),
        h('div.col', { style: { alignItems: 'flex-end' } },
          h('div.item__price', { text: `×${remain} / ${o.qty}` }),
          h('div.item__meta', { text: `已成交 ${o.filled}` }),
          h('div.hint', { text: `市值 ¥${fmtPrice(price * remain)}` }))),
      h('div.progress', { style: { marginTop: '10px' } },
        h('i.progress__bar', { style: { width: progress * 100 + '%' } })),
      h('div.btn-group', { style: { marginTop: '10px' } },
        h('button.btn.btn--sm', { onclick: () => repriceDialog(o) }, '改价'),
        h('button.btn.btn--sm', {
          onclick: () => {
            const q = ctx.itemOf(o.itemId);
            if (q) ctx.go('item', { id: o.itemId });
          },
        }, '看行情'),
        h('button.btn.btn--sm.btn--danger', {
          onclick: () => {
            confirmDialog({ title: '撤单', text: `撤回 ${o.name} 的剩余 ${remain} 件挂单？`, detail: '物品会回到背包，挂单费不退还。' }).then((ok) => {
              if (!ok) return;
              const r = trade.cancel(o.id);
              if (r.ok) toast(`已撤单，退回 ${r.back} 件`, { kind: 'good' });
              render();
            });
          },
        }, '撤单')));
  }

  function repriceDialog(o) {
    const m = S.market[o.itemId];
    const p = m ? m.p : o.ref;
    const fair = o.fair || o.price;
    promptDialog({
      title: '调整挂单价',
      label: '新的单件挂单价（¥）',
      value: o.price.toFixed(2),
      hint: `市价 ¥${fmtPrice(p)} · 当前品相公允价 ¥${fmtPrice(fair)} · 价格越低成交越快，但利润越薄。`,
    }).then((v) => {
      if (v == null) return;
      const price = Number(v);
      if (!(price > 0)) {
        toast('价格无效', { kind: 'bad' });
        return;
      }
      const remain = o.qty - o.filled;
      // 撤旧挂新
      const back = trade.cancel(o.id);
      if (!back.ok) {
        toast('改价失败', { kind: 'bad' });
        return;
      }
      const entry = inv.bagEntries({}).find((e) => e.def.id === o.itemId);
      const key = entry ? entry.key : null;
      if (!key) {
        toast('物品已回到背包，请重新挂单', { kind: 'info' });
        render();
        return;
      }
      const r = trade.listSell(key, remain, price);
      if (r.ok) toast(`已改价至 ¥${fmtPrice(price)}`, { kind: 'good' });
      else toast('重新挂单失败：' + r.reason, { kind: 'bad' });
      render();
    });
  }

  function paintBuy() {
    const list = S.player.buyOrders;
    if (!list.length) {
      mount(body, h('div.card.card--pad', null,
        emptyState('没有在手的买单', '在物品详情页可以按你的目标价挂买单，资金会被冻结直到成交或过期', 'list'),
        h('div.row', { style: { justifyContent: 'center' } },
          h('button.btn.btn--sm', { onclick: () => ctx.go('market') }, '去市场'))));
      return;
    }
    mount(body, h('div.stack', null, ...list.map((o) => {
      const m = S.market[o.itemId];
      const remain = o.qty - o.filled;
      const p = fillChanceOf(o, getItem(o.itemId) || { liq: 0.5, rarity: 'blue' }, m);
      const refRatio = m ? m.p / o.price - 1 : 0;
      return h('div.card.card--pad', null,
        h('div.row.row--between', null,
          h('div.col', { style: { minWidth: 0 } },
            h('div.fs-13.ellipsis', { text: o.name }),
            h('div.row', { style: { gap: '6px', marginTop: '6px', flexWrap: 'wrap' } },
              h('span.tag', { text: `出价 ¥${fmtPrice(o.price)}` }),
              h('span.tag', { text: `市价 ¥${fmtPrice(m ? m.p : o.ref)}` }),
              h('span.tag', { text: `成交概率 ${(p * 100).toFixed(0)}%/tick` }),
              h('span.tag', { text: `剩余 ${durStr(Math.max(0, o.expires - S.clock.hours))}` }))),
          h('div.col', { style: { alignItems: 'flex-end' } },
            h('div.item__price', { text: `×${remain} / ${o.qty}` }),
            h('div.hint', { text: `冻结 ¥${fmtPrice(remain * o.price)}` }))),
        h('div.progress', { style: { marginTop: '10px' } },
          h('i.progress__bar', { style: { width: (o.qty ? o.filled / o.qty : 0) * 100 + '%' } })),
        h('div.btn-group', { style: { marginTop: '10px' } },
          h('button.btn.btn--sm.btn--primary', {
            onclick: () => {
              const price = m ? m.p * 1.01 : o.price;
              const back = trade.cancelBuy(o.id);
              if (!back.ok) return;
              const r = trade.listBuy(o.itemId, o.qty, price);
              toast(r.ok ? '已改为市价单，成交概率大幅提升' : '调整失败', { kind: r.ok ? 'good' : 'bad' });
              render();
            },
          }, '改为市价单'),
          h('button.btn.btn--sm.btn--danger', {
            onclick: () => {
              const r = trade.cancelBuy(o.id);
              if (r.ok) toast('已撤销买单并退回资金', { kind: 'good' });
              render();
            },
          }, '撤销')));
    })));
  }

  function paintGuide() {
    mount(body, h('div.grid.grid--2', null,
      h('div.card.card--pad', null,
        sectionTitle('挂单如何成交'),
        h('div.stack.stack--tight', null,
          h('div.hint', { text: '每个游戏 tick（6 小时）系统都会为你的挂单掷一次筛子。成交概率由四个因素决定：' }),
          kv('流动性', '白色 ≈100%，红色 ≈20%'),
          kv('相对市价', '越有吸引力概率越高'),
          kv('动量', '上涨时卖单更好卖，下跌时买单更好买'),
          kv('稀有度', '低价物品更容易找到接盘者')),
        h('div.hint', { style: { marginTop: '8px' }, text: `挂单有效期 ${TIME.listingHours} 游戏小时，过期自动退回背包（挂单费不退）。` })),
      h('div.card.card--pad', null,
        sectionTitle('费用与上限'),
        h('div.stack.stack--tight', null,
          kv('挂单费', (0.5) + '% 挂单金额（挂出时扣除）'),
          kv('成交手续费', (ctx.dashboard && 0) + (economy.feeRate() * 100).toFixed(2) + '%'),
          kv('挂单上限', listingLimit() + ' 单（每 5 级 +1）'),
          kv('买单上限', 4 + Math.floor(S.player.level / 8) + ' 单'),
          kv('当前冻结', '¥' + fmtPrice(trade.orderStats().locked))),
        h('div.divider'),
        h('div.hint', { text: '提示：把不急着出手的库存挂在高价位，等于给自己卖了一个「看涨期权」；急需现金时用回收商，或者把价格压到买盘能接受的位置。' }))));
  }

  function kv(k, v) {
    return h('div.kv', null, h('span.kv__k', { text: k }), h('span.kv__v', { text: v }));
  }

  let lastPaint = 0;
  render();
  return {
    el,
    onEnter: () => {
      lastPaint = 0;
      render();
    },
    onTick: () => {
      if (!el.classList.contains('is-active')) return;
      // 挂单进度变化较慢：限频重建，避免高频重排
      const now = Date.now();
      if (now - lastPaint < 1200) return;
      lastPaint = now;
      paint();
    },
    onDestroy: () => {},
  };
}
