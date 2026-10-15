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
      // 无论成功失败都转给 updater：成功才记 DISMISS，失败清 pending 以便下次重试。
      // 传 manual=true：让版本号旁的小字给出持久提示（toast 2.6 秒就没了）。
      try { if (HW.updater && HW.updater._onUpdateResult) HW.updater._onUpdateResult(!!ok, msg, '', true); } catch (e) { }
      if (ok) toast('更新完成，正在重启界面…', 'ok');
      else toast('更新失败：' + (msg || '未知原因') + '（下次打开会自动重试）', 'err');
    } else if (kind === 'share') {
      if (!ok && msg) toast(msg, 'err');
    }
  };

  /* ---------- 致命错误 → 通知原生回滚（热更包把页面搞崩时救场） ----------
   * 只在「启动确认前」上报：一旦 bootOk 已经告诉原生启动成功，后续任何运行时错误
   * （导出异常、第三方库抛错等）都与热更包无关，不能再去触发看门狗回滚，否则会把好版本换掉。 */
  var bootOkSent = false;
  window.addEventListener('error', function () {
    if (bootOkSent) return;
    try { if (android && android.bootFail) android.bootFail(); } catch (e) { }
  });

  /* ---------- 手机端内容折叠（手风琴）----------
   * 窄屏时把 .bind 里每个 section.step 的标题变成可点击的折叠头，
   * 默认全部收起，点标题展开；再点收起。桌面（>640px）不启用。 */
  function injectAccordion() {
    if (!android) return;
    var steps = document.querySelectorAll('.bind > section.step');
    Array.prototype.forEach.call(steps, function (sec) {
      var h = sec.querySelector(':scope > .step-h');
      if (!h || h._hwFold) return;
      h._hwFold = true;
      h.classList.add('collapsible');
      // 默认收起；「生成预览」按钮不在 step 里，不受影响
      sec.classList.add('collapsible-closed');
      h.addEventListener('click', function () {
        var closed = sec.classList.toggle('collapsible-closed');
        h.classList.toggle('open', !closed);
      });
    });
  }

  /* ---------- 导出区挪到侧栏最末 + 折叠 ----------
   * 手机上把「下载 PDF / 导出 PNG / 打印」从中间搬到侧栏最后，
   * 做成默认收起的手风琴块，标题「导出 / 打印」。桌面不动。 */
  function injectExportFold() {
    if (!android) return;
    var bind = document.querySelector('.bind');
    var grid = document.querySelector('.actions .grid2');
    var pdf = document.getElementById('btnPdf');
    if (!bind || !grid) return;
    var sec = document.createElement('section');
    sec.className = 'step';
    sec.style.marginTop = '14px';
    var h = document.createElement('h2');
    h.className = 'step-h collapsible open';
    h.innerHTML = '<i class="n">✦</i>导出 / 打印';
    var body = document.createElement('div');
    body.style.marginTop = '8px';
    if (pdf) body.appendChild(pdf);
    body.appendChild(grid);
    sec.appendChild(h);
    sec.appendChild(body);
    bind.appendChild(sec);
    h.addEventListener('click', function () {
      var closed = sec.classList.toggle('collapsible-closed');
      h.classList.toggle('open', !closed);
    });
    setTimeout(function () { h.click(); }, 0);   // 初始收起
  }

  /* ---------- 顶栏折叠 ----------
   * 顶部「手写作业生成器」一栏（徽章 + 统计信息）在手机上会遮挡内容，
   * 加一个折叠按键，默认收起，点一下展开/收起；状态记进 localStorage。 */
  function injectMastheadFold() {
    if (!android) return;
    var mh = document.querySelector('.masthead');
    if (!mh || mh._hwFold) return;
    mh._hwFold = true;
    var btn = document.createElement('button');
    btn.className = 'mast-fold';
    btn.type = 'button';
    btn.title = '折叠 / 展开顶部信息';
    btn.setAttribute('aria-label', '折叠或展开顶部信息');
    mh.insertBefore(btn, document.getElementById('btnTheme'));
    function apply() {
      var folded = true;   // 默认收起（挡内容）；用户展开过就记住
      try { folded = localStorage.getItem('hw_mast_fold') !== '0'; } catch (e) { }
      mh.classList.toggle('folded', folded);
      btn.classList.toggle('open', !folded);
    }
    btn.addEventListener('click', function () {
      var folded = mh.classList.toggle('folded');
      try { localStorage.setItem('hw_mast_fold', folded ? '1' : '0'); } catch (e) { }
      btn.classList.toggle('open', !folded);
    });
    apply();
  }

  /* ---------- 相机拍照：WebView 无视 <input capture>，必须走原生 ----------
   * 点「📷 相机拍照」→ HWAndroid.takePhoto() 拉系统相机 →
   * 原生回调 __hwCameraShot(dataURL) → 转 File 喂给 onCustomBg。 */
  function wireCamera() {
    if (!android || !android.takePhoto) return;
    var btn = document.getElementById('btnCustomCam');
    if (btn) {
      btn.onclick = function () { android.takePhoto(); };
    }
    window.__hwCameraShot = function (dataUrl) {
      // dataURL → File，走与相册上传完全相同的链路
      var bin = atob(dataUrl.split(',')[1]);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var file = new File([arr], '相机拍照.jpg', { type: 'image/jpeg' });
      if (typeof window.__hwOnCustomBg === 'function') window.__hwOnCustomBg(file);
    };
  }

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(wireCamera, 400);   // 等 app.js 绑完自定义纸张区
    setTimeout(injectShare, 0);
    setTimeout(injectAccordion, 0);
    setTimeout(injectExportFold, 0);
    setTimeout(injectMastheadFold, 0);
    // 首屏逻辑跑通 → 告诉原生「本次启动成功」，撤销看门狗回滚标记
    setTimeout(function () {
      bootOkSent = true;
      try { if (android && android.bootOk) android.bootOk(); } catch (e) { }
    }, 1200);
  });

  HW.mobile = { share: shareLast };
})();
