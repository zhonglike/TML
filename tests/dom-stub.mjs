/**
 * MONO — 最小 DOM 桩
 * 目的：在没有浏览器的环境里把真实的 UI 模块加载起来并渲染一遍，
 * 从而抓住「import 路径写错 / 导出缺失 / 渲染时抛错」这类只有运行时才暴露的问题。
 * 只实现游戏真正用到的那部分 DOM API，不做通用兼容。
 */

class ClassList {
  constructor(el) {
    this.el = el;
    this.set = new Set();
  }
  add(...names) {
    names.forEach((n) => String(n).split(/\s+/).filter(Boolean).forEach((x) => this.set.add(x)));
    this.sync();
  }
  remove(...names) {
    names.forEach((n) => String(n).split(/\s+/).filter(Boolean).forEach((x) => this.set.delete(x)));
    this.sync();
  }
  toggle(name, force) {
    const has = this.set.has(name);
    const next = force == null ? !has : !!force;
    if (next) this.set.add(name);
    else this.set.delete(name);
    this.sync();
    return next;
  }
  contains(name) {
    return this.set.has(name);
  }
  sync() {
    this.el._class = Array.from(this.set).join(' ');
  }
}

class Style {
  constructor() {
    this._props = new Map();
  }
  setProperty(k, v) {
    this._props.set(k, v);
  }
  removeProperty(k) {
    this._props.delete(k);
  }
  get cssText() {
    return Array.from(this._props.entries()).map(([k, v]) => `${k}:${v}`).join(';');
  }
}

class Element {
  constructor(tag, ns = null) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.ns = ns;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.dataset = {};
    this.style = new Style();
    this._class = '';
    this._listeners = new Map();
    this._text = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.scrollTop = 0;
    this.scrollHeight = 1000;
    /** 布局相关：默认 0，因为未挂载/未布局的元素在浏览器里就是 0。
     *  早先默认 900 会让被测代码拿到假宽度，掩盖真实布局 bug（例如轮盘落位算错）。 */
    this.clientHeight = 0;
    this.clientWidth = 0;
    this.classList = new ClassList(this);
    // 布局相关：给图表用的假尺寸
    this.offsetWidth = 300;
    this.offsetHeight = 150;
    this.className = '';
  }

  get classListValue() { return this._class; }

  /** 元素节点类型（h() 用鸭子类型判断节点，必须有这个） */
  get nodeType() {
    return 1;
  }

  set className(v) {
    this._class = String(v || '');
    this.classList.set = new Set(this._class.split(/\s+/).filter(Boolean));
  }
  get className() {
    return this._class;
  }

  set id(v) { this.setAttribute('id', v); }
  get id() { return this.getAttribute('id') || ''; }

  set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; }
  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('') + this._text;
    return this._text;
  }

  set innerHTML(v) {
    this._html = String(v || '');
    this.children = [];
    this._text = '';
  }
  get innerHTML() { return this._html || ''; }

  setAttribute(k, v) {
    this.attributes.set(k, String(v));
    if (k === 'class') this.className = v;
    if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
  }
  getAttribute(k) {
    if (k === 'class') return this.className;
    return this.attributes.has(k) ? this.attributes.get(k) : null;
  }
  removeAttribute(k) {
    this.attributes.delete(k);
    if (k === 'class') this.className = '';
  }
  hasAttribute(k) {
    return k === 'class' ? !!this._class : this.attributes.has(k);
  }

  appendChild(node) {
    if (!node) return node;
    if (node instanceof Fragment) {
      node.children.slice().forEach((c) => this.appendChild(c));
      return node;
    }
    if (node.parentElement) node.parentElement.removeChild(node);
    node.parentElement = this;
    this.children.push(node);
    return node;
  }
  append(...nodes) {
    nodes.forEach((n) => this.appendChild(typeof n === 'string' ? new TextNode(n) : n));
  }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) {
      this.children.splice(i, 1);
      node.parentElement = null;
    }
    return node;
  }
  remove() {
    if (this.parentElement) this.parentElement.removeChild(this);
  }
  get firstChild() {
    return this.children[0] || null;
  }
  get lastChild() {
    return this.children[this.children.length - 1] || null;
  }
  get childElementCount() {
    return this.children.length;
  }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    const s = this._listeners.get(type);
    if (s) s.delete(fn);
  }
  /** 测试用：触发事件 */
  dispatch(type, event = {}) {
    const ev = Object.assign({ type, target: this, stopPropagation() {}, preventDefault() {} }, event);
    const s = this._listeners.get(type);
    if (s) for (const fn of Array.from(s)) fn(ev);
    if (this.parentElement) this.parentElement.dispatch(type, ev);
    else this._bubbleToGlobal(type, ev);
    return ev;
  }

  /** 事件冒泡到根之后，再派发给 document / window 上的监听器（贴近浏览器行为） */
  _bubbleToGlobal(type, ev) {
    const doc = globalThis.document;
    const win = globalThis.window;
    for (const host of [doc, win]) {
      const set = host && host._listeners && host._listeners.get(type);
      if (set) for (const fn of Array.from(set)) fn(ev);
    }
  }
  click() {
    this.dispatch('click');
  }
  focus() {}
  blur() {}
  setSelectionRange() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, right: this.offsetWidth, bottom: this.offsetHeight, width: this.offsetWidth, height: this.offsetHeight };
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
  querySelectorAll(sel) {
    const found = [];
    const stack = [this];
    while (stack.length) {
      const node = stack.pop();
      const kids = node.children || [];
      for (let i = kids.length - 1; i >= 0; i--) {
        const c = kids[i];
        if (c == null) continue;
        if (isEl(c)) {
          if (matches(c, sel)) found.push(c);
          stack.push(c);
        }
      }
    }
    // 复合选择器（逗号分隔）时仍需文档顺序 → 按路径做字典序排序
    found.sort((a, b) => {
      const pa = pathOf(a);
      const pb = pathOf(b);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] == null ? -1 : pa[i];
        const y = pb[i] == null ? -1 : pb[i];
        if (x !== y) return x - y;
      }
      return 0;
    });
    return found;
  }
  closest(sel) {
    let n = this;
    while (n) {
      if (n instanceof Element && matches(n, sel)) return n;
      n = n.parentElement;
    }
    return null;
  }
  contains(node) {
    let n = node;
    while (n) {
      if (n === this) return true;
      n = n.parentElement;
    }
    return false;
  }

  getContext() {
    return makeContext();
  }
  toDataURL() {
    return 'data:,';
  }
  /** 模拟 scrollTo */
  scrollTo() {}
}

