/* ============================================================
 * 手写作业生成器 · Electron preload
 * 只暴露一组「选路径 + 写文件」的极简 API 给渲染层，
 * 数据经主进程的 dialog + fs 落盘，不开放 Node 能力给页面。
 * ============================================================ */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hwNative', {
  // 1 张 → 弹「另存为」；多张 → 弹「选择文件夹」。返回 {ok, label} 或 {ok:false}
  beginSave: function (count, firstName) {
    return ipcRenderer.invoke('hw:beginSave', count, firstName);
  },
  // 把一帧写进上一步选定的目标
  writeFile: function (name, bytes) {
    return ipcRenderer.invoke('hw:writeFile', name, bytes);
  }
});
