# MONO — 极简 · 暗黑经营模拟

> 一款以大厂极简美学（Apple / Notion / Linear / Vercel / 数据仪表盘）为视觉语言的**抽奖经营模拟游戏**。
> 纯前端、单机、无后端、无账号、无联网依赖；主线是 GitHub Pages，副线是 WebView 套壳出 EXE / APK。

- **线上地址**：<https://tml.zhonglike.tech>（GitHub Pages + CNAME）
- **仓库**：`zhonglike/TML`
- **图鉴规模**：**535 种**标的（CS2 饰品 224 / AI 算力 93 / 电脑配件 122 / 虚拟资产 98）
- **技术栈**：HTML5 + CSS3 + 原生 ES2022 模块，**零 npm 依赖**，Canvas 手写图表

---

## 1. 核心循环

```
赚金币 → 购买抽奖机会 → 开箱获得物品 → 在市场倒买倒卖 → 赚更多钱 → 无限经营
```

**抽奖是负期望**（单抽期望回收 ≈ 成本的 60~85%，随等级上升），真正赚钱靠：

| 玩法 | 说明 |
| --- | --- |
| 低买高卖 | 关注相对锚价被低估的标的，等均值回归 |
| 事件交易 | 事件期间被错杀/错涨的品类价差最大 |
| 挂单套利 | 愿意等就用挂单，成交价明显高于回收商 |
| 拍卖捡漏 | 流拍与低关注度标的常有折价 |
| 品质溢价 | 同款皮肤的磨损与模板差异可以差出数倍 |

---

## 2. 目录结构

```
TML/
├── index.html                  # 应用外壳（页面由 JS 渲染）
├── manifest.webmanifest        # PWA
├── sw.js                       # Service Worker（首屏极快 + 离线可玩）
├── CNAME                       # 自定义域名：TML.zhonglike.tech
├── LICENSE
├── assets/icons/               # 图标（SVG + PNG，脚本生成）
├── data/prices.seed.json       # 价格锚点种子（可被 CI 定时刷新）
├── src/
│   ├── main.js                 # 入口：装配、路由、主循环、通知、自动保存
│   ├── core/
│   │   ├── const.js            # 常量：稀有度 / 磨损 / 时间 / 经济 / 市场参数
│   │   ├── util.js             # 格式化、hyperscript、事件总线、动画、手势
│   │   ├── rng.js              # 确定性随机（mulberry32 + xmur3）
│   │   ├── catalog.js          # 图鉴标准化与品相定价规则
│   │   ├── state.js            # 全局状态树与读取助手
│   │   ├── market.js           # 市场引擎：价格模型 / K 线 / 指数 / 情绪 / 事件
│   │   ├── engine.js           # 主引擎：时钟、tick 调度、离线推进、价格提醒
│   │   ├── save.js             # 双层存档（localStorage + IndexedDB）、导入导出
│   │   └── idb.js              # IndexedDB 封装（K 线历史 + 快照）
│   ├── data/                   # 四张静态数据表（由 scripts/gen-catalog.mjs 生成）
│   ├── systems/
│   │   ├── loot.js             # 抽奖：概率、保底、掉落数量、品相与模板
│   │   ├── economy.js          # 定价、回收、手续费、熔炼、每日限流
│   │   ├── inventory.js        # 背包聚合、堆叠、持仓盈亏
│   │   ├── trade.js            # 挂单（限价买卖）与成交引擎
│   │   ├── auction.js          # 拍卖行（NPC 自动加价、一口价、流拍）
│   │   ├── npc.js              # 6 种人格的 NPC 做市、库存重组、挂单簿
│   │   └── quest.js            # 任务链 / 每日任务 / 成就 / 签到
│   ├── ui/
│   │   ├── ui.js               # 通用组件：物品卡、稀有度、数字滚动、弹窗、提示
│   │   ├── charts.js           # Canvas：K 线 / 面积 / 迷你走势 / 成交量 / 十字光标
│   │   ├── sound.js            # WebAudio 合成音效（无音频文件）
│   │   ├── views.js            # 页面注册表与导航结构
│   │   └── views/              # 10 个页面
│   └── styles/main.css         # 设计系统（Liquid Glass / 黑白灰 / 响应式）
├── scripts/                    # 零依赖工具脚本
│   ├── gen-catalog.mjs         # 生成四张数据表
│   ├── gen-seed.mjs            # 生成 data/prices.seed.json
│   ├── gen-icons.mjs           # 手写 PNG 编码生成图标
│   ├── build-web.mjs           # 生成 dist/（Capacitor 输入 + Pages 发布物）
│   ├── release.mjs             # 发布前总检查
│   └── serve.mjs               # 本地静态服务器
├── tests/
│   ├── smoke.mjs               # 无浏览器：图鉴/市场/经济/交易/拍卖/任务
│   └── ui.mjs                  # 无浏览器 UI 渲染 + 交互 + 存档往返
├── desktop/                    # Electron 套壳（EXE / DMG / AppImage）
└── mobile/                     # Capacitor 套壳（APK）
```

