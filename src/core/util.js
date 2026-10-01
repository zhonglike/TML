/**
 * MONO — 通用工具：格式化、DOM、事件总线、动画、手势
 * 无依赖；所有 DOM 辅助都返回真实节点，便于做增量更新。
 */

/* ------------------------------------------------------------- 数值格式化 */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const round2 = (v) => Math.round(v * 100) / 100;

/** 千分位 */
export function thousands(n, digits = 0) {
  if (!isFinite(n)) return '—';
  const s = Number(n).toFixed(digits);
  const [i, d] = s.split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? '.' + d : '');
}

/**
 * 货币：<1万 直接千分位；≥1万 用「万 / 亿」并保留 2 位；极大值降精度
 * 例：999.5 → 999.5 ；12345 → 1.23万 ；1.2e8 → 1.20亿
 */
export function money(n, opt = {}) {
  const { withSign = false, suffix = true } = opt;
  if (n == null || !isFinite(n)) return '—';
  const neg = n < 0;
  const abs = Math.abs(n);
  let out;
  if (abs < 10000) {
    out = abs >= 100 ? thousands(Math.round(abs)) : abs >= 10 ? thousands(abs, 1) : thousands(abs, 2);
  } else if (abs < 1e8 && suffix) {
    out = thousands(abs / 1e4, 2) + '万';
  } else if (suffix) {
    out = thousands(abs / 1e8, 2) + '亿';
  } else {
    out = thousands(Math.round(abs));
  }
  return (neg ? '-' : withSign ? '+' : '') + out;
}

export function price(n) {
  if (!isFinite(n)) return '—';
  if (n >= 10000) return money(n);
  if (n >= 100) return thousands(n, 1);
  return thousands(n, 2);
}

export function pct(n, digits = 2) {
  if (!isFinite(n)) return '—';
  const v = n * 100;
  return (v >= 0 ? '+' : '') + v.toFixed(digits) + '%';
}

/** 无符号百分比 */
export function pctAbs(n, digits = 1) {
  if (!isFinite(n)) return '—';
  return (n * 100).toFixed(digits) + '%';
}

export function signed(n, digits = 2) {
  if (!isFinite(n)) return '—';
  return (n >= 0 ? '+' : '') + Number(n).toFixed(digits);
}

export function floatStr(f) {
  if (f == null) return '—';
  return Number(f).toFixed(4);
}

/** 数量紧凑显示 */
export function qty(n) {
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return thousands(n);
}

/* ------------------------------------------------------------------ 时间 */

/** 游戏小时 -> {y,m,d,h} 以 1 年 = 360 天简化日历 */
export function gameDate(hours) {
  const h = Math.max(0, Math.floor(hours));
  const day = Math.floor(h / 24);
  const hour = h % 24;
  const year = 2026 + Math.floor(day / 360);
  const dOfY = day % 360;
  const month = Math.floor(dOfY / 30) + 1;
  const date = (dOfY % 30) + 1;
  return { year, month, date, hour, day };
}

export function dateStr(hours) {
  const d = gameDate(hours);
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.date).padStart(2, '0')}`;
}

export function dateTimeStr(hours) {
  const d = gameDate(hours);
  return `${dateStr(hours)} ${String(d.hour).padStart(2, '0')}:00`;
}

/** 游戏小时 -> 「1天3小时」 */
export function durStr(hours) {
  const h = Math.max(0, Math.round(hours));
  if (h < 24) return h + ' 小时';
  const d = Math.floor(h / 24);
  const r = h % 24;
  return r ? `${d} 天 ${r} 小时` : `${d} 天`;
}

/* --------------------------------------------------------------- 杂项 */

export function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function idbkey(...parts) {
  return parts.filter((p) => p != null).join(':');
}

export function deepClone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

export function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr) {
    const k = fn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export function sum(arr, fn = (x) => x) {
  let t = 0;
  for (const x of arr) t += fn(x) || 0;
  return t;
}

export function debounce(fn, ms) {
  let t = 0;
  return function (...a) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, a), ms);
  };
}

export function throttle(fn, ms) {
  let last = 0;
  let timer = 0;
  return function (...a) {
    const now = Date.now();
    const run = () => {
      last = now;
      fn.apply(this, a);
    };
    if (now - last >= ms) run();
    else {
      clearTimeout(timer);
      timer = setTimeout(run, ms - (now - last));
    }
  };
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 把数字格式化成紧凑的坐标轴标签 */
export function axisLabel(v) {
  if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(1) + '亿';
  if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(v >= 1e6 ? 0 : 1) + '万';
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'k';
  if (Math.abs(v) >= 10) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

/* --------------------------------------------------------------- DOM */

/**
 * 轻量 hyperscript：h('div.card.card--pad#main', props, children)
 * 支持 `tag`、`.class`、`#id` 任意顺序与多次出现。
 */
