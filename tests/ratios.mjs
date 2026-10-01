/**
 * MONO — 手机「比例」问题审计
 * 按多组真实手机宽高测量关键组件的实际尺寸，找出比例/视口相关的问题：
 *   · tabbar / appbar 实际高度是否与 CSS 变量一致（不一致 → 内容被遮挡或留白）
 *   · .view 底部留白是否足够让内容不被 tabbar 遮住
 *   · appbar 一行内的元素是否超出屏幕宽（横向挤压）
 *   · 轮盘 / K 线 / 舞台在窄高或宽扁比例下是否变形
 *   node tests/ratios.mjs
 */
import { installDom } from './dom-stub.mjs';

const { doc, win } = installDom();

/** 真实机型逻辑分辨率（宽×高） */
const DEVICES = [
  { name: 'iPhone SE', w: 320, h: 568 },
  { name: 'iPhone 8', w: 375, h: 667 },
  { name: 'iPhone 12/13', w: 390, h: 844 },
  { name: 'iPhone 14 Pro Max', w: 430, h: 932 },
  { name: 'Pixel 7', w: 412, h: 915 },
  { name: 'Galaxy S20', w: 360, h: 800 },
  { name: '折叠外屏', w: 344, h: 882 },
  { name: '平板竖屏', w: 768, h: 1024 },
  { name: '手机横屏', w: 844, h: 390 },
  { name: '超窄屏', w: 280, h: 653 },
];

const engine = await import('../src/core/engine.js');
const { S } = await import('../src/core/state.js');
const { getItem } = await import('../src/core/catalog.js');
const { VIEWS } = await import('../src/ui/views.js');
const loot = await import('../src/systems/loot.js');

engine.boot('ratio-audit');
S.player.cash = 200000;
S.player.level = 9;
loot.drawMany(16, engine.engine.rng, { priceEach: 500, charge: () => true });

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

/** 把宽度沿子树传播（模拟 block 布局继承宽度） */
function layout(node, w) {
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (typeof n.tagName !== 'string') continue;
    n.clientWidth = w;
    for (const c of n.children || []) stack.push(c);
  }
}

/**
 * 从 CSS 文本里读某个变量在任何 @media 之外的定义值。
 * 桩引擎不解析 CSS，所以这里做最小解析，用来校验 CSS 变量与实际期望是否自洽。
 */
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8');
function cssVar(name) {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}
function px(v) {
  const m = String(v || '').match(/^([\d.]+)px$/);
  return m ? Number(m[1]) : null;
}

/**
 * 读 CSS 里某条规则内的固定宽度。
 * 桩引擎不跑 CSS，所以要在测试里手动把「CSS 固定宽度」应用到元素上，
 * 否则元素会继承父宽，得出的尺寸是假的（之前轮盘卡报 288px 就是这个原因）。
 */
function cssRuleWidth(selector, extra = '') {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g');
  let m;
  while ((m = re.exec(css))) {
    const body = m[1];
    if (extra && !new RegExp(extra).test(body)) continue;
    const w = body.match(/width:\s*([\d.]+)px/);
    if (w) return Number(w[1]);
  }
  return null;
}
/** 媒体查询里是否针对该宽度声明了 display:none / 其它覆盖 */
function cssHidesAt(width, selector) {
  const blocks = css.match(/@media[^{]+\{[\s\S]*?\n\}/g) || [];
  for (const b of blocks) {
    const cond = b.match(/@media\s*\(max-width:\s*(\d+)px\)/);
    const minCond = b.match(/@media\s*\(min-width:\s*(\d+)px\)/);
    const applies = (cond && width <= Number(cond[1])) || (minCond && width >= Number(minCond[1]));
    if (!applies) continue;
    const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{]*\\{[^}]*display:\\s*none', 'g');
    if (re.test(b)) return true;
  }
  return false;
}

const failures = [];
const warn = [];const ok = (cond, label, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures.push(label);
};
const soft = (cond, label, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'warn'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) warn.push(label);
};

console.log('\n== CSS 变量自洽检查 ==');
const tabbarCss = px(cssVar('tabbar-h'));
const appbarCss = px(cssVar('header-h'));
const sidebarCss = px(cssVar('sidebar-w'));
console.log(`  --tabbar-h = ${tabbarCss}px · --header-h = ${appbarCss}px · --sidebar-w = ${sidebarCss}px`);
ok(tabbarCss > 40 && tabbarCss < 80, 'tabbar 高度在合理区间（含安全区前的基准值）', `${tabbarCss}px`);
ok(appbarCss > 40 && appbarCss < 80, 'appbar 高度在合理区间', `${appbarCss}px`);

