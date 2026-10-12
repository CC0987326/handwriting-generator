/* ============================================================
 * 手写作业生成器 · Electron 主进程
 * 开一个独立桌面窗口，直接加载本地的 index.html（file:// 语义）。
 * 渲染层与浏览器版完全一致：纯前端、无网络、无后端。
 * ============================================================ */
const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// 预览要读本地 file:// 图片、canvas 要能解码，关掉同源限制
app.commandLine.appendSwitch('allow-file-access-from-files');
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
// 本地离线应用，不需要 Chromium 的这套安全告警刷屏
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

let win = null;

// 每次导出的落盘目标（一次导出开始时设定，写文件时用）
let saveTarget = null;   // { kind:'file', path } | { kind:'dir', dir }

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
      preload: path.join(__dirname, 'preload.js'),
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
            message: '手写作业生成器 · v' + app.getVersion(),
            detail: '纯本地运行，文字不上传任何服务器，断网也能用。\n内置手写字体与实拍纸张，可自行增删纸张、导出高清 PNG / PDF。',
            buttons: ['好']
          })
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

// ============================================================
// 导出落盘：渲染层选路径 + 写文件，都走这里
// 单张 → 系统「另存为」；多张 → 系统「选择文件夹」。
// 绕开浏览器/WebView2 的「下载多个文件」权限拦截，且路径由用户定。
// ============================================================
function registerSaveIpc() {
  const extOf = (n) => (String(n).split('.').pop() || 'png').toLowerCase();
  const filtersOf = (name) => {
    const ext = extOf(name);
    if (ext === 'pdf') return [{ name: 'PDF 文件', extensions: ['pdf'] }];
    if (ext === 'jpg' || ext === 'jpeg') return [{ name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] }];
    return [{ name: 'PNG 图片', extensions: ['png'] }];
  };

  ipcMain.handle('hw:beginSave', async (e, count, firstName) => {
    const parent = BrowserWindow.fromWebContents(e.sender) || win;
    if (count > 1) {
      const r = await dialog.showOpenDialog(parent, {
        title: '选择保存位置（本次导出的 ' + count + ' 个文件都存这里）',
        buttonLabel: '保存到此文件夹',
        properties: ['openDirectory', 'createDirectory']
      });
      if (r.canceled || !r.filePaths[0]) return { ok: false };
      saveTarget = { kind: 'dir', dir: r.filePaths[0] };
      return { ok: true, label: r.filePaths[0] };
    }
    const base = path.basename(String(firstName || 'handwriting.png'));
    const r = await dialog.showSaveDialog(parent, {
      title: '保存文件',
      defaultPath: base,
      filters: filtersOf(base)
    });
    if (r.canceled || !r.filePath) return { ok: false };
    saveTarget = { kind: 'file', path: r.filePath };
    return { ok: true, label: r.filePath };
  });

  ipcMain.handle('hw:writeFile', async (e, name, bytes) => {
    if (!saveTarget) throw new Error('尚未选择保存位置');
    let target;
    if (saveTarget.kind === 'file') {
      target = saveTarget.path;                        // 单文件：就用用户定的这个名字
    } else {
      target = path.join(saveTarget.dir, path.basename(String(name || 'handwriting.png')));
    }
    await fs.promises.writeFile(target, Buffer.from(bytes));
    return { ok: true, path: target };
  });
}

app.whenReady().then(() => {
  registerSaveIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