export function h(tag, props, ...children) {
  const spec = String(tag || 'div');
  const tagM = spec.match(/^[a-zA-Z][\w-]*/);
  const el = document.createElement(tagM ? tagM[0] : 'div');
  for (const m of spec.matchAll(/\.([\w-]+)/g)) el.classList.add(m[1]);
  const idM = spec.match(/#([\w-]+)/);
  if (idM) el.id = idM[1];
  if (props && (typeof props !== 'object' || Array.isArray(props) || isNode(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') el.className = (el.className ? el.className + ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' && 'value' in el) el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  add(el, children);
  return el;
}

/**
 * 是否为真实 DOM 节点。
 * 不用 `instanceof Node`：在 Node.js 里全局 `Node` 是另一个东西（会被遮蔽），
 * 而 DocumentFragment 也不是 Element。鸭子类型最稳。
 */
export function isNode(v) {
  return !!v && typeof v === 'object' && typeof v.nodeType === 'number';
}

function add(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) add(el, c);
    else if (isNode(c)) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function clear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  add(el, children);
  return el;
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  add(f, children);
  return f;
}

/** 事件委托 */
export function on(root, event, sel, fn) {
  const handler = (e) => {
    const t = e.target.closest(sel);
    if (t && root.contains(t)) fn(e, t);
  };
  root.addEventListener(event, handler);
  return () => root.removeEventListener(event, handler);
}

/** SVG 线条图标（无 emoji，全部为 1.5px 描边） */
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V21H3z',
  bag: 'M6 8h12l1 12H5L6 8Zm3 0V6a3 3 0 0 1 6 0v2',
  draw: 'M12 3.5 14 10l6.5 2-6.5 2-2 6.5-2-6.5L3.5 12 10 10l2-6.5Z',
  market: 'M3 20h18M6 16V9m5 7V5m5 11v-5m4 5v-8',
  auction: 'M5 4h14l-1.5 9H6.5L5 4Zm2 12h10l1 4H6l1-4Z',
  records: 'M4 5h16M4 10h16M4 15h10M4 20h7',
  quests: 'M5 4h14v16H5zM8 9h8M8 13h8M8 17h5',
  settings: 'M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7ZM4 12h2m12 0h2M12 4v2m0 12v2M6.3 6.3l1.4 1.4m8.6 8.6 1.4 1.4m0-11.4-1.4 1.4M7.7 16.3l-1.4 1.4',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm4.8-.2L20 21',
  filter: 'M4 6h16M7 12h10M10 18h4',
  sort: 'M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3',
  chart: 'M4 19V5m0 14h16M8 15l3.5-4 3 2.5L19 7',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M5 13l4.5 4.5L19 7',
  close: 'M6 6l12 12M18 6 6 18',
  arrowUp: 'M12 19V5m0 0-6 6m6-6 6 6',
  arrowDown: 'M12 5v14m0 0 6-6m-6 6-6-6',
  arrowRight: 'M5 12h14m0 0-6-6m6 6-6 6',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4',
  save: 'M5 3h11l3 3v15H5zM8 3v6h7V3M8 14h8v7H8z',
  upload: 'M12 17V5m0 0-5 5m5-5 5 5M4 19h16',
  download: 'M12 5v12m0 0 5-5m-5 5-5-5M4 19h16',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3.5 2',
  crosshair: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 2v3m0 14v3M2 12h3m14 0h3',
  chip: 'M7 7h10v10H7zM10 3v3m4-3v3m-4 12v3m4-3v3M3 10h3m-3 4h3m12-4h3m-3 4h3',
  cpu: 'M8 8h8v8H8zM4 4h16v16H4zM9 2v2m6-2v2M9 20v2m6-2v2M2 9h2m-2 6h2m16-6h2m-2 6h2',
  vault: 'M3 4h18v16H3zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-2.5V12',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6l1-8Z',
  trash: 'M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13',
  winner: 'M12 15V3m0 12a5 5 0 0 0 5-5V3H7v7a5 5 0 0 0 5 5Zm-5-2-3 8h16l-3-8',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13h.01M11 12h1v5h1',
  bell: 'M6 17h12l-1.5-2V10a4.5 4.5 0 0 0-9 0v5L6 17Zm4 0a2 2 0 0 0 4 0',
  eye: 'M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Zm9.5 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M4 6h16M4 12h16M4 18h16',
  play: 'M7 4l13 8-13 8V4Z',
  pause: 'M8 5v14M16 5v14',
  star: 'M12 3l2.6 6.3 6.4.5-4.9 4.2 1.5 6.3L12 16.9 6.4 20.3l1.5-6.3L3 9.8l6.4-.5L12 3Z',
};

export function icon(name, size = 18, stroke = 1.5) {
  const d = ICONS[name] || ICONS.info;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', stroke);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  svg.appendChild(p);
  return svg;
}

/* --------------------------------------------------------------- 总线 */

export function createBus() {
  const map = new Map();
  return {
    on(ev, fn) {
      if (!map.has(ev)) map.set(ev, new Set());
      map.get(ev).add(fn);
      return () => map.get(ev).delete(fn);
    },
    off(ev, fn) {
      const s = map.get(ev);
      if (s) s.delete(fn);
    },
    emit(ev, payload) {
      const s = map.get(ev);
      if (s) for (const fn of Array.from(s)) {
        try {
          fn(payload);
        } catch (err) {
          console.error('[mono] listener error', ev, err);
        }
      }
      const all = map.get('*');
      if (all) for (const fn of Array.from(all)) { try { fn({ ev, payload }); } catch (e) { /* noop */ } }
    },
    clear() {
      map.clear();
    },
    count() {
      return map.size;
    },
  };
}

/** 全局事件总线（单例）。所有模块共用同一条总线，UI 与引擎都订阅它。 */
export const bus = createBus();

/* --------------------------------------------------------------- 动画 */

const reduceMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 数字滚动：与最近一次动画值做插值，避免抖动 */
const rollState = new WeakMap();
export function rollNumber(el, to, opt = {}) {
  if (!el) return;
  const { dur = 480, fmt = price } = opt;
  const st = rollState.get(el) || { cur: to, raf: 0 };
  const from = isFinite(st.cur) ? st.cur : to;
  cancelAnimationFrame(st.raf);
  if (reduceMotion() || Math.abs(to - from) < 1e-9) {
    el.textContent = fmt(to);
    rollState.set(el, { cur: to, raf: 0 });
    return;
  }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    const v = from + (to - from) * e;
    el.textContent = fmt(v);
    st.cur = v;
    if (k < 1) st.raf = requestAnimationFrame(step);
    else {
      el.textContent = fmt(to);
      st.cur = to;
    }
  };
  st.raf = requestAnimationFrame(step);
  rollState.set(el, st);
}