---

## 3. 本地运行

需求：Node.js ≥ 18（仅用于本地预览与打包；网页本身不需要 Node）。

```bash
# 本地预览（零依赖脚本服务器）
npm start                 # → http://127.0.0.1:4173/

# 或者用任意静态服务器
npx serve .
python -m http.server 4173
```

> 必须通过 **HTTP(S)** 访问。直接双击 `index.html`（`file://`）时，浏览器会以 CORS 规则拦截 ES 模块，页面会白屏。

### 自检

```bash
npm test          # 冒烟测试：市场推进 30 天 + 2 万次抽奖经济 + 交易/挂单/拍卖全流程
node tests/ui.mjs # UI 无头渲染：10 个页面 + 交互模拟 + 存档往返
npm run release   # 发布前总检查（语法 + 资源完整性 + 上面两项）
```

---

## 4. 部署到 GitHub Pages（主站）

仓库已包含 `.github/workflows/pages.yml`，推送到 `main` 即自动部署。

1. 推到 `zhonglike/TML`：

   ```bash
   git remote add origin https://github.com/zhonglike/TML.git
   git push -u origin main
   ```

2. 打开 **Settings → Pages**，`Source` 选 **GitHub Actions**（不要选 `Deploy from a branch`，否则会绕过发布前检查）。
3. 等 Actions 跑完，站点就在 `https://zhonglike.github.io/TML/`。

> 工作流会先跑 `node scripts/release.mjs`（语法 + 资源 + 冒烟 + UI 测试），只有全绿才发布。

### 自定义域名 TML.zhonglike.tech

仓库根目录的 `CNAME` 已经写好：

```
TML.zhonglike.tech
```

在域名 DNS 处添加一条记录（二选一）：

| 类型 | 主机记录 | 记录值 | 说明 |
| --- | --- | --- | --- |
| CNAME | `TML` | `zhonglike.github.io` | 推荐，Pages 会同时签发 HTTPS 证书 |
| A | `TML` | `185.199.108.153` 等 4 条 | 不能用 CNAME 时才用 |

然后在 Pages 设置里填写 `Custom domain: TML.zhonglike.tech` → 勾选 **Enforce HTTPS**（证书签发通常几分钟到几小时）。

> DNS 生效后，`https://zhonglike.github.io/TML/` 会自动 301 到自定义域名。

---

## 5. 打包 Windows EXE（Electron / WebView2 内核）

```bash
cd desktop
npm install            # 只装 electron + electron-builder
npm start              # 本地运行（直接加载仓库根的 index.html）
npm run dist           # 产出 dist/MONO-Setup-1.0.0.exe 与 MONO-Portable-1.0.0.exe
```

- 打包配置会把 **仓库根目录的网页文件** 复制进 ASAR，因此桌面版与网页版是同一份代码。
- 想要更小的体积可以改用 Tauri（需 Rust 工具链），前端零改动，因为它同样只是加载这套静态文件。

