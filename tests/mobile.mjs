/**
 * MONO — 移动端适配审计
 * 把每个页面按 375px（iPhone 逻辑宽度）渲染，逐元素检查：
 *   · 是否超出容器宽度（横向溢出）
 *   · 是否硬编码了超过手机宽度的固定宽度
 *   · 表格 / 行内是否禁止换行且可能溢出
 *   · 网格列数在窄屏下是否过密
 *   · Canvas 是否按容器宽度绘制
 *   node tests/mobile.mjs
 */
import { installDom } from './dom-stub.mjs';

const WIDTH = Number(process.argv[2] || 375);
const { doc, win } = installDom();
win.innerWidth = WIDTH;
doc.documentElement.clientWidth = WIDTH;

const engine = await import('../src/core/engine.js');
const { S } = await import('../src/core/state.js');
const { getItem } = await import('../src/core/catalog.js');
const { VIEWS, NAV } = await import('../src/ui/views.js');
const loot = await import('../src/systems/loot.js');

engine.boot('mobile-audit');
S.player.cash = 300000;
S.player.level = 8;
loot.drawMany(24, engine.engine.rng, { priceEach: 500, charge: () => true });

// 让 layout 相关尺寸跟手机一致：元素没有真实布局，用父宽推算
const ROOT_PAD = 16;
const VIEW_W = WIDTH - ROOT_PAD * 2;

const viewsHost = document.getElementById('views');
const ctx = {
  rng: engine.engine.rng,
  settings: S.settings,
  setSpeed: engine.setSpeed,
  setAlert: engine.setAlert,
  clearAlert: engine.clearAlert,
  itemOf: getItem,
  dashboard: () => engine.dashboard(),
  watchlist: [],
  lastItemId: 'ak47-redline',
  ledger: () => {},
  go: () => {},
  back: () => {},
  newGame: () => {},
  loadSlot: async () => true,
  reload: () => {},
  saveSettings: () => {},
  resetMarket: () => {},
  haptic: () => {},
};

/** 解析内联宽度：返回 px 或 null */
function pxOf(v) {
  if (!v) return null;
  const m = String(v).trim().match(/^([\d.]+)px$/);
  return m ? Number(m[1]) : null;
}

/**
 * 估算一段文字的渲染宽度。
 * 校验：CJK / 全角标点按 1em，其余按 0.55em（等宽数字约 0.6em）。
 * 没有真实字体度量，用这个近似值抓「明显会撑破」的情况。
 */
function textWidth(text, fontPx = 13) {
  let em = 0;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    // CJK 统一表意文字、全角标点、假名、韩文
    const wide = (c >= 0x1100 && c <= 0x115f)
      || (c >= 0x2e80 && c <= 0xa4cf)
      || (c >= 0xac00 && c <= 0xd7a3)
      || (c >= 0xf900 && c <= 0xfaff)
      || (c >= 0xfe30 && c <= 0xfe6f)
      || (c >= 0xff00 && c <= 0xff60)
      || (c >= 0xffe0 && c <= 0xffe6);
    em += wide ? 1 : 0.55;
  }
  return em * fontPx;
}

/** 类名 → 估算字号 */
function fontOf(cls) {
  if (/fs-11|hint|wear|item__sub|item__meta|tag|rarity|stat__label|field__label|kbd|rank__no/.test(cls)) return 11;
  if (/fs-12|hint/.test(cls)) return 12;
  if (/view__title/.test(cls)) return 22;
  if (/view__sub|item__name/.test(cls)) return 13;
  if (/stat__value/.test(cls)) return 20;
  if (/item__price/.test(cls)) return 13;
  return 13;
}

/** 直接文字（不含子元素文字） */
function ownText(el) {
  let out = '';
  for (const c of el.children) {
    if (c && c.nodeType === 3) out += c.textContent || '';
  }
  if (!out && (!el.children || el.children.length === 0)) out = el.textContent || '';
  return out.trim();
}

/**
 * 取类名字符串。
 * 注意：SVGElement.className 是只读的 SVGAnimatedString，不是字符串，
 * 直接 .toLowerCase() 会抛错（图标全是 SVG，所以这里必须绕开）。
 */
function classNameOf(el) {
  try {
    const c = el.className;
    if (typeof c === 'string') return c;
  } catch (e) { /* 某些宿主会抛 */ }
  const list = el.classList;
  if (list) {
    if (typeof list.value === 'string') return list.value;
    if (typeof list.baseVal === 'string') return list.baseVal;
    if (list.set instanceof Set) return Array.from(list.set).join(' ');
  }
  return '';
}