/** 数值闪动：涨 -> 提亮，跌 -> 压暗（保持黑白灰） */
export function flash(el, dir) {
  if (!el) return;
  el.classList.remove('is-up', 'is-dn');
  el.classList.add(dir >= 0 ? 'is-up' : 'is-dn');
  el.classList.remove('up', 'dn');
  el.classList.add(dir >= 0 ? 'up' : 'dn');
  setTimeout(() => el.classList.remove('is-up', 'is-dn'), 620);
}

/** 一次性「+¥123」上浮 */
export function floatUp(anchor, text, dir = 1) {
  if (!anchor || !anchor.parentElement) return;
  const el = h(
    'span.floatup' + (dir >= 0 ? '.is-up' : '.is-dn'),
    { text },
  );
  anchor.parentElement.style.position = anchor.parentElement.style.position || 'relative';
  anchor.parentElement.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

/** 惯性滚动（桌面滚轮 -> 平滑） */
export function smoothScroll(el) {
  if (!el) return () => {};
  let target = el.scrollTop;
  let raf = 0;
  const onWheel = (e) => {
    if (Math.abs(e.deltaY) < 2) return;
    e.preventDefault();
    target = clamp(target + e.deltaY, 0, el.scrollHeight - el.clientHeight);
    if (!raf) raf = requestAnimationFrame(loop);
  };
  const loop = () => {
    const d = target - el.scrollTop;
    el.scrollTop += d * 0.22;
    raf = Math.abs(d) > 0.6 ? requestAnimationFrame(loop) : 0;
  };
  el.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    el.removeEventListener('wheel', onWheel);
    cancelAnimationFrame(raf);
  };
}

