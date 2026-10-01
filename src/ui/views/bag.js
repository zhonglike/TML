/**
 * MONO — 背包
 * 网格 / 列表视图、筛选排序、单件与批量卖出、熔炼材料、持仓盈亏。
 */
import {
  h, mount, icon, fmtPrice, money, sectionTitle, itemUnit, emptyState, chips, searchBar,
  segmented, toast, modal, confirmDialog, promptDialog, rarityChip, floatBar, deltaEl, pct,
} from '../ui.js';
import { S, bagCount, bagLimit } from '../../core/state.js';
import { CATS, CAT_LIST, RARITY, RARITY_ORDER, SORTS, ECON } from '../../core/const.js';
import * as inv from '../../systems/inventory.js';
import * as economy from '../../systems/economy.js';
import * as trade from '../../systems/trade.js';
import * as loot from '../../systems/loot.js';
import * as quest from '../../systems/quest.js';
import { RARITY_RANK } from '../../core/const.js';

const LS_VIEW = 'mono.bag.view';

export function create(ctx) {
  const el = h('section.view', { dataset: { view: 'bag' } });
  const state = {
    cat: 'all',
    rarity: 'all',
    sort: 'price-desc',
    search: '',
    mode: localStorage.getItem(LS_VIEW) || 'grid',
    selected: new Set(),
    onlyProfit: false,
  };
  let listHost = null;
  let headHost = null;
  let footHost = null;

  function filtered() {
    let rows = inv.bagEntries({ sort: state.sort, search: state.search });
    if (state.cat !== 'all') rows = rows.filter((r) => r.def.category === state.cat);
    if (state.rarity !== 'all') rows = rows.filter((r) => r.def.rarity === state.rarity);
    if (state.onlyProfit) rows = rows.filter((r) => r.pnl > 0);
    return rows;
  }

  function render() {
    const portfolio = inv.portfolioStats({ rateOf: () => 1 });
    const rows = filtered();
    const selValue = rowsValue(rows);

    const title = h('div', null,
      h('div.view__title', { text: '背包' }),
      h('div.view__sub', {
        text: `${bagCount()} / ${bagLimit()} 格 · 库存市值 ¥${fmtPrice(portfolio.marketValue)} · 浮盈 ${portfolio.unrealized >= 0 ? '+' : ''}¥${fmtPrice(portfolio.unrealized)}`,
      }));

    const modeBtn = h('button.btn.btn--sm' + (state.mode === 'grid' ? '.btn--primary' : ''), {
      onclick: () => {
        state.mode = state.mode === 'grid' ? 'list' : 'grid';
        localStorage.setItem(LS_VIEW, state.mode);
        render();
      },
    }, icon(state.mode === 'grid' ? 'grid' : 'list', 14), state.mode === 'grid' ? '网格' : '列表');

    const actions = h('div.btn-group', null,
      modeBtn,
      h('button.btn.btn--sm', { onclick: recycleDialog }, icon('refresh', 14), '一键回收'),
      h('button.btn.btn--sm', { onclick: scrapDialog }, icon('bolt', 14), '熔炼'));

    const sortSelect = h('select.select', {
      style: { width: 'auto', minWidth: '104px' },
      onchange: (e) => {
        state.sort = e.target.value;
        renderList();
      },
    }, ...SORTS.map((s) => h('option', { value: s.id, selected: s.id === state.sort }, s.cn)));

    const searchRow = h('div.row.row--wrap', null,
      searchBar(state.search, (v) => {
        state.search = v;
        renderList();
      }),
      sortSelect);

    const catChips = chips(
      [{ id: 'all', label: '全部' }, ...CAT_LIST.map((c) => ({ id: c.id, label: c.short }))],
      state.cat,
      (id) => {
        state.cat = id;
        render();
      },
    );

    const rarityChips = chips(
      [{ id: 'all', label: '全稀有度' }, ...RARITY_ORDER.map((r) => ({ id: r, label: RARITY[r].cn }))],
      state.rarity,
      (id) => {
        state.rarity = id;
        render();
      },
    );

    const profitChip = h('button.chip' + (state.onlyProfit ? '.is-active' : ''), {
      onclick: () => {
        state.onlyProfit = !state.onlyProfit;
        render();
      },
    }, '只看浮盈');

    const chipRow = h('div.row.row--wrap', null, catChips, rarityChips, profitChip);
    const filterStack = h('div.stack.stack--tight', { style: { marginBottom: '12px' } }, searchRow, chipRow);
    headHost = h('div', null, h('div.view__head', null, title, actions), filterStack);

    listHost = h('div', { id: 'bag-list' });
    footHost = h('div');
    mount(el, h('div.content', null, headHost, listHost, footHost));
    renderList();
    renderFoot(rows, selValue);
  }

  function rowsValue(rows) {
    return rows.reduce((s, r) => s + r.total, 0);
  }

  function renderList() {
    const rows = filtered();
    if (!rows.length) {
      mount(listHost, h('div.card.card--pad', null,
        emptyState('背包是空的', '去抽奖中心开箱，或在市场里低买高卖', 'bag')));
      return;
    }
    const grid = h('div.iview' + (state.mode === 'list' ? '.iview--list' : ''));
    rows.forEach((r) => {
      const unit = itemUnit({
        def: r.def, inst: r.inst, price: r.unitValue, change: r.change, qty: r.qty, key: r.key,
        mode: state.mode === 'list' ? 'list' : 'grid',
        onClick: () => detail(r),
      });
      // 选中态 & 长按多选
      if (state.selected.has(r.key)) unit.classList.add('is-active');
      unit.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        toggleSelect(r.key, unit);
      });
      let pressTimer = 0;
      unit.addEventListener('pointerdown', () => {
        pressTimer = setTimeout(() => {
          toggleSelect(r.key, unit);
        }, 480);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) =>
        unit.addEventListener(ev, () => clearTimeout(pressTimer)));
      grid.appendChild(unit);
    });
    mount(listHost, grid);
    renderFoot(rows, rowsValue(rows));
  }

  function toggleSelect(key, node) {
    if (state.selected.has(key)) state.selected.delete(key);
    else state.selected.add(key);
    if (node) node.classList.toggle('is-active', state.selected.has(key));
    renderFoot(filtered(), rowsValue(filtered()));
  }

  function renderFoot(rows, selValue) {
    if (!footHost) return;
    const sel = Array.from(state.selected);
    const selRows = rows.filter((r) => sel.includes(r.key));
    if (!sel.length) {
      mount(footHost, h('div.hint', { style: { marginTop: '12px' }, text: `共 ${rows.length} 组 · 市值 ¥${fmtPrice(selValue)} · 长按或右键可多选` }));
      return;
    }
    const value = selRows.reduce((s, r) => s + r.total, 0);
    const recycle = selRows.reduce((s, r) => s + economy.recycleUnit(r.def, r.inst) * r.qty, 0);
    mount(footHost, h('div.card.card--pad', { style: { marginTop: '12px', position: 'sticky', bottom: '8px' } },
      h('div.row.row--between', null,
        h('div.col', null,
          h('div.fs-12', { text: `已选 ${sel.length} 组` }),
          h('div.hint', { text: `市值 ¥${fmtPrice(value)} · 回收可得 ¥${fmtPrice(recycle)}` })),
        h('div.btn-group', null,
          h('button.btn.btn--sm', { onclick: () => { state.selected.clear(); render(); } }, '清除'),
          h('button.btn.btn--sm', { onclick: () => batchSell(selRows, true) }, '回收'),
          h('button.btn.btn--sm', { onclick: () => batchSell(selRows, false) }, '市价卖'),
          h('button.btn.btn--sm.btn--primary', { onclick: () => batchList(selRows) }, '挂单'),
          h('button.btn.btn--sm.btn--danger', { onclick: () => batchScrap(selRows) }, '熔炼')))));
  }

  /* ------------------------------------------------------------ 操作 */

  function detail(r) {
    const m = modal({
      title: r.def.name,
      render: (body) => {
        body.appendChild(h('div.stack.stack--loose', null,
          h('div.row.row--between', null,
            h('div.col', null,
              rarityChip(r.def.rarity),
              h('div.hint', { text: r.def.desc })),
            h('div.col', { style: { alignItems: 'flex-end' } },
              h('div.item__price', { style: { fontSize: '17px' }, text: '¥' + fmtPrice(r.unitValue) }),
              deltaEl(r.change))),
          r.inst.float != null ? floatBar(r.inst, r.def) : null,
          h('div.kv-grid', null,
            kv('持有', '×' + r.qty + (r.def.unit ? ' ' + r.def.unit : '')),
            kv('持仓成本', '¥' + fmtPrice(r.inst.cost)),
            kv('浮动盈亏', (r.pnl >= 0 ? '+' : '') + '¥' + fmtPrice(r.pnl) + '（' + pct(r.pnlPct) + '）'),
            kv('回收单价', '¥' + fmtPrice(economy.recycleUnit(r.def, r.inst))),
            kv('市价单价', '¥' + fmtPrice(economy.quoteSell(r.def, r.inst).net)),
            kv('市场参考', '¥' + fmtPrice(r.price))),
          h('div.divider'),
          h('div', null,
            h('div.field__label', { text: '数量' }),
            h('div.row', { style: { marginTop: '6px' } },
              numPicker(r, (q) => (r._q = q)))),
          h('div.btn-group', null,
            h('button.btn.btn--sm', {
              onclick: () => {
                const res = economy.sell(r.key, r._q || r.qty, { instant: true });
                if (res.ok) {
                  toast(`回收 <b>×${res.qty}</b> · 收入 <b>¥${fmtPrice(res.total)}</b>`, { kind: 'good' });
                  quest.checkAchievements();
                } else toast('无法回收：' + reasonText(res.reason), { kind: 'bad' });
                m.close();
                render();
              },
            }, '回收'),
            h('button.btn.btn--sm', {
              onclick: () => {
                const res = economy.sell(r.key, r._q || r.qty, { instant: false });
                if (res.ok) {
                  toast(`市价卖出 <b>×${res.qty}</b> · 收入 <b>¥${fmtPrice(res.total)}</b>`, { kind: 'good' });
                } else toast('无法卖出：' + reasonText(res.reason), { kind: 'bad' });
                m.close();
                render();
              },
            }, '市价卖'),
            h('button.btn.btn--sm', {
              onclick: () => {
                m.close();
                listDialog(r);
              },
            }, '挂单卖出'),
            h('button.btn.btn--sm', {
              onclick: () => {
                m.close();
                ctx.go('market', { id: r.def.id });
              },
            }, '查看行情'),
            h('button.btn.btn--sm.btn--danger', {
              onclick: () => {
                const res = economy.scrap([r.key]);
                toast(`熔炼 <b>×${res.n}</b> · 获得材料 <b>${fmtPrice(res.gained)}</b>`, { kind: 'good' });
                m.close();
                render();
              },
            }, '熔炼'))));
      },
    });
  }

  function numPicker(r, onChange) {
    const input = h('input.input.input--mono', {
      type: 'number', min: 1, max: r.qty, value: String(r.qty), style: { width: '90px' },
    });
    input.addEventListener('input', () => {
      const v = Math.max(1, Math.min(r.qty, Number(input.value) || 1));
      onChange(v);
    });
    onChange(r.qty);
    return h('div.row', null, input,
      h('button.btn.btn--sm.btn--ghost', { onclick: () => { input.value = '1'; onChange(1); } }, '1'),
      h('button.btn.btn--sm.btn--ghost', { onclick: () => { input.value = String(r.qty); onChange(r.qty); } }, '全部'));
  }

  function listDialog(r) {
    const suggest = trade.suggestPrice(r.def, r.inst, 'sell');
    promptDialog({
      title: '挂单卖出：' + r.def.name,
      label: '单件挂单价（¥）',
      value: suggest.toFixed(2),
      hint: `市场参考价 ¥${fmtPrice(r.price)} · 当前品相估值 ¥${fmtPrice(r.unitValue)} · 挂单成交需要 NPC 吃单，价格越有吸引力成交越快。挂单有效期 ${Math.round(72)} 游戏小时。`,
      mono: true,
    }).then((v) => {
      if (v == null) return;
      const price = Number(v);
      const res = trade.listSell(r.key, r._q || r.qty, price);
      if (res.ok) {
        toast(`已挂单 <b>¥${fmtPrice(price)}</b> ×${r._q || r.qty}`, { kind: 'good' });
        ctx.go('orders');
      } else toast('挂单失败：' + reasonText(res.reason), { kind: 'bad' });
      render();
    });
  }

  function batchSell(rows, instant) {
    const entries = rows.map((r) => ({ key: r.key, qty: r.qty }));
    const total = rows.reduce((s, r) => s + (instant ? economy.recycleUnit(r.def, r.inst) : economy.quoteSell(r.def, r.inst).net) * r.qty, 0);
    confirmDialog({
      title: instant ? '批量回收' : '批量市价卖出',
      text: `${rows.length} 组物品，预计收入 <b>¥${fmtPrice(total)}</b>。`,
      detail: instant ? '回收商折价较高，但瞬间成交、没有流拍风险。' : '按市价卖给 NPC 买盘，价格优于回收商，但成交可能分批完成。',
      okText: '确认',
    }).then((ok) => {
      if (!ok) return;
      const res = economy.sellBatch(entries, { instant });
      toast(`已卖出 <b>×${res.n}</b> · 收入 <b>¥${fmtPrice(res.total)}</b>`, { kind: 'good' });
      state.selected.clear();
      quest.checkAchievements();
      render();
    });
  }

  function batchList(rows) {
    if (rows.length > 6) {
      toast('一次最多挂 6 组，请先缩小选择', { kind: 'bad' });
      return;
    }
    let done = 0;
    let fail = 0;
    for (const r of rows) {
      const p = trade.suggestPrice(r.def, r.inst, 'sell');
      const res = trade.listSell(r.key, r.qty, p);
      if (res.ok) done++;
      else fail++;
    }
    toast(`挂单成功 ${done} 组${fail ? `，失败 ${fail} 组` : ''}`, { kind: fail ? 'bad' : 'good' });
    state.selected.clear();
    if (done) ctx.go('orders');
    else render();
  }

  function batchScrap(rows) {
    const keys = rows.map((r) => r.key);
    const value = rows.reduce((s, r) => s + economy.scrapValue(r.def, r.inst, r.qty), 0);
    confirmDialog({
      title: '熔炼物品',
      text: `把 ${rows.length} 组物品熔炼为材料，预计获得 <b>${fmtPrice(value)}</b> 材料。`,
      detail: '熔炼不可逆。材料可用于抵扣抽奖与扩容成本。',
    }).then((ok) => {
      if (!ok) return;
      const res = economy.scrap(keys);
      toast(`熔炼 <b>×${res.n}</b> · 材料 +<b>${fmtPrice(res.gained)}</b>`, { kind: 'good' });
      state.selected.clear();
      render();
    });
  }

  function recycleDialog() {
    const keys = economy.autoScrapKeys(Number.MAX_SAFE_INTEGER, 'white');
    const rows = inv.bagEntries({}).filter((r) => keys.includes(r.key));
    if (!rows.length) {
      toast('没有可回收的低价物品', { kind: 'info' });
      return;
    }
    const value = rows.reduce((s, r) => s + economy.recycleUnit(r.def, r.inst) * r.qty, 0);
    confirmDialog({
      title: '一键回收白色物品',
      text: `将回收 <b>${rows.length}</b> 组白色品质物品，收入约 <b>¥${fmtPrice(value)}</b>。`,
      detail: '只处理白色（普通）品质，蓝色及以上不会被触碰。',
    }).then((ok) => {
      if (!ok) return;
      const res = economy.sellBatch(rows.map((r) => ({ key: r.key, qty: r.qty })), { instant: true });
      toast(`已回收 <b>×${res.n}</b> · 收入 <b>¥${fmtPrice(res.total)}</b>`, { kind: 'good' });
      render();
    });
  }

  function scrapDialog() {
    const keys = economy.autoScrapKeys(80, 'blue');
    const rows = inv.bagEntries({}).filter((r) => keys.includes(r.key));
    if (!rows.length) {
      toast('没有适合熔炼的低价值物品', { kind: 'info' });
      return;
    }
    const value = rows.reduce((s, r) => s + economy.scrapValue(r.def, r.inst, r.qty), 0);
    confirmDialog({
      title: '批量熔炼',
      text: `熔炼 <b>${rows.length}</b> 组单价低于 ¥80 的白/绿品质物品。`,
      detail: `预计获得材料 <b>${fmtPrice(value)}</b>。当前持有材料 ${fmtPrice(S.player.scrap)}。`,
    }).then((ok) => {
      if (!ok) return;
      const res = economy.scrap(keys);
      toast(`熔炼 <b>×${res.n}</b> · 材料 +<b>${fmtPrice(res.gained)}</b>`, { kind: 'good' });
      render();
    });
  }

  function reasonText(r) {
    return {
      missing: '物品不存在',
      qty: '数量不足',
      'daily-cap': '今日交易已达上限',
      price: '价格无效',
      'no-cash': '现金不足',
      'bag-full': '背包已满',
      limit: '挂单数量已达上限',
      'too-high': '挂单价过高',
      fee: '手续费支付失败',
    }[r] || r;
  }

  function kv(k, v) {
    return h('div.kv', null, h('span.kv__k', { text: k }), h('span.kv__v', { text: v }));
  }

  render();
  return {
    el,
    onEnter: () => render(),
    onTick: () => {
      if (!el.classList.contains('is-active')) return;
      const rows = filtered();
      if (!rows.length) return;
      const nodes = el.querySelectorAll('.item');
      // 只更新价格文本，避免重建整个列表
      let i = 0;
      rows.forEach((r) => {
        const node = nodes[i++];
        if (!node) return;
        const priceEl = node.querySelector('.item__price');
        if (priceEl) priceEl.textContent = '¥' + fmtPrice(r.unitValue);
        const metaEl = node.querySelector('.item__meta');
        if (metaEl) {
          metaEl.textContent = state.mode === 'grid'
            ? (r.change >= 0 ? '↑' : '↓') + Math.abs(r.change * 100).toFixed(1) + '%'
            : '×' + r.qty + ' · ¥' + fmtPrice(r.total);
        }
      });
    },
    onDestroy: () => {},
  };
}