class TextNode {
  constructor(text) {
    this._text = String(text);
    this.parentElement = null;
    this.children = [];
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  get nodeType() { return 3; }
  remove() {
    if (this.parentElement) this.parentElement.removeChild(this);
  }
}

/** 文档片段：nodeType 11，appendChild 时展开子节点 */
class Fragment extends Element {
  constructor() {
    super('#fragment');
  }
  get nodeType() {
    return 11;
  }
  get textContent() {
    return this.children.map((c) => c.textContent || '').join('');
  }
}

/** 判断是不是我们的元素（不用 instanceof，避免 Fragment/TextNode 混淆） */
function isEl(v) {
  return !!v && typeof v === 'object' && typeof v.tagName === 'string' && Array.isArray(v.children);
}

/**
 * 文档路径（每层在父节点中的下标数组），用于字典序比较。
 * 早期版本把路径压成一个数字（每层 ×1000 再相加），在节点较多时
 * 低位会被高位「吃掉」，导致 querySelectorAll 的顺序错乱、
 * 依赖下标的计算（如轮盘落位）全部失真。
 */
function pathOf(node) {
  const path = [];
  let n = node;
  while (n && n.parentElement) {
    path.unshift(n.parentElement.children.indexOf(n));
    n = n.parentElement;
  }
  return path;
}

/** 极简选择器匹配：#id、.class、tag、[data-x]、* ，组合用逗号 */
function matches(el, sel) {
  return String(sel).split(',').some((one) => {
    let s = one.trim();
    if (!s) return false;
    if (s === '*') return true;
    // 去掉组合选择器里的空格部分（只匹配最后一段，够用）
    const parts = s.split(/\s+/);
    s = parts[parts.length - 1];
    const attr = s.match(/\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/);
    if (attr) {
      const key = attr[1];
      const val = attr[2];
      const has = key.startsWith('data-')
        ? el.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] != null || el.attributes.has(key)
        : el.attributes.has(key);
      if (!has) return false;
      if (val != null && val !== '') {
        const actual = key.startsWith('data-') ? el.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : el.getAttribute(key);
        if (String(actual) !== val) return false;
      }
      s = s.replace(/\[[^\]]*\]/, '');
      if (!s) return true;
    }
    if (s.startsWith('#')) return el.id === s.slice(1);
    if (s.startsWith('.')) {
      return s.split('.').filter(Boolean).every((c) => el.classList.contains(c));
    }
    if (/^[a-zA-Z]+$/.test(s)) return el.tagName === s.toUpperCase();
    // tag.class / tag#id 简单形式
    const m = s.match(/^([a-zA-Z]+)([.#][\w.#-]+)?$/);
    if (m) {
      if (el.tagName !== m[1].toUpperCase()) return false;
      if (m[2]) return matches(el, m[2]);
      return true;
    }
    return false;
  });
}

/** Canvas 2D 上下文桩：记录调用次数，保证图表代码不炸 */
function makeContext() {
  const noop = () => {};
  const ctx = {
    canvas: null,
    calls: 0,
    setTransform: noop,
    clearRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fill: noop,
    closePath: noop,
    rect: noop,
    fillRect: noop,
    strokeRect: noop,
    arc: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    fillText: noop,
    strokeText: noop,
    measureText: () => ({ width: 20 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    setLineDash: noop,
    drawImage: noop,
    font: '',
    textAlign: '',
    textBaseline: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
  };
  return ctx;
}

/* --------------------------------------------------------------- 安装 */

export function installDom() {
  const doc = {
    documentElement: new Element('html'),
    head: new Element('head'),
    body: new Element('body'),
    _byId: new Map(),
    createElement: (tag) => new Element(tag),
    createElementNS: (ns, tag) => new Element(tag, ns),
    createTextNode: (t) => new TextNode(t),
    createDocumentFragment: () => new Fragment(),
    addEventListener(type, fn) {
      if (!this._listeners) this._listeners = new Map();
      if (!this._listeners.has(type)) this._listeners.set(type, new Set());
      this._listeners.get(type).add(fn);
    },
    removeEventListener() {},
    getElementById(id) {
      return this._byId.get(id) || null;
    },
    querySelector(sel) {
      return this.body.querySelector(sel) || (this.documentElement.querySelector(sel));
    },
    querySelectorAll(sel) {
      return this.body.querySelectorAll(sel);
    },
  };
  doc.body.parentElement = doc.documentElement;

  // index.html 里的关键挂载点
  const ids = ['views', 'toasts', 'layer', 'tabbar', 'sidebar', 'sidebar-nav', 'sidebar-account', 'sidebar-foot', 'appbar-date', 'appbar-index', 'appbar-mood', 'speed-ctl', 'btn-sound', 'btn-help'];
  for (const id of ids) {
    const el = new Element(id === 'toasts' || id === 'layer' ? 'div' : 'div');
    el.id = id;
    doc.body.appendChild(el);
    doc._byId.set(id, el);
  }

  const localStorageData = new Map();
  const localStorage = {
    getItem: (k) => (localStorageData.has(k) ? localStorageData.get(k) : null),
    setItem: (k, v) => localStorageData.set(k, String(v)),
    removeItem: (k) => localStorageData.delete(k),
    clear: () => localStorageData.clear(),
    key: (i) => Array.from(localStorageData.keys())[i] || null,
    get length() { return localStorageData.size; },
  };

  const win = {
    innerWidth: 1280,
    innerHeight: 900,
    devicePixelRatio: 1,
    location: { hash: '', protocol: 'https:', reload() {}, href: 'https://tml.zhonglike.tech/' },
    navigator: { userAgent: 'mono-test', vibrate() {}, storage: { estimate: async () => ({ usage: 0, quota: 0 }) } },
    document: doc,
    localStorage,
    _listeners: new Map(),
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, new Set());
      this._listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      const s = this._listeners.get(type);
      if (s) s.delete(fn);
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    AudioContext: null,
    webkitAudioContext: null,
    FileReader: class {
      readAsText() {
        if (this.onload) this.onload();
      }
    },
    // Node 18+ 自带 Blob / URL.createObjectURL，直接用原生实现，测得更真
    Blob: typeof Blob !== 'undefined' ? Blob : undefined,
    URL: typeof URL !== 'undefined' ? URL : undefined,
    indexedDB: undefined,
  };

  globalThis.window = win;
  globalThis.document = doc;
  // Node 20+ 里 navigator 是只读的 getter，用 defineProperty 覆盖
  try {
    Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true, writable: true });
  } catch (e) { /* 某些运行时允许直接赋值 */ }
  globalThis.localStorage = localStorage;
  globalThis.location = win.location;
  globalThis.requestAnimationFrame = win.requestAnimationFrame;
  globalThis.cancelAnimationFrame = win.cancelAnimationFrame;
  globalThis.matchMedia = win.matchMedia;
  globalThis.getComputedStyle = win.getComputedStyle;
  globalThis.Blob = win.Blob;
  globalThis.FileReader = win.FileReader;
  globalThis.performance = globalThis.performance || { now: () => Date.now() };
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;

  return { doc, win, localStorage };
}

export { Element, TextNode, Fragment, matches };