/** 长按 */
export function longPress(el, fn, ms = 480) {
  let t = 0;
  let moved = false;
  const down = () => {
    moved = false;
    t = setTimeout(() => !moved && fn(), ms);
  };
  const cancel = () => clearTimeout(t);
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', () => {
    moved = true;
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
}

/** 双击 */
export function dblTap(el, fn, ms = 300) {
  let last = 0;
  el.addEventListener('click', () => {
    const now = Date.now();
    if (now - last < ms) fn();
    last = now;
  });
}

/** 移动端下拉刷新：返回 setBusy 控制器 */
export function pullToRefresh(scroller, onRefresh) {
  let startY = null;
  let pulling = false;
  const ind = h('div.pullind', { html: '<span></span>' });
  const host = scroller.parentElement;
  if (host) host.appendChild(ind);
  const start = (e) => {
    if (scroller.scrollTop > 2) return;
    startY = e.touches ? e.touches[0].clientY : e.clientY;
  };
  const move = (e) => {
    if (startY == null) return;
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - startY;
    if (y > 8 && scroller.scrollTop <= 2) {
      pulling = true;
      ind.style.transform = `translateY(${Math.min(64, y * 0.5)}px)`;
      ind.classList.add('is-on');
    }
  };
  const end = () => {
    if (pulling) {
      ind.classList.add('is-busy');
      Promise.resolve(onRefresh()).finally(() => {
        setTimeout(() => {
          ind.classList.remove('is-on', 'is-busy');
          ind.style.transform = '';
        }, 420);
      });
    }
    startY = null;
    pulling = false;
  };
  scroller.addEventListener('touchstart', start, { passive: true });
  scroller.addEventListener('touchmove', move, { passive: true });
  scroller.addEventListener('touchend', end);
  scroller.addEventListener('mousedown', start);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  return () => {
    scroller.removeEventListener('touchstart', start);
    scroller.removeEventListener('touchmove', move);
    scroller.removeEventListener('touchend', end);
    scroller.removeEventListener('mousedown', start);
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', end);
    ind.remove();
  };
}

/** 触觉反馈（WebView / 移动端可用时） */
export function haptic(style = 'light') {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  if (nav && typeof nav.vibrate === 'function') {
    try {
      nav.vibrate(style === 'heavy' ? 24 : style === 'medium' ? 12 : 6);
    } catch (e) { /* noop */ }
  }
}
