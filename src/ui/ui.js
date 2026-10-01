/**
 * MONO — UI 基础件
 * 所有 view 共用的渲染片段与交互件：物品行/卡片、稀有度、数字、弹窗、抽屉、提示。
 */
import { h, mount, icon, money, price as fmtPrice, pct, thousands, rollNumber, clamp } from '../core/util.js';
import { RARITY, WEAR_BY_ID } from '../core/const.js';
import { getItem, conditionLabel } from '../core/catalog.js';
import { S } from '../core/state.js';
import { sfx } from './sound.js';

export { h, mount, icon, money, fmtPrice, pct, thousands, clamp };

/* ------------------------------------------------------------------ 稀有度 */

export function rarityClass(r) {
  return 'rarity rarity--' + (r || 'white');
}

export function rarityVar(r) {
  return { '--rc': (RARITY[r] || RARITY.white).color };
}

export function rarityChip(r, extra) {
  const info = RARITY[r] || RARITY.white;
  return h('span', { class: rarityClass(r), style: rarityVar(r), title: info.cn }, extra || info.cs);
}

/** 涨跌：黑白灰 + 箭头，符合整体调性 */
export function deltaEl(change, opt = {}) {
  const v = isFinite(change) ? change : 0;
  const cls = 'num ' + (v >= 0 ? 'up' : 'dn');
  return h('span', { class: cls, text: (v >= 0 ? '↑ ' : '↓ ') + Math.abs(v * 100).toFixed(opt.digits == null ? 2 : opt.digits) + '%' });
}

/** 磨损度条 */
export function floatBar(inst, def) {
  if (!inst || inst.float == null) return null;
  const w = WEAR_BY_ID[inst.wear] || null;
  const pctPos = clamp(inst.float * 100, 0, 100);
  const clr = { FN: '#B0B0B0', MW: '#4A9E4A', FT: '#5B8FD6', WW: '#8B5FBF', BS: '#C0392B' }[inst.wear] || '#666';
  return h('div.stack--tight', { class: 'stack stack--tight' },
    h('div.floatbar', { style: { '--rc': clr }, title: `Float ${inst.float.toFixed(4)}` },
      h('i.floatbar__fill', { style: { width: pctPos + '%' } })),
    h('div.row.row--between',
      h('span.wear', { text: (w ? w.cn : '') + ' ' + (inst.wear || '') }),
      h('span.wear', { text: inst.float.toFixed(4) })));
}

/* ------------------------------------------------------------------ 物品 */

/**
 * 物品展示单元
 * @param {object} o { def, inst, price, change, qty, extra, onClick, mode }
 */
export function itemUnit(o) {
  const { def, inst, mode = 'list' } = o;
  if (!def) return h('div');
  const market = S.market[def.id];
  const p = o.price != null ? o.price : (market ? market.p : def.base);
  const change = o.change != null ? o.change : (market ? market.mom : 0);
  const tags = [];
  if (inst) {
    if (inst.st) tags.push('暗金');
    if (inst.pattern) tags.push(inst.pattern);
    if (inst.wear) tags.push(inst.wear);
    if (inst.qty != null && o.showQty !== false && mode === 'grid') tags.push('×' + inst.qty);
  }
  const el = h('div.item' + (mode === 'grid' ? '.item--grid' : ''),
    {
      style: { '--rc': (RARITY[def.rarity] || RARITY.white).color },
      dataset: { item: def.id, key: o.key || '' },
      title: def.name + (def.desc ? '\n' + def.desc : ''),
      onclick: (e) => {
        sfx('tap');
        if (o.onClick) o.onClick(e, o);
      },
    },
    h('i.item__bit'),
    h('div.col', { style: { flex: '1', minWidth: 0 } },
      h('div.item__name', { text: def.name }),
      h('div.item__sub', {
        text: [def.subType, ...tags].filter(Boolean).join(' · ') || def.category,
      })),
    h('div.col', { style: { alignItems: mode === 'grid' ? 'flex-start' : 'flex-end' } },
      h('div.item__price', { text: '¥' + fmtPrice(p) }),
      o.qty != null && o.showQty !== false && mode !== 'grid'
        ? h('div.item__meta', { text: (o.qtyLabel || '×' + o.qty) + ' · ¥' + fmtPrice(p * o.qty) })
        : h('div.item__meta', { text: (change >= 0 ? '↑' : '↓') + Math.abs(change * 100).toFixed(1) + '%' })));
  return el;
}

