/* ============================================================
 * 手写作业生成器 · mobile.js
 * 手机端（Android 外壳）专用小逻辑：平台探测、分享按钮、原生回调。
 * 桌面三端（浏览器 / WebView2 / Electron）里 window.HWAndroid 不存在，
 * 本文件几乎全部跳过，不影响原行为。
 * ============================================================ */
(function () {
  var HW = (window.HW = window.HW || {});
  var android = window.HWAndroid;

  HW.platform = android ? 'android' : (HW.native && HW.native.kind === 'electron' ? 'electron'
    : (HW.native && HW.native.kind === 'webview2' ? 'webview2' : 'web'));

  function toast(msg, type) {
    // 复用页面里的 toast 元素（app.js 内的 toast 未导出，这里直接操作 DOM）
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show ' + (type || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.className = 'toast ' + (type || ''); }, 2600);
  }

  /* ---------- 分享：把上次导出的相册图片拉系统分享面板 ---------- */
  function shareLast() {
    if (!android || !android.shareImage) return;
    var uris = (HW.native && HW.native.lastUris) || [];
    if (!uris.length) { toast('先导出图片，再点分享', 'err'); return; }
    try { android.shareImage(JSON.stringify(uris)); } catch (e) { toast('分享失败：' + e, 'err'); }
  }

  /* ---------- 往导出区塞一个「分享」按钮（仅 Android） ---------- */
  function injectShare() {
    if (!android) return;
    if (document.getElementById('btnShare')) return;
    var box = document.querySelector('.actions .grid2') || document.querySelector('.actions');
    if (!box) return;
    var b = document.createElement('button');
    b.className = 'btn';
    b.id = 'btnShare';
    b.type = 'button';
    b.style.gridColumn = '1 / -1';
    b.title = '把刚导出的手写稿发送到微信 / QQ 等';
    b.textContent = '分享到…（微信 / QQ）';
    b.onclick = shareLast;
    box.appendChild(b);
  }

  /* ---------- 原生 → 网页 的异步回调 ----------
   * 目前只有在「热更新」等场景由 UpdateManager 调用，用来提示结果。 */
  window.__hwNativeCb = function (kind, ok, msg) {
    if (kind === 'update') {
      if (ok) toast('更新完成，正在重启界面…', 'ok');
      else toast('更新失败：' + (msg || '未知原因'), 'err');
    } else if (kind === 'share') {
      if (!ok && msg) toast(msg, 'err');
    }
  };

  /* ---------- 致命错误 → 通知原生回滚（热更包把页面搞崩时救场） ---------- */
  window.addEventListener('error', function () {
    try { if (android && android.bootFail) android.bootFail(); } catch (e) { }
  });

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(injectShare, 0);
    // 首屏逻辑跑通 → 告诉原生「本次启动成功」，撤销看门狗回滚标记
    setTimeout(function () { try { if (android && android.bootOk) android.bootOk(); } catch (e) { } }, 1200);
  });

  HW.mobile = { share: shareLast };
})();
