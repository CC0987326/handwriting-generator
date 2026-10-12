/* ============================================================
 * 更新检查（js/updater.js）
 * 启动时静默查 GitHub 最新 Release，比当前版本新就弹一张卡片提示，
 * 点「去下载」用系统浏览器打开 Release 页（A 方案：提醒 + 跳下载）。
 * 三版共用（浏览器 / WebView2 轻量版 / Electron）：网络挂了、被限流、
 * 离线，全都静默跳过，绝不打扰正常使用。
 * ------------------------------------------------------------ */
(function (root) {
  'use strict';
  var HW = root.HW = root.HW || {};

  var REPO = 'CC0987326/handwriting-generator';
  var API = 'https://api.github.com/repos/' + REPO + '/releases/latest';
  var PAGE = 'https://github.com/' + REPO + '/releases/latest';
  var DISMISS_KEY = 'hw_update_dismissed';
  var CHECK_KEY = 'hw_update_checked_at';   // 上次检查时间戳
  var INTERVAL = 6 * 3600 * 1000;           // 6 小时内不重复查（GitHub 匿名 API 限流 60/h）

  function parseVer(v) {
    var m = String(v || '').replace(/^v/i, '').match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!m) return null;
    return [+m[1], +(m[2] || 0), +(m[3] || 0)];
  }
  function gt(a, b) {   // a 是否比 b 新
    for (var i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); }
    return false;
  }
  function stored(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

  function openExternal(url) {
    // Android 外壳：window.open 会被 WebView 拦，退回 location.href 又会把界面本身导航走，
    // 必须走原生 Intent 交给系统浏览器。
    if (window.HWAndroid && window.HWAndroid.openExternal) {
      try { window.HWAndroid.openExternal(url); return; } catch (e) { }
    }
    // 浏览器/WebView2 弹新窗口；Electron 的 setWindowOpenHandler 会转 system browser
    try {
      var w = window.open(url, '_blank');
      if (w) return;
    } catch (e) { }
    try { location.href = url; } catch (e) { }
  }

  // 在 Release 的附件里挑出「网页热更包」（web-<ver>.zip）
  function assetUrl(j, matcher) {
    var arr = (j && j.assets) || [];
    for (var i = 0; i < arr.length; i++) {
      if (matcher(arr[i].name)) return arr[i].browser_download_url || '';
    }
    return '';
  }
  function webZipUrl(j) { var v = parseVer(j.tag_name || j.name); return v ? assetUrl(j, function (n) { return n.indexOf('web-' + v.join('.')) === 0 && /\.zip$/i.test(n); }) : ''; }
  function apkUrl(j) { return assetUrl(j, function (n) { return /\.apk$/i.test(n); }); }

  function card(cur, latest, url) {
    if (document.getElementById('hw-update-card')) return;
    var box = document.createElement('div');
    box.id = 'hw-update-card';
    box.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:9999;max-width:330px;' +
      'background:#1f2430;color:#f0f2f6;border:1px solid #3a4256;border-radius:14px;' +
      'box-shadow:0 12px 34px rgba(0,0,0,.38);padding:16px 16px 14px;font-size:13px;line-height:1.6;' +
      'font-family:inherit';
    var title = document.createElement('div');
    title.style.cssText = 'font-weight:700;font-size:15px;margin-bottom:6px';
    title.textContent = '发现新版本 ' + latest;
    var body = document.createElement('div');
    body.style.cssText = 'color:#c6ccd8;margin-bottom:12px';
    body.textContent = '你正在用 ' + cur + '，点下面按钮去下载 ' + latest + '（会是浏览器打开）。';
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px';
    var go = document.createElement('button');
    go.textContent = '去下载';
    go.style.cssText = 'flex:1;padding:8px 12px;border:0;border-radius:9px;cursor:pointer;' +
      'background:#4f7cff;color:#fff;font-weight:600;font-size:13px';
    go.onclick = function () { openExternal(url); store(DISMISS_KEY, latest); box.remove(); };
    var later = document.createElement('button');
    later.textContent = '以后再说';
    later.style.cssText = 'padding:8px 12px;border:1px solid #3a4256;border-radius:9px;cursor:pointer;' +
      'background:transparent;color:#aab2c4;font-size:13px';
    later.onclick = function () { store(DISMISS_KEY, latest); box.remove(); };
    row.appendChild(go); row.appendChild(later);
    box.appendChild(title); box.appendChild(body); box.appendChild(row);
    document.body.appendChild(box);
  }

  function check() {
    var cur = HW.appVersion || '0.0.0';
    var cv = parseVer(cur);
    if (!cv) return;
    if (typeof fetch !== 'function') return;
    // 节流：6 小时内查过就不再查（force=true 可强制，测试用）
    var last = +(stored(CHECK_KEY) || 0);
    if (!check.force && last && (Date.now() - last < INTERVAL)) return;
    store(CHECK_KEY, String(Date.now()));
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 9000);
    var opts = { headers: { 'Accept': 'application/vnd.github+json' }, cache: 'no-store' };
    if (ctrl) opts.signal = ctrl.signal;
    fetch(API, opts).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) return null;      // 404/403(限流) 等都静默
      return r.json();
    }).then(function (j) {
      if (!j) return;
      var lv = parseVer(j.tag_name || j.name);
      if (!lv || !gt(lv, cv)) return;                    // 没有更新
      if (stored(DISMISS_KEY) === (j.tag_name || j.name)) return;   // 这版已忽略过

      // Android 外壳：网页改动能热更就不重装 —— 直接后台下载新网页包并切换，
      // 只有原生外壳本身需要升级、或没有热更包时，才回退到「下载新 APK」。
      var an = window.HWAndroid;
      if (an && an.installUpdate) {
        var zip = webZipUrl(j);
        var needNative = j.requires_native;   // 约定：Release 正文可写 requires_native 字段（可选）
        if (zip) {
          store(DISMISS_KEY, j.tag_name || j.name);      // 热更静默进行，不再弹卡片
          try { an.installUpdate(zip, lv.join('.')); } catch (e) { }
          return;
        }
        if (apkUrl(j)) { card(cur, j.tag_name || j.name, apkUrl(j)); return; }
      }

      var url = j.html_url || PAGE;
      card(cur, j.tag_name || j.name, url);
    }).catch(function () { /* 离线/网络失败：静默 */ });
  }

  HW.updater = { check: check, openExternal: openExternal };
})(window);
