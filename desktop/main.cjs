/**
 * MONO — Windows / macOS / Linux 桌面外壳（Electron）
 * 把仓库根目录（也就是 GitHub Pages 的同一个根）直接装进窗口，
 * 因此网页版与桌面版是同一份代码，不存在两套逻辑。
 *
 *   cd desktop
 *   npm install         # 只装 electron（唯一依赖）
 *   npm start           # 本地运行
 *   npm run dist        # 打包 EXE / DMG / AppImage
 */
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const START = path.join(ROOT, 'index.html');

/** 单实例 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#000000',
    title: 'MONO',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  // 让 file:// 下的 ES module 正常工作
  win.loadFile(START);

  win.once('ready-to-show', () => win.show());

  // 外链走系统浏览器，不在游戏里开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 阻止误触的页面缩放导致的布局错乱（保留 Ctrl +/-）
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
    if (input.key === 'F12') {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });

  win.on('closed', () => {
    win = null;
  });
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.whenReady().then(() => {
  if (!fs.existsSync(START)) {
    dialog.showErrorBox('MONO 启动失败', `未找到 ${START}\n请确认 desktop 目录仍位于仓库根目录下。`);
    app.quit();
    return;
  }
  Menu.setApplicationMenu(null);
  createWindow();
});
