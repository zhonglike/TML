/**
 * MONO — 拍卖行
 * 进行中拍卖 / 我的标的 / 落槌记录；出价、一口价、送拍。
 */
import {
  h, mount, icon, fmtPrice, sectionTitle, toast, emptyState, segmented, promptDialog, modal,
  confirmDialog, rarityChip, deltaEl,
} from '../ui.js';
import { S, auctionLimit } from '../../core/state.js';
import { getItem } from '../../core/catalog.js';
import * as auction from '../../systems/auction.js';
import * as inv from '../../systems/inventory.js';
import * as economy from '../../systems/economy.js';
import * as quest from '../../systems/quest.js';
import { durStr, clamp, thousands, dateTimeStr } from '../../core/util.js';

export function create(ctx) {
  const el = h('section.view', { dataset: { view: 'auction' } });
  const st = { tab: 'live' };
  let body = null;
  let lastTickAt = 0;

  /**
   * 把「可能失效的 NPC 引用」渲染成可读文字。
   * 存档里出价人/买家存的是 npc id；旧存档或跨版本读档后 id 可能对不上，
   * 直接用会显示 undefined —— 这里统一兜底，界面上永不出现 undefined。
   */
  function nameOf(who, storedName) {
    if (who === 'player' || who === 'me') return '你';
    if (who) {
      const npc = S.npcs.find((n) => n.id === who);
      if (npc && npc.name) return npc.name;
    }
    if (storedName && storedName !== 'undefined' && storedName !== 'null') return storedName;
    return '匿名买家';
  }

  /** 手动刷新：结算过期场次 + 给在场标的推进一次出价 + 补齐到 2 场 */
  function refreshNow() {
    const r = auction.refreshAuctions(ctx.rng);
    if (!r.ok) {
      toast(`刷新冷却中 · 还需 ${durStr(r.wait)}`, { kind: 'info' });
      render();
      return;
    }
    const parts = [];
    if (r.settled) parts.push(`结算 ${r.settled} 场`);
    if (r.bid) parts.push(`${r.bid} 场有新出价`);
    if (r.spawned) parts.push(`新增 ${r.spawned} 场`);
    toast(parts.length ? parts.join(' · ') : '暂时没有新变化', {
      kind: parts.length ? 'good' : 'info',
      iconName: 'refresh',
    });
    render();
  }

  /** 手动刷新的冷却提示 */
  function cooldownText() {
    const left = auction.refreshCooldownLeft();
    return left > 0 ? ` · 刷新冷却 ${durStr(left)}` : ' · 可刷新';
  }

  function render() {
    const live = auction.liveAuctions();
    mount(el, h('div.content', null,
      h('div.view__head', null,
        h('div', null,
          h('div.view__title', { text: '拍卖行' }),
          h('div.view__sub', { text: `${live.length} 场进行中 · 我的送拍位 ${auction.myAuctions().filter((a) => a.status === 'live').length}/${auctionLimit()} · 佣金 5%${cooldownText()}` })),
        h('div.row', null,
          h('button.btn.btn--sm', { onclick: () => refreshNow() }, icon('refresh', 14), '刷新'),
          h('button.btn.btn--sm', { onclick: () => sendDialog() }, icon('plus', 14), '送拍'),
          segmented([{ id: 'live', label: '进行中' }, { id: 'mine', label: '我的' }, { id: 'done', label: '落槌' }], st.tab, (id) => {
            st.tab = id;
            render();
          }))),
      (body = h('div'))));
    paint();
  }

  function paint() {
    if (st.tab === 'live') return paintLive();
    if (st.tab === 'mine') return paintMine();
    return paintDone();
  }

  function paintLive() {
    const list = auction.liveAuctions().filter((a) => a.sellerId !== 'player');
    if (!list.length) {
      mount(body, h('div.card.card--pad', null,
        emptyState('暂时没有正在进行的拍卖', '拍卖场次会随市场推进自动出现，也可以自己送拍', 'auction')));
      return;
    }
    mount(body, h('div.stack', null, ...list.map((a) => auctionCard(a, false))));
  }

  function paintMine() {
    const list = auction.myAuctions();
    if (!list.length) {
      mount(body, h('div.card.card--pad', null,
        emptyState('你还没有送拍过物品', '送拍需要支付 5% 佣金，流拍会退回物品', 'auction'),
        h('div.row', { style: { justifyContent: 'center' } },
          h('button.btn.btn--sm.btn--primary', { onclick: () => sendDialog() }, '立即送拍'))));
      return;
    }
    mount(body, h('div.stack', null, ...list.map((a) => auctionCard(a, true))));
  }

  function paintDone() {
    const list = auction.auctionHistory(50);
    if (!list.length) {
      mount(body, h('div.card.card--pad', null, emptyState('还没有落槌记录')));
      return;
    }
    mount(body, h('div.card.card--pad.panel', null,
      h('table.table', null,
        h('thead', null, h('tr', null,
          h('th', { text: '标的' }),
          h('th', { text: '结果' }),
          h('th.num', { text: '成交价' }),
          h('th', { text: '买家' }),
          h('th', { text: '时间' }))),
        h('tbody', null, ...list.map((a) => h('tr', null,
          h('td', null, h('div.ellipsis', { style: { maxWidth: '220px' }, text: a.name })),
          h('td', null, h('span.tag', { text: a.status === 'sold' ? (a.winnerWho === 'player' ? '我中标' : '成交') : '流拍' })),
          h('td.num', { text: a.high ? '¥' + fmtPrice(a.high.price) : '—' }),
          h('td', { text: a.status === 'sold' ? nameOf(a.winnerWho, a.winner) : '—' }),
          h('td.dim', { text: dateTimeStr(a.settledAt || a.endsAt) })))))));
  }

  function auctionCard(a, mine) {
    const def = getItem(a.itemId);
    const m = S.market[a.itemId];
    const remain = Math.max(0, a.endsAt - S.clock.hours);
    const min = auction.minBid(a);
    const marketP = m ? m.p : (def ? def.base : 0);
    const high = a.high ? a.high.price : null;
    const isLeader = a.high && a.high.who === 'player';
    const delta = high && marketP ? high / marketP - 1 : 0;

    return h('div.card.card--pad', null,
      h('div.row.row--between', { style: { alignItems: 'flex-start' } },
        h('div.col', { style: { minWidth: 0, flex: '1' } },
          h('div.fs-13', { text: a.name }),
          h('div.hint', { text: `${nameOf(a.sellerId, a.sellerName)} 送拍 · 起拍 ¥${fmtPrice(a.start)} · 市价 ¥${fmtPrice(marketP)}` }),
          h('div.row', { style: { gap: '6px', flexWrap: 'wrap', marginTop: '6px' } },
            def ? rarityChip(def.rarity) : null,
            a.inst && a.inst.wear ? h('span.tag', { text: a.inst.wear }) : null,
            a.inst && a.inst.pattern ? h('span.tag', { text: a.inst.pattern }) : null,
            h('span.tag', { text: '剩余 ' + durStr(remain) }))),
        h('div.col', { style: { alignItems: 'flex-end' } },
          h('div.item__price', { text: high ? '¥' + fmtPrice(high) : '暂无出价' }),
          h('div.item__meta', { text: a.high ? nameOf(a.high.who, a.high.name) + (isLeader ? '（你）' : '') : '起拍 ¥' + fmtPrice(a.start) }),
          high ? h('span.fs-11' + (delta >= 0 ? '.up' : '.dn'), { text: (delta >= 0 ? '↑ ' : '↓ ') + Math.abs(delta * 100).toFixed(1) + '% vs 市价' }) : null)),
      high ? h('div.progress', { style: { marginTop: '10px' } },
        h('i.progress__bar', { style: { width: clamp((high / (a.buyout || marketP * 2)) , 0.02, 1) * 100 + '%' } })) : null,
      a.history && a.history.length
        ? h('div.stack--tight.stack', { style: { marginTop: '10px' } },
          ...a.history.slice(0, 3).map((x) => h('div.row.row--between', null,
            h('span.fs-11.dim', { text: x.mine ? '你' : nameOf(null, x.who) }),
            h('span.fs-11.num', { text: '¥' + fmtPrice(x.price) }))))
        : null,
      h('div.btn-group', { style: { marginTop: '12px' } },
        mine
          ? (a.status === 'live'
            ? h('div.hint', { text: '等待买家出价，落槌后自动收款（扣除 5% 佣金）。' })
            : null)
          : [
            h('button.btn.btn--sm', {
              disabled: a.status !== 'live',
              onclick: () => bidDialog(a, min),
            }, '出价 ¥' + fmtPrice(min)),
            a.buyout ? h('button.btn.btn--sm.btn--primary', {
              disabled: a.status !== 'live' || S.player.cash < a.buyout,
              onclick: () => doBid(a, a.buyout, true),
            }, '一口价 ¥' + fmtPrice(a.buyout)) : null,
            h('button.btn.btn--sm.btn--quiet', { onclick: () => showHistory(a) }, '出价记录'),
          ]));
  }

  function bidDialog(a, min) {
    promptDialog({
      title: '出价：' + a.name,
      label: '你的出价（¥）',
      value: min.toFixed(2),
      hint: `最低加价 ¥${fmtPrice(min)}。当前最高 ¥${a.high ? fmtPrice(a.high.price) : '—'}。出价后资金会被冻结，被超越时自动退回。`,
    }).then((v) => {
      if (v == null) return;
      doBid(a, Number(v), false);
    });
  }

  function doBid(a, price, buyout) {
    const r = auction.bid(a.id, price);
    if (!r.ok) {
      const msg = {
        low: `出价必须 ≥ ¥${fmtPrice(r.min)}`,
        'no-cash': '现金不足',
        own: '不能给自己的标的出价',
        closed: '拍卖已结束',
      }[r.reason] || r.reason;
      toast(msg, { kind: 'bad' });
      return;
    }
    toast(`${buyout ? '一口价拿下' : '出价成功'} <b>¥${fmtPrice(price)}</b>`, { kind: 'good' });
    quest.bump('auctionActs', 1);
    quest.daily('d_bids', 1);
    render();
  }

  function showHistory(a) {
    modal({
      title: '出价记录 · ' + a.name,
      render: (body2) => {
        if (!a.history || !a.history.length) {
          body2.appendChild(emptyState('还没有出价记录'));
          return;
        }
        body2.appendChild(h('div.table', null,
          h('table.table.table--compact', null,
            h('thead', null, h('tr', null, h('th', { text: '出价人' }), h('th.num', { text: '价格' }), h('th', { text: '时间' }))),
            h('tbody', null, ...a.history.map((x) => h('tr', null,
              h('td', { text: x.mine ? '你' : nameOf(null, x.who) }),
              h('td.num', { text: '¥' + fmtPrice(x.price) }),
              h('td.dim', { text: dateTimeStr(x.at) })))))));
      },
    });
  }

  /** 送拍：选择背包里的物品 */
  function sendDialog() {
    const entries = inv.bagEntries({ sort: 'price-desc' }).slice(0, 40);
    if (!entries.length) {
      toast('背包里没有可以送拍的物品', { kind: 'bad' });
      return;
    }
    let picked = entries[0];
    let startIn;
    let buyoutIn;
    const dlg = modal({
      title: '送拍物品',
      render: (body2) => {
        const list = h('div.stack--tight.stack', { style: { maxHeight: '220px', overflowY: 'auto' } });
        const priceHost = h('div');
        const paintPrice = () => {
          mount(priceHost, h('div.stack--tight.stack', null,
            h('div.row.row--between', null,
              h('span.field__label', { text: '起拍价' }),
              h('span.hint', { text: '参考市价 ¥' + fmtPrice(S.market[picked.def.id] ? S.market[picked.def.id].p : picked.def.base) })),
            startIn = h('input.input.input--mono', { type: 'number', value: (picked.unitValue * 0.8).toFixed(2) }),
            h('label.field__label', { text: '一口价（可留空）' }),
            buyoutIn = h('input.input.input--mono', { type: 'number', value: (picked.unitValue * 1.6).toFixed(2) }),
            h('div.hint', { text: '起拍价越低越容易吸引竞价；一口价能让急性子买家直接成交。' })));
        };
        entries.forEach((e) => {
          list.appendChild(h('div.item' + (e === picked ? '.is-active' : ''), {
            style: { '--rc': (e.def.color || '#888') },
            onclick: () => {
              picked = e;
              Array.from(list.children).forEach((c) => c.classList.remove('is-active'));
              list.children[entries.indexOf(e)].classList.add('is-active');
              paintPrice();
            },
          },
            h('i.item__bit'),
            h('div.col', { style: { flex: '1', minWidth: 0 } },
              h('div.item__name', { text: e.def.name }),
              h('div.item__sub', { text: [e.inst.wear, e.inst.st ? '暗金' : ''].filter(Boolean).join(' · ') || '标准品相' })),
            h('div.item__price', { text: '×' + e.qty })));
        });
        body2.appendChild(h('div.stack', null, list, h('div.divider'), priceHost));
        paintPrice();
      },
      foot: [
        h('button.btn.btn--ghost', { type: 'button', onclick: () => dlg.close() }, '取消'),
        h('button.btn.btn--primary', {
          type: 'button',
          onclick: () => {
            const start = Number(startIn.value);
            const buyout = Number(buyoutIn.value) || 0;
            if (!(start > 0)) {
              toast('起拍价无效', { kind: 'bad' });
              return;
            }
            const r = auction.createAuction(picked.key, 1, start, buyout);
            dlg.close();
            if (r.ok) {
              toast('已送拍，等待买家出价', { kind: 'good' });
              st.tab = 'mine';
              render();
            } else {
              toast('送拍失败：' + ({
                limit: '送拍位已满', fee: '佣金支付失败', missing: '物品不存在', price: '价格无效',
              }[r.reason] || r.reason), { kind: 'bad' });
            }
          },
        }, '确认送拍'),
      ],
    });
  }

  render();
  return {
    el,
    onEnter: () => render(),
    onTick: () => {
      if (!el.classList.contains('is-active')) return;
      // 拍卖列表刷新放慢：1.2 秒一次会让列表一直跳，读不下去
      const now = Date.now();
      if (now - lastTickAt < 5000) return;
      lastTickAt = now;
      paint();
    },
    onDestroy: () => {},
  };
}