/** 遍历子树，收集问题 */
function audit(root, label) {
  const issues = [];
  const walk = (el, parentW, path) => {
    // 只审计真正的元素：TextNode / DocumentFragment 没有 tagName
    if (!el || typeof el.tagName !== 'string' || !Array.isArray(el.children)) return;
    const cls = classNameOf(el);
    const own = pxOf(el.style && el.style.width);
    const w = own != null ? own : parentW;
    const id = el.id ? '#' + el.id : '';
    const where = `${path}${el.tagName.toLowerCase()}${id}${cls ? '.' + cls.split(/\s+/).join('.') : ''}`;

    if (own != null && own > WIDTH) {
      issues.push({ kind: 'fixed-too-wide', where, detail: `固定宽 ${own}px > 屏幕 ${WIDTH}px` });
    }

    // 文字是否撑破容器。
    // 只检查「叶子文本」：容器元素（含子元素）里的文字自然会在子元素之间换行，
    // 拿它的整段文字去比宽度会产生误报。
    const hasElKids = (el.children || []).some((c) => c && typeof c.tagName === 'string');
    const txt = hasElKids ? '' : ownText(el);
    if (txt && txt.length < 200) {
      const fs = fontOf(cls);
      const tw = textWidth(txt, fs);
      // 是否「不换行」——需要与 main.css 里的媒体查询保持一致：
      //   ≤560px 时表格单元格、kv 值都已放开折行（见 CSS 中的 @media (max-width: 560px)）
      const narrow = WIDTH <= 560;
      const kvNowrap = !narrow;
      const nowrap = /item__name|item__sub|item__meta|item__price|ellipsis|nowrap|table/.test(cls)
        || (kvNowrap && /kv__v/.test(cls))
        || el.tagName === 'TD' || el.tagName === 'TH';
      const ellipsis = /ellipsis/.test(cls);
      if (tw > w + 0.5 && nowrap && !ellipsis && w > 0) {
        issues.push({
          kind: 'text-overflow',
          where,
          detail: `「${txt.slice(0, 18)}」估算 ${Math.round(tw)}px > 容器 ${Math.round(w)}px`,
        });
      }
    }

    // 表格：nowrap 单元格在窄屏会撑破
    if (el.tagName === 'TABLE' && w > WIDTH) {
      issues.push({ kind: 'table-overflow', where, detail: `表格可用宽 ${w}px` });
    }
    // 表格：所有列 nowrap 后的总宽（真实浏览器的行为）
    if (el.tagName === 'TABLE') {
      const body = el.children.find((c) => c.tagName === 'TBODY');
      const head = el.children.find((c) => c.tagName === 'THEAD');
      const rowOf = (sec) => {
        if (!sec) return null;
        const tr = sec.children.find((c) => c.tagName === 'TR');
        return tr ? tr.children.filter((c) => c.tagName === 'TD' || c.tagName === 'TH') : null;
      };
      const cells = rowOf(body) || rowOf(head);
      if (cells && cells.length) {
        const total = cells.reduce((s, c) => s + textWidth(ownText(c), 11) + 20, 0);
        if (total > WIDTH) {
          issues.push({
            kind: 'table-too-wide',
            where,
            detail: `${cells.length} 列 nowrap 估算总宽 ${Math.round(total)}px > ${WIDTH}px（手机需要卡片式或横向滚动）`,
          });
        }
        const maxCell = cells.map((c) => textWidth(ownText(c), 11)).reduce((a, b) => Math.max(a, b), 0);
        if (maxCell > 110) {
          issues.push({ kind: 'wide-cell', where, detail: `最宽单元格估算 ${Math.round(maxCell)}px（nowrap）` });
        }
      }
    }

    // 网格列数
    if (el.style && el.style.gridTemplateColumns) {
      const cols = String(el.style.gridTemplateColumns).split(/\s+/).filter(Boolean).length;
      if (cols >= 3 && WIDTH <= 430) {
        issues.push({ kind: 'grid-dense', where, detail: `${cols} 列 @ ${WIDTH}px` });
      }
    }
    // 行内不让换行 + 元素多
    if (el.classList && el.classList.contains('row') && !el.classList.contains('row--wrap')) {
      let kids = 0;
      let kidsW = 0;
      for (const c of el.children) {
        if (!c || typeof c.tagName !== 'string') continue;
        kids++;
        const cw = pxOf(c.style && c.style.width);
        kidsW += cw != null ? cw : (ownText(c) ? textWidth(ownText(c), fontOf(classNameOf(c))) : 0);
      }
      if (kids >= 3 && kidsW > w && w > 0) {
        issues.push({
          kind: 'row-overflow',
          where,
          detail: `${kids} 个子元素估算总宽 ${Math.round(kidsW)}px > 容器 ${Math.round(w)}px 且不换行`,
        });
      }
    }

    for (const c of el.children) walk(c, w, where + ' > ');
  };
  walk(root, VIEW_W, '');
  return issues;
}

const report = {};
let total = 0;
for (const id of Object.keys(VIEWS)) {
  try {
    const inst = VIEWS[id].create(ctx);
    viewsHost.appendChild(inst.el);
    if (inst.onEnter) inst.onEnter(id === 'item' ? { id: 'ak47-redline' } : {});
    const issues = audit(inst.el, id);
    report[id] = issues;
    total += issues.length;
    inst.el.remove();
  } catch (e) {
    report[id] = [{ kind: 'render-error', where: id, detail: (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' ⏎ ') : e.message) }];
    total++;
  }
}

console.log(`\n== 移动端适配审计 @ ${WIDTH}px ==\n`);
for (const id of Object.keys(report)) {
  const nav = NAV.find((n) => n.id === id);
  const issues = report[id];
  const title = (nav ? nav.label : id).padEnd(8, '　');
  if (!issues.length) {
    console.log(`  ok   ${title} 无适配问题`);
    continue;
  }
  console.log(`  ──   ${title} ${issues.length} 处`);
  const byKind = {};
  for (const it of issues) {
    byKind[it.kind] = byKind[it.kind] || [];
    byKind[it.kind].push(it);
  }
  for (const kind of Object.keys(byKind)) {
    const list = byKind[kind];
    console.log(`       [${kind}] ${list.length} 处`);
    for (const it of list.slice(0, 4)) {
      console.log(`         · ${it.where.slice(-110)}`);
      console.log(`           ${it.detail}`);
    }
  }
}

console.log(`\n合计 ${total} 处待处理\n`);
process.exit(total ? 1 : 0);