## 6. 打包 Android APK（Capacitor）

```bash
node scripts/build-web.mjs      # 生成 dist/（Capacitor 的 webDir）
cd mobile
npm install
npx cap add android             # 首次
npm run sync
npm run open                    # Android Studio 里 Build → Build APK
# 或命令行：npm run apk:debug
```

- 移动端会自动使用底部标签栏布局（< 900px），并启用 `env(safe-area-inset-*)` 适配刘海屏。
- 竖屏 / 横屏均可，桌面端浏览器里也一样能玩。

## 7. PWA

用 Chrome / Edge / Safari 打开线上地址，地址栏会出现「安装」入口，安装后：

- 离线可玩（Service Worker 预缓存全部模块与图标）；
- 独立窗口、无浏览器工具栏；
- 存档仍然在本地，不随安装位置变化。

---

## 8. 系统设计

### 8.1 价格模型

```
price(t+1) = price(t) · exp( 随机游走 + 趋势动量 + 均值回归 + 玩家冲击 ) · 情绪溢价
```

- **随机游走**：每个标的有独立波动率（按稀有度分层，可由数据行 `vol` 覆盖），按 `√t` 缩放到每 tick。
- **趋势动量**：每个标的有 7~30 天的趋势周期，衰减系数 0.995。
- **均值回归**：偏离锚价越远回归越强（非线性放大），锚价被事件临时推动。
- **玩家冲击**：大额买卖会留下 `impact` 残留，按 0.93 每 tick 衰减 —— 你可以砸盘，也可以拉盘。
- **价格走廊**：锚价 ×0.18 ~ ×5.5（红色稀有度 0.45 ~ 2.4），永远不会无限涨跌。
- **事件系统**：29 种事件，覆盖饰品/算力/硬件/资产/宏观，以及单品的「大户扫货/砸盘」。
- **情绪**：由成分涨幅与成交活跃度合成 −1~1，影响波动放大与整体溢价。

### 8.2 抽奖

| 项目 | 数值 |
| --- | --- |
| 单抽 / 十连 / 百连 | ¥1,000 / 9 折 / 85 折 |
| 基础概率 | 白 60% · 绿 25% · 蓝 10% · 紫 3% · 金 1.5% · 红 0.5% |
| 软保底 | 连续 20 抽未出金后金/红概率逐级提升 |
| 硬保底 | 90 抽必出金或红 |
| 掉落数量 | 低价物品成批出货，品相越好数量越少 |
| 等级加成 | 每级 +1.1% 掉落数量（上限 +70%） |

界面同时公示**当前实时概率**与**长期统计概率**，两者都由代码实算，不会与实现不符。

### 8.3 交易

| 方式 | 特点 |
| --- | --- |
| 一口价买入 | 吃 NPC 卖盘，逐档成交、含价差与手续费 |
| 一口价卖出 | 按 NPC 买盘成交，价格优于回收商 |
| 回收商 | 瞬间成交，折价从 42% 起随等级与声望收窄 |
| 挂单卖/买 | 限价委托，每 tick 掷一次成交判定，可改价、撤单、过期退回 |
| 拍卖 | 倒计时竞价，NPC 按人格与预算自动加价，可一口价，佣金 5% |
| 熔炼 | 把垃圾库存换成材料，材料抵扣抽奖与扩容成本 |

**成交概率**由四要素决定：流动性、相对市价、市场动量、稀有度；界面会把概率直接显示给你。

### 8.4 NPC

6 种人格：保守 / 激进 / 囤货 / 割肉 / 庄家 / 散户。每个 NPC 有独立现金、库存、成本、品类偏好、风险偏好与周期重组节奏；18 位 NPC 共同构成挂单簿与拍卖买家。你的**等级**决定能看到的商人与挂单上限，**声望**直接影响报价。

### 8.5 时间与离线