/** 小尺寸的图鉴条目（市场列表用） */
export function marketRow(def, opt = {}) {
  const m = S.market[def.id];
  const p = m ? m.p : def.base;
  const change = m ? m.mom : 0;
  const row = h('div.item', {
    style: { '--rc': (RARITY[def.rarity] || RARITY.white).color },
    dataset: { item: def.id },
    onclick: () => opt.onClick && opt.onClick(def),
  },
    h('i.item__bit'),
    h('div.col', { style: { flex: '1', minWidth: 0 } },
      h('div.item__name', { text: def.name }),
      h('div.item__sub', { text: def.subType + ' · ' + (def.unit || '件') })),
    h('div.col', { style: { alignItems: 'flex-end' } },
      h('div.item__price', { text: '¥' + fmtPrice(p) }),
      deltaEl(change)));
  return row;
}

/* ------------------------------------------------------------------ 数字 */

/** 带滚动动画的数字节点 */
export function numEl(value, opt = {}) {
  const el = h('span', {
    class: 'num' + (opt.class ? ' ' + opt.class : ''),
    style: opt.style || null,
  });
  el.textContent = (opt.prefix || '') + fmtPrice(value);
  el._roll = { cur: value, fmt: (v) => (opt.prefix || '') + fmtPrice(v) };
  if (opt.animate !== false && S.settings.numbersRoll !== false) rollNumber(el, value, { fmt: el._roll.fmt });
  return el;
}

export function stat(label, value, opt = {}) {
  const valueEl = opt.mono === false
    ? h('div.stat__value', { text: value })
    : numEl(value, { prefix: opt.prefix || '', class: opt.big ? '' : 'stat__value--sm' });
  if (opt.mono === false) valueEl.className = 'stat__value';
  return h('div.stat' + (opt.big ? '' : ''),
    h('div.stat__label', { text: label }),
    valueEl,
    opt.delta != null ? h('div.stat__delta', { class: opt.delta >= 0 ? 'up' : 'dn', text: (opt.delta >= 0 ? '↑ ' : '↓ ') + Math.abs(opt.delta * 100).toFixed(2) + '%' }) : null,
    opt.sub ? h('div.stat__delta', { text: opt.sub }) : null);
}

/** kpi 卡片（仪表盘用） */
export function kpi(label, value, opt = {}) {
  const card = h('div.kpi' + (opt.class ? '.' + opt.class : ''), opt.onClick ? { onclick: opt.onClick } : null);
  const valueEl = h('div.stat__value' + (opt.big ? '' : '.stat__value--sm'));
  if (typeof value === 'number') {
    valueEl.textContent = (opt.prefix || '') + fmtPrice(value);
    valueEl._roll = { fmt: (v) => (opt.prefix || '') + fmtPrice(v) };
    valueEl._value = value;
  } else {
    valueEl.textContent = value;
  }
  card.appendChild(h('div.stat__label', { text: label }));
  card.appendChild(valueEl);
  if (opt.foot) card.appendChild(h('div.stat__delta', { text: opt.foot }));
  if (opt.bar != null) {
    card.appendChild(h('div.progress', { style: { marginTop: '8px' } },
      h('i.progress__bar', { style: { width: clamp(opt.bar, 0, 1) * 100 + '%' } })));
  }
  return card;
}

/** 更新 kpi 或 stat 内的数字（增量刷新） */
export function patchNum(el, value) {
  if (!el) return;
  const target = el._roll ? el._roll : el.querySelector ? el.querySelector('.stat__value') : null;
  const node = el._roll ? el : target;
  if (!node || typeof value !== 'number') return;
  if (S.settings.numbersRoll === false) {
    node.textContent = (node._roll ? node._roll.fmt(value) : fmtPrice(value));
    return;
  }
  rollNumber(node, value, { fmt: node._roll ? node._roll.fmt : (v) => fmtPrice(v) });
}

/* ------------------------------------------------------------------ 反馈 */

const toastHost = () => document.getElementById('toasts');

