/* ============================================================
 * 手写作业生成器 · Electron 主进程
 * 开一个独立桌面窗口，直接加载本地的 index.html（file:// 语义）。
 * 渲染层与浏览器版完全一致：纯前端、无网络、无后端。
 * ============================================================ */
const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require('electron');
const path = require('path');

// 预览要读本地 file:// 图片、canvas 要能解码，关掉同源限制
app.commandLine.appendSwitch('allow-file-access-from-files');
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
// 本地离线应用，不需要 Chromium 的这套安全告警刷屏
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#e3ddcc',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    title: '手写作业生成器',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // 允许 file:// 页面把 canvas 导出成 PNG/PDF（toDataURL / toBlob 需要）
      webSecurity: false
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'index.html'));

  // 外链一律丢给系统浏览器，窗口本身只留在本地页面
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); shell.openExternal(url); }
  });

  win.on('closed', () => { win = null; });
}

// 极简菜单：只留「重载 / 开发者工具 / 缩放 / 关于」，没有多余项
function buildMenu() {
  const isDev = !app.isPackaged;
  const tpl = [
    {
      label: '文件',
      submenu: [
        { role: 'reload', label: '重新载入' },
        { role: 'forceReload', label: '强制重新载入' },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        ...(isDev ? [{ type: 'separator' }, { role: 'toggleDevTools', label: '开发者工具' }] : [])
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: () => dialog.showMessageBox(win, {
            type: 'info', title: '关于',
            message: '手写作业生成器',
            detail: '纯本地运行，文字不上传任何服务器，断网也能用。\n内置手写字体与实拍纸张，可自行增删纸张、导出高清 PNG / PDF。',
            buttons: ['好']
          })
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