- 1 tick = 6 游戏小时；速度档位：暂停 / 1× / 2× / 4× / 8×（1 秒 ≈ 6 小时 ~ 2 天）。
- 离线最多推进 **30 游戏天**；离线期间价格、事件、NPC 库存照常演化，但你的挂单**不会**逐 tick 结算（防止挂机刷单）。
- 所有随机都由 `seed` 驱动，同一种子能复现同一台「市场机器」。

---

## 9. 存档

| 层 | 内容 |
| --- | --- |
| localStorage | 最新快照缓存（冷启动秒读）+ 3 个存档位索引 + 设置 + 本地最佳记录 |
| IndexedDB | 完整快照 + 每件物品最多 180 天的 OHLC 历史 |

- 3 个存档位，可随时切换、删除。
- **导出 JSON / 导入 JSON**：换设备、备份都靠它。
- 每 30 秒与每个游戏日自动保存；关闭页面前再存一次。
- 快照带 FNV-1a 校验和，手改存档会被识别并提示（不会静默按错数据运行）。

---

## 10. 快捷键（桌面）

| 键 | 作用 |
| --- | --- |
| `空格` | 暂停 / 恢复 |
| `1`~`5` | 速度档位（暂停 / 1× / 2× / 4× / 8×） |
| `D` `B` `M` `O` `A` `R` `Q` `S` | 仪表盘 / 背包 / 市场 / 挂单 / 拍卖 / 记录 / 任务 / 设置 |
| `Esc` | 关闭弹窗 |

---

## 11. 设计与视觉规范

**只有黑白灰**：纯黑底、纯白字、灰阶层级；唯一允许的颜色是**物品自身的稀有度色条**（行业惯例），并以 3px 细条或文字标签呈现，绝不铺满卡片。

- Liquid Glass：`backdrop-filter: blur(20px) saturate(180%)` + 半透明卡片 + 细边框 + 内高光。
- 字体：系统栈（SF Pro / Segoe UI / PingFang SC），数字用等宽字体与 `tabular-nums`。
- 涨跌用 **↑↓ + 亮度**表达，不用红绿。
- 无渐变、无霓虹、无 emoji、无卡通圆角、无粒子特效；图标全部是 1.5px 描边 SVG 线条。
- 动效克制：页面切换 200ms 淡入位移、卡片 3D 翻转揭晓、数字插值滚动、按钮 `scale(.97)`；支持「关闭动效」与 `prefers-reduced-motion`。
- 响应式：375 / 430 / 768 / 1024 / 1280+ 五段；< 900px 用底部标签栏，≥ 900px 用侧边栏。

---

## 12. 数据维护

四张数据表由生成器维护（改数据改 `scripts/gen-catalog.mjs` 里的表，然后重新生成）：

```bash
npm run gen:catalog     # 重新生成 src/data/catalog-*.js（含重复 id/名称/价格/描述的校验）
npm run gen:seed        # 重新生成 data/prices.seed.json
npm run icons           # 重新生成图标
```

`data/prices.seed.json` 是「真实价锚」的抽出版本，`.github/workflows/prices.yml` 每周一自动刷新并提交，便于接入真实行情源后让锚价跟着走。

---

## 13. 工程约束（写给下一个接手的人）

- **不写后端、不写登录、不写账号系统**；不引入任何运行时 npm 依赖。
- 所有路径用**相对路径**，保证同时能在自定义域名根、`github.io/TML/` 子路径、`file://`（套壳）下工作。
- 代码分层清晰：`core`（引擎与状态）→ `systems`（玩法系统）→ `ui`（表现）。UI 只读状态、只发指令，不改引擎内部。
- 每个副作用都要可逆：定时器、监听器、图表绑定都要能解绑（见各 view 的 `onDestroy`）。
- 提交前跑 `npm run release`。

---

## 14. 免责声明

MONO 是一款**模拟经营游戏**。游戏内的商品名称、品牌与型号仅用于描述虚拟标的；所有价格、行情、事件与交易均为程序生成的模拟数据，与任何真实厂商、平台或市场无关，**不构成任何投资建议**。

MIT License © 2026 zhonglike
