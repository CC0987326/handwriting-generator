/* ============================================================
 * 更新检查（js/updater.js）
 * 启动时静默查 GitHub 最新 Release，比当前版本新就提示/热更。
 *
 * 国内网络直连 GitHub（api.github.com / github.com）常被墙 →
 *   检查：直连 + 国内镜像「并发竞速」，谁先返回有效结果用谁。
 *   下载：先「探测竞速」挑出能连的镜像，再把镜像 URL 交给下载方。
 * 三版共用（浏览器 / WebView2 轻量版 / Electron / Android 外壳）：
 * 网络挂了、被限流、离线、镜像全挂，全都静默跳过，绝不打扰正常使用。
 * ------------------------------------------------------------ */
(function (root) {
  'use strict';
  var HW = root.HW = root.HW || {};

  var REPO = 'CC0987326/handwriting-generator';
  var API = 'https://api.github.com/repos/' + REPO + '/releases/latest';
  var PAGE = 'https://github.com/' + REPO + '/releases/latest';
  var DISMISS_KEY = 'hw_update_dismissed';
  var CHECK_KEY = 'hw_update_checked_at';   // 上次「成功」检查的时间戳
  var INTERVAL = 6 * 3600 * 1000;           // 6 小时内不重复查（GitHub 匿名 API 限流 60/h）

  // 国内可用镜像前缀。空串 '' = 直连（海外/有代理最快，放最后兜底）。
  // 免费镜像会变、会挂：多留几个；某个挂了在列表里删掉/换掉即可。
  var MIRRORS = [
    'https://gh-proxy.com/',
    'https://ghproxy.net/',
    'https://ghfast.top/',
    'https://gh.llkk.cc/',
    ''
  ];
  var PRIMARY_MIRROR = 'https://gh-proxy.com/';   // 探测全失败时的兜底前缀

  var ACCEPT = { 'Accept': 'application/vnd.github+json' };
  var CHECK_TIMEOUT = 9000;   // 每个检查源各自的超时（竞速，总耗时≈最快的那个）
  var PROBE_TIMEOUT = 8000;   // 每个下载源的探测超时

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

  // 把原始 GitHub 链接套上每个镜像前缀（含直连）
  function mirrorUrls(full) {
    var out = [];
    for (var i = 0; i < MIRRORS.length; i++) out.push(MIRRORS[i] + full);
    return out;
  }
  function isMirrored(url) {
    for (var i = 0; i < MIRRORS.length; i++) {
      if (MIRRORS[i] && url.indexOf(MIRRORS[i]) === 0) return true;
    }
    return false;
  }
  // 把 github 下载链接改写成镜像链接（已是镜像的不再套）
  function mirrorDownload(url) {
    if (!url) return url;
    if (isMirrored(url)) return url;
    return PRIMARY_MIRROR + url;
  }

  // 打开外链。返回是否已成功交给外部打开。
  // 注意：绝不 fallback 到 location.href —— 那会把正在编辑的界面整个导航走、丢失内容。
  function openExternal(url) {
    // Android 外壳：window.open 会被 WebView 拦，必须走原生 Intent 交给系统浏览器。
    if (window.HWAndroid && window.HWAndroid.openExternal) {
      try { window.HWAndroid.openExternal(url); return true; } catch (e) { }
    }
    // 浏览器/WebView2 弹新窗口；Electron 的 setWindowOpenHandler 会转 system browser。
    // noopener：防止被打开的远端页面（j.html_url 来自镜像数据）经 window.opener 反操作本页。
    try {
      var w = window.open(url, '_blank', 'noopener,noreferrer');
      if (w) return true;
    } catch (e) { }
    // 弹窗被拦：用临时 <a target=_blank> 再试一次（不导航走当前应用）
    try {
      var a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      document.body.appendChild(a); a.click(); a.remove();
      return true;
    } catch (e) { }
    return false;
  }

  // 并发竞速拉 JSON：直连 + 所有镜像同时发，谁先返回有效结果用谁，其余 abort。
  function fetchLatest() {
    return new Promise(function (resolve, reject) {
      if (typeof fetch !== 'function') { reject(new Error('no fetch')); return; }
      var urls = mirrorUrls(API);
      var pending = urls.length, settled = false, ctrls = [];
      function win(j) {
        if (settled) return; settled = true;
        ctrls.forEach(function (c) { try { c.abort(); } catch (e) { } });
        resolve(j);
      }
      function lose() {
        if (settled) return;
        if (--pending <= 0) { settled = true; reject(new Error('all sources failed')); }
      }
      urls.forEach(function (u) {
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        if (ctrl) ctrls.push(ctrl);
        var t = setTimeout(function () {
          if (ctrl) { try { ctrl.abort(); } catch (e) { } }   // abort → catch → lose()
          else lose();                                          // 无 AbortController：直接判负
        }, CHECK_TIMEOUT);
        fetch(u, { headers: ACCEPT, cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (j) { clearTimeout(t); if (j && (j.tag_name || j.name)) win(j); else lose(); })
          .catch(function () { clearTimeout(t); lose(); });
      });
    });
  }

  // 探测某个下载 URL 哪些镜像可连，竞速取最快。
  // 用 Range: bytes=0-0 只请求 1 字节（no-cors 读不到 status，但能建立连接即算通），
  // 避免此前对同一个 zip 并发发 5 路「整包下载」探测（白白耗流量、易被免费镜像限流）。
  // 返回 '' 表示全都探测失败（调用方不要再用「已知不可达」的前缀兜底）。
  function pickDownloadUrl(url) {
    return new Promise(function (resolve) {
      if (typeof fetch !== 'function') { resolve(url); return; }
      var urls = mirrorUrls(url);
      var pending = urls.length, settled = false, ctrls = [];
      function win(u) {
        if (settled) return; settled = true;
        ctrls.forEach(function (c) { try { c.abort(); } catch (e) { } });
        resolve(u);
      }
      function lose() {
        if (settled) return;
        if (--pending <= 0) { settled = true; resolve(''); }   // 全不通
      }
      urls.forEach(function (u) {
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        if (ctrl) ctrls.push(ctrl);
        var t = setTimeout(function () {
          if (ctrl) { try { ctrl.abort(); } catch (e) { } } else lose();
        }, PROBE_TIMEOUT);
        fetch(u, { method: 'GET', mode: 'no-cors', cache: 'no-store',
                   headers: { 'Range': 'bytes=0-0' }, signal: ctrl ? ctrl.signal : undefined })
          .then(function () { clearTimeout(t); win(u); })
          .catch(function () { clearTimeout(t); lose(); });
      });
    });
  }

  // 在 Release 的附件里挑出「网页热更包」（web-<ver>.zip）
  function assetUrl(j, matcher) {
    var arr = (j && j.assets) || [];
    for (var i = 0; i < arr.length; i++) {
      if (matcher(arr[i].name)) return arr[i].browser_download_url || '';
    }
    return '';
  }
  function webZipUrl(j) {
    var v = parseVer(j.tag_name || j.name);
    return v ? assetUrl(j, function (n) { return n.indexOf('web-' + v.join('.')) === 0 && /\.zip$/i.test(n); }) : '';
  }
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
    go.onclick = function () { if (openExternal(url)) { store(DISMISS_KEY, latest); box.remove(); } };
    var later = document.createElement('button');
    later.textContent = '以后再说';
    later.style.cssText = 'padding:8px 12px;border:1px solid #3a4256;border-radius:9px;cursor:pointer;' +
      'background:transparent;color:#aab2c4;font-size:13px';
    later.onclick = function () { store(DISMISS_KEY, latest); box.remove(); };
    row.appendChild(go); row.appendChild(later);
    box.appendChild(title); box.appendChild(body); box.appendChild(row);
    document.body.appendChild(box);
  }

  var pendingTag = '';   // 正在热更的目标 tag。**成功才写 DISMISS** —— 失败要能下次重试。
  var checking = false;

  // 界面提示（版本号按钮上的小字）。没这个元素（老页面）就静默跳过。
  function setNote(txt) {
    var el = document.getElementById('updateNote');
    if (el) el.textContent = txt || '';
  }

  function check(force) {
    var cur = HW.appVersion || '0.0.0';
    var cv = parseVer(cur);
    if (!cv) return;
    if (typeof fetch !== 'function') return;
    if (checking) return;                                  // 防手动连点重入
    // 节流：6 小时内「成功」查过就不再查（force 可强制，手动按钮/测试用）
    var last = +(stored(CHECK_KEY) || 0);
    if (!force && last && (Date.now() - last < INTERVAL)) return;
    if (force) setNote('检查中…');
    checking = true;
    // 注意：先不写时间戳。只在成功拿到数据后才写 —— 否则国内网络抽一次风就锁死 6 小时不再查。
    fetchLatest().then(function (j) {
      checking = false;
      store(CHECK_KEY, String(Date.now()));                // 成功才记，失败下次启动可重试
      var tag = j.tag_name || j.name;
      var lv = parseVer(tag);
      if (!lv || !gt(lv, cv)) { if (force) setNote('已是最新版 v' + cur.replace(/^v/i, '')); return; }   // 没有更新
      if (stored(DISMISS_KEY) === tag) { if (force) setNote('已忽略 ' + tag + '，点「重试」可再更新'); return; }

      // Android 外壳：网页改动能热更就不重装 —— 后台下载新网页包并切换；
      // 只有原生外壳本身需要升级、或没有热更包时，才回退到「下载新 APK」。
      var an = window.HWAndroid;
      if (an && an.installUpdate) {
        var zip = webZipUrl(j);
        if (zip) {
          // 关键：**绝不在这里写 DISMISS**。此前在这写 → 下载一旦失败（镜像超时/断流），
          // 此后每次启动都命中上面的 DISMISS 判断，永远静默跳过，用户再也收不到更新。
          pendingTag = tag;
          if (force) setNote('发现 ' + tag + '，正在后台更新…');
          pickDownloadUrl(zip).then(function (u) {
            try { an.installUpdate(u || zip, lv.join('.')); }
            catch (e) { pendingTag = ''; onUpdateResult(false, String(e), tag, !!force); }
          });
          return;
        }
        var apk = apkUrl(j);
        if (apk) {
          if (force) setNote('发现 ' + tag + '，请在浏览器里下载安装');
          // APK 下载走系统浏览器：探测能连的镜像，探测失败则用原始 GitHub 页（用户可自备代理）
          pickDownloadUrl(apk).then(function (u) { card(cur, tag, u || (j.html_url || PAGE)); });
          return;
        }
      }

      var url = j.html_url || PAGE;
      if (force) setNote('发现 ' + tag);
      card(cur, tag, url);
    }).catch(function () {
      checking = false;
      if (force) setNote('检查失败，请检查网络后重试');
      /* 全部源都失败：静默，且不写时间戳 → 下次启动重试 */
    });
  }

  /* 原生热更结果回调（mobile.js 的 __hwNativeCb 转发过来）。
   * 成功才记 DISMISS；失败一律清掉 pendingTag，保证下次打开还会再试。 */
  function onUpdateResult(ok, msg, tag, manual) {
    tag = tag || pendingTag;
    if (ok) { if (tag) store(DISMISS_KEY, tag); pendingTag = ''; if (manual) setNote('更新完成，重启生效'); }
    else { pendingTag = ''; if (manual) setNote('更新失败，可点重试'); }
  }

  /* 自愈：若记录的「已忽略/已更新」版本比当前跑的还新，说明那次热更其实没生效
   * （下载失败，或被看门狗回滚了），此时清掉记录，别让它永久挡住更新。 */
  function healDismiss() {
    var d = stored(DISMISS_KEY);
    if (!d) return;
    var dv = parseVer(d), cv = parseVer(HW.appVersion || '0.0.0');
    if (dv && cv && gt(dv, cv)) { try { localStorage.removeItem(DISMISS_KEY); } catch (e) { } }
  }

  /* 手动「检查更新」按钮：绕过 6 小时节流强制查一次。 */
  function bindCheckButton() {
    var btn = document.getElementById('btnCheckUpdate');
    var lbl = document.getElementById('verLabel');
    if (lbl) lbl.textContent = 'v' + String(HW.appVersion || '0.0.0').replace(/^v/i, '');
    healDismiss();
    if (!btn || btn._hwBound) return;
    btn._hwBound = true;
    btn.onclick = function () {
      // 若上一版被「以后再说」忽略过，手动点等于「重试」：清掉忽略记录
      try { localStorage.removeItem(DISMISS_KEY); } catch (e) { }
      setNote('检查中…');
      check(true);
    };
  }

  HW.updater = {
    check: check, bindCheckButton: bindCheckButton,
    _onUpdateResult: onUpdateResult,
    openExternal: openExternal, _mirrorDownload: mirrorDownload
  };
})(window);