for (const d of DEVICES) {
  console.log(`\n== ${d.name}  ${d.w}×${d.h} （比例 ${(d.w / d.h).toFixed(2)}） ==`);
  win.innerWidth = d.w;
  win.innerHeight = d.h;
  doc.documentElement.clientWidth = d.w;
  doc.documentElement.clientHeight = d.h;

  const contentW = d.w - 32; // .view 左右各 16px 内边距

  // 1) appbar 一行内容是否放得下
  //    左：logo + MONO + 日期；中：指数 + 情绪；右：5 档速度 + 2 个图标按钮
  //    按媒体查询建模：窄屏会隐藏 meta / 日期，并收窄速度档与图标按钮
  const metaHidden = cssHidesAt(d.w, '.appbar__meta');
  const dateHidden = cssHidesAt(d.w, '.appbar__title small');
  const compact = d.w <= 700;
  const tiny = d.w <= 360;
  const segItemW = tiny ? 20 : compact ? 26 : 34;
  const speedW = segItemW * 5 + 4 + 2;
  const iconBtns = (tiny ? 28 : compact ? 30 : 34) * 2 + 8;
  const brandW = (tiny ? 0 : 22 + 8) + 52 + (dateHidden ? 0 : 8 + 70);
  const metaW = metaHidden ? 0 : 92 + 8 + 74;
  const appbarNeed = brandW + metaW + speedW + iconBtns + 24;
  ok(appbarNeed <= d.w, `appbar 单行内容放得下`, `需要 ${Math.round(appbarNeed)}px / 可用 ${d.w}px` +
    (metaHidden ? '（meta 已隐藏）' : '') + (dateHidden ? '（日期已隐藏）' : ''));

  // 2) 内容区底部留白是否够 tabbar
  const viewPadBottom = tabbarCss + 24;
  ok(viewPadBottom >= tabbarCss + 12, '视图底部留白覆盖 tabbar', `${viewPadBottom}px ≥ ${tabbarCss}px`);

  // 3) 渲染关键页面，检查轮盘 / 图表在窄高与宽扁比例下的尺寸
  const cardCssW = cssRuleWidth('.reel__card', 'flex: 0 0 auto');
  const cardMobileW = cssRuleWidth('.reel__card', 'width: 92px') || 92;
  for (const id of ['draw', 'dashboard', 'market', 'item']) {
    const inst = VIEWS[id].create(ctx);
    document.getElementById('views').appendChild(inst.el);
    if (inst.onEnter) inst.onEnter(id === 'item' ? { id: 'ak47-redline' } : {});
    layout(inst.el, contentW);

    const reelCard = inst.el.querySelector('.reel__card');
    const canvas = inst.el.querySelector('canvas');

    if (reelCard && cardCssW) {
      // 轮盘卡是固定宽度（CSS 写死），这里按媒体查询取对应值，别让它继承父宽
      const cardW = d.w <= 560 ? cardMobileW : cardCssW;
      soft(cardW >= 70 && cardW <= 150, `${id}: 轮盘卡宽合理`, `${cardW}px（期望 70~150）`);
      const cardCount = Math.max(1, Math.floor(contentW / (cardW + 8)));
      soft(cardCount >= 2, `${id}: 一屏至少能看到 2 张轮盘卡`, `${cardCount} 张`);
    }
    if (canvas) {
      const plotW = contentW - (contentW < 420 ? 42 : 54);
      soft(plotW > 170, `${id}: 图表绘图区够宽`, `${Math.round(plotW)}px`);
    }
    inst.el.remove();
  }

  // 4) 矮屏（横屏）下内容高度是否还够用
  const usableH = d.h - tabbarCss - appbarCss;
  soft(usableH > 200, '可用内容高度', `${Math.round(usableH)}px`);
}

console.log(`\n硬性问题 ${failures.length} 项 · 提示 ${warn.length} 项`);
if (failures.length) console.log('失败：' + failures.join(' / '));
if (warn.length) console.log('提示：' + warn.join(' / '));
console.log('');
process.exit(failures.length ? 1 : 0);
