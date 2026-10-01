/**
 * MONO — 启动回归测试
 * 之前的测试只 import 模块、没有真的跑启动流程，所以漏掉了
 * `engine.engine.dashboard is not a function` 这类只有启动才会暴露的错误。
 * 这里用 DOM 桩把 src/main.js 完整启动一遍。
 *   node tests/boot.mjs
 */
import { installDom } from './dom-stub.mjs';

installDom();

const failures = [];
const ok = (cond, label, extra = '') => {
  if (cond) console.log(`  ok   ${label}${extra ? ' — ' + extra : ''}`);
  else {
    failures.push(label);
    console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`);
  }
};

// 抓取控制台与未捕获错误
const logs = [];
const errors = [];
const origError = console.error;
console.error = (...a) => {
  errors.push(a.map(String).join(' '));
  origError('[console.error 捕获]', ...a);
};
console.log('== 启动 src/main.js ==');

let booted = false;
const origLog = console.log;
console.log = (...a) => {
  const line = a.map(String).join(' ');
  logs.push(line);
  if (line.startsWith('[mono] booted')) booted = true;
  origLog(line);
};

const t0 = Date.now();
try {
  await import('../src/main.js');
  // 启动是 async：等它跑完（引擎预热 20 天 + 存档读取）
  for (let i = 0; i < 120 && !booted; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
} catch (e) {
  ok(false, 'main.js 加载并启动', e && e.message);
  console.error(e);
}
console.log = origLog;

ok(errors.length === 0, '启动过程无 console.error', errors.length ? errors[0].slice(0, 160) : '');
ok(booted, '打印启动完成日志', logs.find((l) => l.startsWith('[mono] booted')) || '(未出现 booted 日志)');

// 启动后应当已经渲染出界面
const views = document.getElementById('views');
ok(views && views.children.length > 0, '视图容器已渲染', views ? `${views.children.length} 个子视图` : '无 #views');
const active = views ? views.children.filter((c) => c.classList && c.classList.contains('is-active')) : [];
ok(active.length === 1, '恰好一个页面处于激活态', `${active.length} 个`);
ok(active[0] && active[0].dataset && active[0].dataset.view === 'dashboard', '默认落在仪表盘', active[0] && active[0].dataset ? active[0].dataset.view : '-');

// 顶栏与导航是否真的填上了内容
const dateEl = document.getElementById('appbar-date');
const idxEl = document.getElementById('appbar-index');
ok(dateEl && dateEl.textContent && dateEl.textContent !== '—', '顶栏日期已填充', dateEl ? dateEl.textContent : '-');
ok(idxEl && /IDX/.test(idxEl.textContent), '顶栏指数已填充', idxEl ? idxEl.textContent : '-');
const tabbar = document.getElementById('tabbar');
ok(tabbar && tabbar.children.length === 5, '底部标签栏 5 项', tabbar ? `${tabbar.children.length} 项` : '-');
const sidebarNav = document.getElementById('sidebar-nav');
ok(sidebarNav && sidebarNav.children.length > 0, '侧边栏导航已构建', sidebarNav ? `${sidebarNav.children.length} 组` : '-');
const speedCtl = document.getElementById('speed-ctl');
ok(speedCtl && speedCtl.children.length >= 5, '速度控件已构建', speedCtl ? `${speedCtl.children.length} 档` : '-');

// 启动一次开箱（走 UI 的真实按钮），验证轮盘链路在真实启动态下也能跑
console.log('\n== 启动态下点一次「单抽」 ==');
try {
  const drawTab = tabbar.children.find((c) => c.dataset && c.dataset.tab === 'draw');
  if (drawTab) drawTab.click();
  const drawView = views.children.find((c) => c.dataset && c.dataset.view === 'draw');
  ok(!!drawView, '切到抽奖中心');
  const btns = drawView ? drawView.querySelectorAll('[data-draw-n]') : [];
  ok(btns.length === 3, '三个抽奖按钮就绪', `${btns.length} 个`);
  const single = btns.find((b) => b.dataset.drawN === '1');
  if (single) {
    single.click();
    // 等待抽奖 + 轮盘（DOM 桩里 rAF 是 0ms，很快）
    await new Promise((r) => setTimeout(r, 1200));
    const reels = drawView.querySelectorAll('.reel__card');
    ok(reels.length > 0, '轮盘已在真实启动态渲染', `${reels.length} 张卡`);
    const results = drawView.querySelectorAll('.item');
    ok(results.length > 0, '开箱结果面板已渲染', `${results.length} 条`);
  } else {
    ok(false, '找到单抽按钮');
  }
} catch (e) {
  ok(false, '启动态开箱', e && e.message);
  console.error(e);
}

ok(errors.length === 0, '全流程无 console.error', errors.length ? errors.slice(0, 2).join(' | ').slice(0, 200) : `耗时 ${Date.now() - t0}ms`);

console.log(`\n结果：${failures.length ? failures.length + ' 项失败 → ' + failures.join(' / ') : '全部通过'}\n`);
process.exit(failures.length ? 1 : 0);