export function toast(text, opt = {}) {
  const host = toastHost();
  if (!host) return;
  const el = h('div.toast' + (opt.kind ? '.toast--' + opt.kind : ''),
    opt.iconName ? icon(opt.iconName, 15) : null,
    h('div', { style: { flex: '1', minWidth: 0 }, html: text }));
  host.appendChild(el);
  const life = opt.ms || (opt.kind === 'bad' ? 2600 : 2000);
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 240);
  }, life);
  if (opt.sound !== false) sfx(opt.kind === 'bad' ? 'error' : opt.kind === 'good' ? 'ding' : 'tap');
}

export function layer() {
  return document.getElementById('layer');
}

/** 通用弹窗（桌面居中 / 移动底部抽屉） */
export function modal(opt = {}) {
  const host = layer();
  const isMobile = window.innerWidth < 700;
  const body = h('div.modal__body');
  const panel = h(isMobile ? 'div.sheet' : 'div.modal__panel',
    isMobile ? null : h('div.modal__head',
      h('b', { style: { flex: '1' }, text: opt.title || '' }),
      h('button.iconbtn', { type: 'button', onclick: () => close(), 'aria-label': '关闭' }, icon('close', 16))),
    isMobile ? h('div.row.row--between', { style: { marginBottom: '12px' } },
      h('b', { text: opt.title || '' }),
      h('button.iconbtn', { type: 'button', onclick: () => close(), 'aria-label': '关闭' }, icon('close', 16))) : null,
    body,
    opt.foot ? h('div.modal__foot', null, ...opt.foot) : null);

  const wrap = h(isMobile ? 'div.modal' : 'div.modal', {
    onclick: (e) => {
      if (e.target === wrap) close();
    },
  }, panel);

  function close() {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    if (opt.onClose) opt.onClose();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  host.appendChild(wrap);
  document.addEventListener('keydown', onKey);
  if (opt.render) opt.render(body, close);
  sfx('open');
  return { body, close, panel };
}

export function confirmDialog(opt = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title: opt.title || '确认',
      foot: [
        h('button.btn.btn--ghost', { type: 'button', onclick: () => { done = true; m.close(); resolve(false); } }, opt.cancelText || '取消'),
        h('button.btn' + (opt.primary ? '.btn--primary' : ''), { type: 'button', onclick: () => { done = true; m.close(); resolve(true); } }, opt.okText || '确定'),
      ],
      render: (body) => {
        body.appendChild(h('div.stack', null,
          h('div', { html: opt.text || '' }),
          opt.detail ? h('div.hint', { html: opt.detail }) : null));
      },
      onClose: () => {
        if (!done) resolve(false);
      },
    });
  });
}

/** 输入弹窗 */
export function promptDialog(opt = {}) {
  return new Promise((resolve) => {
    let input;
    let done = false;
    const m = modal({
      title: opt.title || '输入',
      foot: [
        h('button.btn.btn--ghost', { type: 'button', onclick: () => { done = true; m.close(); resolve(null); } }, '取消'),
        h('button.btn.btn--primary', {
          type: 'button',
          onclick: () => {
            done = true;
            const v = input.value;
            m.close();
            resolve(v);
          },
        }, opt.okText || '确定'),
      ],
      render: (body) => {
        input = h('input.input' + (opt.mono !== false ? '.input--mono' : ''), {
          type: opt.type || 'text',
          value: opt.value != null ? String(opt.value) : '',
          placeholder: opt.placeholder || '',
        });
        body.appendChild(h('div.stack', null,
          opt.label ? h('label.field__label', { text: opt.label }) : null,
          input,
          opt.hint ? h('div.hint', { text: opt.hint }) : null));
        setTimeout(() => input.focus(), 60);
      },
      onClose: () => {
        if (!done) resolve(null);
      },
    });
    // 回车提交
    setTimeout(() => {
      if (!input) return;
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          done = true;
          const v = input.value;
          m.close();
          resolve(v);
        }
      });
    }, 70);
  });
}

/* ------------------------------------------------------------------ 布局件 */

