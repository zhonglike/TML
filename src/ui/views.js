/**
 * MONO — 页面注册表
 * 每个 view 模块导出一个 create(ctx) -> { el, onEnter, onTick, onDestroy }
 */
import * as dashboard from './views/dashboard.js';
import * as bag from './views/bag.js';
import * as draw from './views/draw.js';
import * as market from './views/market.js';
import * as itemView from './views/item.js';
import * as orders from './views/orders.js';
import * as auction from './views/auction.js';
import * as records from './views/records.js';
import * as quests from './views/quests.js';
import * as settings from './views/settings.js';

export const VIEWS = {
  dashboard,
  bag,
  draw,
  market,
  item: itemView,
  orders,
  auction,
  records,
  quests,
  settings,
};

/** 导航结构：移动端标签栏 + 桌面侧边栏 */
export const NAV = [
  { id: 'dashboard', label: '仪表盘', icon: 'home', group: '经营' },
  { id: 'draw', label: '抽奖中心', icon: 'draw', group: '经营' },
  { id: 'bag', label: '背包', icon: 'bag', group: '经营' },
  { id: 'market', label: '市场', icon: 'market', group: '交易' },
  { id: 'orders', label: '挂单', icon: 'list', group: '交易' },
  { id: 'auction', label: '拍卖行', icon: 'auction', group: '交易' },
  { id: 'records', label: '交易记录', icon: 'records', group: '账户' },
  { id: 'quests', label: '任务与成就', icon: 'quests', group: '账户' },
  { id: 'settings', label: '设置', icon: 'settings', group: '账户' },
];

/** 移动端标签栏只放 5 个 */
export const TABBAR = ['dashboard', 'draw', 'market', 'bag', 'quests'];