export function segmented(items, activeId, onChange) {
  const wrap = h('div.segmented');
  for (const it of items) {
    wrap.appendChild(h('button.segmented__item' + (it.id === activeId ? '.is-active' : ''), {
      type: 'button',
      text: it.label,
      title: it.title || '',
      onclick: () => {
        sfx('tap');
        onChange(it.id);
      },
    }));
  }
  return wrap;
}

export function chips(items, activeId, onChange) {
  const wrap = h('div.chips');
  for (const it of items) {
    wrap.appendChild(h('button.chip' + (it.id === activeId ? '.is-active' : ''), {
      type: 'button',
      onclick: () => {
        sfx('tap');
        onChange(it.id);
      },
    },
      h('span', { text: it.label }),
      it.count != null ? h('i', { text: String(it.count) }) : null));
  }
  return wrap;
}

export function searchBar(value, onChange, placeholder = '搜索物品 / 类型 / 编号') {
  const input = h('input', {
    type: 'search',
    value: value || '',
    placeholder,
    'aria-label': placeholder,
  });
  let t = 0;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => onChange(input.value), 120);
  });
  return h('div.searchbar', null, icon('search', 15), input);
}

export function emptyState(text, sub, iconName = 'info') {
  return h('div.empty', null,
    icon(iconName, 26, 1.2),
    h('b', { text }),
    sub ? h('span', { text: sub }) : null);
}

export function sectionTitle(text, ...actions) {
  const el = h('div.sect__title', null, h('span', { text }));
  if (actions.filter(Boolean).length) {
    el.appendChild(h('span.sect__actions', null, ...actions.filter(Boolean)));
  }
  return el;
}

/** 物品详情内容（弹窗 / 详情页共用） */
export function itemDetail(def, inst, opt = {}) {
  const m = S.market[def.id];
  const p = m ? m.p : def.base;
  const wrap = h('div.stack.stack--loose');
  wrap.appendChild(h('div.row.row--between', { style: { alignItems: 'flex-start' } },
    h('div.col', { style: { minWidth: 0 } },
      h('div', { style: { fontSize: '15px' }, text: def.name }),
      h('div.item__sub', { text: def.subType + ' · ' + (def.pattern || '') })),
    h('div.col', { style: { alignItems: 'flex-end' } },
      h('div.item__price', { style: { fontSize: '17px' }, text: '¥' + fmtPrice(p) }),
      deltaEl(m ? m.mom : 0))));
  wrap.appendChild(h('div', null, rarityChip(def.rarity)));
  if (def.desc) wrap.appendChild(h('div.hint', { text: def.desc }));
  const kv = h('div.kv-grid');
  const rows = [
    ['稀有度', (RARITY[def.rarity] || {}).cn],
    ['基准价', '¥' + fmtPrice(def.base)],
    ['价格区间', '¥' + fmtPrice(def.min) + ' – ¥' + fmtPrice(def.max)],
    ['周波动', (def.volWeek * 100).toFixed(1) + '%'],
    ['流动性', (def.liq * 100).toFixed(0) + '%'],
  ];
  if (inst) {
    if (inst.wear) rows.push(['磨损', (WEAR_BY_ID[inst.wear] || {}).cn + ' ' + inst.wear]);
    if (inst.float != null) rows.push(['Float', inst.float.toFixed(4)]);
    if (inst.st) rows.push(['版本', '暗金 StatTrak']);
    if (inst.pattern) rows.push(['模板', inst.pattern]);
    if (inst.patternScore != null) rows.push(['模板评分', (inst.patternScore * 100).toFixed(0) + ' / 100']);
    if (inst.cost) rows.push(['持仓成本', '¥' + fmtPrice(inst.cost)]);
    if (inst.qty) rows.push(['持有数量', '×' + inst.qty]);
  }
  rows.forEach(([k, v]) => kv.appendChild(h('div.kv', null, h('span.kv__k', { text: k }), h('span.kv__v', { text: String(v) }))));
  wrap.appendChild(kv);
  if (inst && inst.float != null) wrap.appendChild(floatBar(inst, def));
  return wrap;
}

/** 相对时间 */
export function sinceText(hours) {
  const d = Math.max(0, S.clock.hours - hours);
  if (d < 1) return '刚刚';
  if (d < 24) return Math.floor(d) + ' 小时前';
  return Math.floor(d / 24) + ' 天前';
}

export { getItem, conditionLabel };
