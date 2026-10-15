/* ============================================================
 * 手写作业生成器 · 原生保存桥
 * 导出图片/PDF 时改走宿主原生的「另存为 / 选择文件夹」对话框，直接写盘，
 * 不再触发 WebView2 / 浏览器那个「此文件想要下载多个文件」的拦截，
 * 存到哪、叫什么名也交回给用户决定。
 *
 * 三种宿主各接一条通道，按可用性自动选：
 *   1) 轻量 exe 外壳（WebView2）：postMessage → C# 弹原生对话框写盘
 *   2) Electron：preload 暴露的 window.hwNative → 主进程 dialog + fs
 *   3) 纯浏览器：文件系统访问 API（showSaveFilePicker / showDirectoryPicker）
 *   兜底：都不支持时回退传统 <a download>（单文件不弹窗；多文件仍是浏览器默认行为）
 * ============================================================ */
(function () {
  var HW = (window.HW = window.HW || {});

  var wv = window.chrome && window.chrome.webview;                          // 轻量 exe 外壳
  var el = window.hwNative;                                                 // Electron preload
  var and = window.HWAndroid;                                               // Android 原生外壳
  var hasDirPick = typeof window.showDirectoryPicker === 'function';
  var hasFilePick = typeof window.showSaveFilePicker === 'function';

  /* ---------- 小工具 ---------- */
  function blobToB64(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { var s = fr.result, c = s.indexOf(','); res(c >= 0 ? s.slice(c + 1) : s); };
      fr.onerror = function () { rej(fr.error || new Error('读取失败')); };
      fr.readAsDataURL(blob);
    });
  }
  function blobToBytes(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(new Uint8Array(fr.result)); };
      fr.onerror = function () { rej(fr.error || new Error('读取失败')); };
      fr.readAsArrayBuffer(blob);
    });
  }
  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }
  function mimeFor(name) {
    var ext = (String(name).split('.').pop() || '').toLowerCase();
    return ext === 'pdf' ? 'application/pdf'
      : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : 'image/png';
  }

  /* ---------- 1) WebView2 外壳：字符串协议 ----------
   * 页面→宿主： "p\t<id>\t<张数>\t<首文件名>"   选目标（1 张弹保存框，多张弹选文件夹）
   *             "w\t<id>\t<文件名>\t<base64>"    写入一个文件
   * 宿主→页面： "ok\t<id>\t<路径或文件名>" / "no\t<id>" / "err\t<id>\t<原因>"
   * 用字符串 + 制表符分列，避开 JSON 序列化大块 base64 的开销。
   * 监听器仅在模块加载时注册一次、pending 表全模块共享：否则每次导出都叠一层监听器，
   * 长期使用会无限累积（且旧监听器会收到广播、闭包常驻）。 */
  var wvPending = {}, wvSeq = 0;
  if (wv && window.chrome && window.chrome.webview.addEventListener) {
    window.chrome.webview.addEventListener('message', function (ev) {
      var p = String(ev.data == null ? '' : ev.data).split('\t');
      var cb = wvPending[p[1]];
      if (cb) { delete wvPending[p[1]]; cb(p); }
    });
  }
  function wvRpc(type, args, timeoutMs) {           // args 数组，可省略
    var id = 'r' + (++wvSeq);
    var line = type + '\t' + id + (args && args.length ? '\t' + args.join('\t') : '');
    return new Promise(function (res, rej) {
      // 宿主不回消息（关框静默、base64 过大被丢）时不能永久悬着 —— 超时即报错复位 UI
      var to = setTimeout(function () {
        delete wvPending[id]; rej(new Error('宿主无响应（超时）'));
      }, timeoutMs || 60000);
      wvPending[id] = function (p) { clearTimeout(to); res(p); };
      try { window.chrome.webview.postMessage(line); }
      catch (e) { clearTimeout(to); delete wvPending[id]; rej(e); }
    });
  }
  function wvBackend() {
    return {
      begin: function (count, firstName) {
        return wvRpc('p', [String(count), firstName]).then(function (p) {
          if (p[0] !== 'ok') return null;            // no / err 一律当取消
          return { label: p[2] || '' };
        });
      },
      write: function (ctx, name, blob) {
        return blobToB64(blob).then(function (b64) {
          return wvRpc('w', [name, b64], 120000).then(function (p) {   // 大图写入给更宽超时
            if (p[0] !== 'ok') throw new Error(p[2] || '写入失败');
          });
        });
      },
      end: function () { }
    };
  }

  /* ---------- 2) Electron：preload 暴露的 window.hwNative ---------- */
  function elBackend() {
    return {
      begin: function (count, firstName) {
        return Promise.resolve(el.beginSave(count, firstName)).then(function (r) {
          return r && r.ok ? { label: r.label || '' } : null;
        });
      },
      write: function (ctx, name, blob) {
        return blobToBytes(blob).then(function (u8) { return el.writeFile(name, u8); });
      },
      end: function () { }
    };
  }

  /* ---------- 3) 纯浏览器：文件系统访问 API ---------- */
  function fsBackend() {
    var canFallback = true;                            // 该 API 在 file:// 下不可用时回退下载
    return {
      label: 'fsapi',
      canFallback: canFallback,
      begin: function (count, firstName) {
        if (count > 1) {
          return window.showDirectoryPicker({ id: 'hw-export', mode: 'readwrite' })
            .then(function (d) { return { dir: d, label: '文件夹「' + d.name + '」' }; });
        }
        var mime = mimeFor(firstName);
        return window.showSaveFilePicker({
          suggestedName: firstName,
          types: [{ description: '文件', accept: (function () { var o = {}; o[mime] = ['.' + (String(firstName).split('.').pop() || 'png')]; return o; })() }]
        }).then(function (h) { return { file: h, label: h.name }; });
      },
      write: function (ctx, name, blob) {
        var hp = ctx.dir ? ctx.dir.getFileHandle(name, { create: true }) : Promise.resolve(ctx.file);
        return hp.then(function (h) { return h.createWritable(); })
          .then(function (w) { return w.write(blob).then(function () { return w.close(); }); });
      },
      end: function () { }
    };
  }

  /* ---------- 3.5) Android 原生外壳：保存到相册 ----------
   * 页面→HWAndroid.saveImage(name, base64)：原生存进系统相册（Pictures/手写作业生成器），
   * 返回可达 content:// URI，便于随后「分享」。Android WebView 里 <a download> 基本无效，
   * 故这一支必须走原生。多张时逐张串行写，与原协议一致。 */
  function andBackend() {
    return {
      begin: function () { return Promise.resolve({ label: '手机相册（Pictures/手写作业生成器）' }); },
      write: function (ctx, name, blob) {
        return blobToB64(blob).then(function (b64) {
          var ret = and.saveImage(name, b64);
          var r = (typeof ret === 'string') ? JSON.parse(ret) : ret;
          if (r && r.ok) { (ctx.uris = ctx.uris || []).push(r.uri); return; }
          throw new Error((r && r.error) || '保存失败');
        });
      },
      end: function () { }
    };
  }

  /* ---------- 兜底：传统下载 ---------- */
  function dlBackend() {
    var last = 0;
    return {
      begin: function () { return Promise.resolve({ label: '浏览器下载文件夹' }); },
      write: function (ctx, name, blob) {
        // 多文件时给浏览器一点喘息，避免个别下载被丢
        var now = Date.now(), wait = Math.max(0, 260 - (now - last));
        last = now + wait;
        return new Promise(function (res) { setTimeout(function () { downloadBlob(blob, name); res(); }, wait); });
      },
      end: function () { }
    };
  }

  function backendFor() {
    if (wv) return wvBackend();
    if (el && el.beginSave) return elBackend();
    if (and && and.saveImage) return andBackend();
    if (hasDirPick || hasFilePick) return fsBackend();
    return dlBackend();
  }

  function run(backend, items, renderFn, onProgress, onCtx) {
    // begin 必须同步发起：浏览器「文件系统访问 API」要求选路径发生在用户点击手势内。
    var ctxP, ctxRef = null, began = false;
    try { ctxP = Promise.resolve(backend.begin(items.length, items[0].name)); }
    catch (e) { ctxP = Promise.reject(e); }
    return ctxP
      .then(function (ctx) {
        if (!ctx) return { canceled: true };
        ctxRef = ctx; began = true;
        var i = 0;
        function step() {
          if (i >= items.length) return { ok: true, label: ctx.label, count: items.length };
          var it = items[i];
          return Promise.resolve(renderFn(it, i)).then(function (blob) {
            return backend.write(ctx, it.name, blob).then(function () {
              i++;
              if (onProgress) { try { onProgress(i, items.length); } catch (e) { } }
              return step();
            });
          });
        }
        return step();
      })
      .then(function (r) { if (backend.end) { try { backend.end(); } catch (e) { } } return r; })
      .then(function (r) { if (onCtx && ctxRef) { try { onCtx(ctxRef); } catch (e) { } } return r; })
      .catch(function (err) { err._hwBegan = began; throw err; });   // 标记「是否已开始写」供兜底判断
  }

  HW.native = {
    kind: wv ? 'webview2'
      : (el && el.beginSave) ? 'electron'
      : (and && and.saveImage) ? 'android'
      : ((hasDirPick || hasFilePick) ? 'fsapi' : 'download'),
    // 最近一次导出落到的 content:// URI（Android 分支填，分享用）
    lastUris: [],

    /* 导出「非图片」文件（方案 .json）：
     *   Android —— <a download> 无效、saveImage 只能进相册，故走原生 saveFile 落下载目录。
     *   其余平台 —— 复用 exportAll 的原生「另存为」（已支持 json 过滤器），与图片导出同一套对话框。
     * 返回 Promise<{ok, label?, path?, error?}>。 */
    saveText: function (text, name, mime) {
      var blob = new Blob([text], { type: mime || 'application/json' });
      if (and && and.saveFile) {
        return blobToB64(blob).then(function (b64) {
          var ret = and.saveFile(name, b64);
          var r = (typeof ret === 'string') ? JSON.parse(ret) : ret;
          return r || { ok: false, error: '未知错误' };
        }).catch(function (e) { return { ok: false, error: (e && e.message) || String(e) }; });
      }
      return HW.native.exportAll([{ name: name }], function () { return blob; }).then(function (r) {
        if (r && r.error) return { ok: false, error: r.error };
        if (r && r.canceled) return { ok: false, canceled: true };
        return { ok: true, label: (r && r.label) || name };
      });
    },

    /* items: [{name}]；renderFn(item, idx) -> Promise<Blob>
     * 返回 {ok, label, count} | {canceled:true} | {error} */
    exportAll: function (items, renderFn, onProgress) {
      var b = backendFor();
      HW.native.lastUris = [];                 // 每次导出重置
      return run(b, items, renderFn, onProgress, function (ctx) {
        if (ctx && ctx.uris && ctx.uris.length) HW.native.lastUris = ctx.uris;
      }).catch(function (err) {
        var name = err && err.name;
        if (name === 'AbortError') return { canceled: true };
        // 文件系统访问 API 在 file:// 等场景不可用 → 静默回退传统下载。
        // 仅当「还没开始写任何文件」时回退：若已写到一半才失败，重跑会从第 0 张重导、与已落盘的部分重复。
        if (b.canFallback && !err._hwBegan && (name === 'SecurityError' || name === 'NotAllowedError' || name === 'TypeError')) {
          return run(dlBackend(), items, renderFn, onProgress).then(function (r) {
            r.fallback = true; return r;
          });
        }
        return { error: (err && err.message) || String(err) };
      });
    }
  };
})();
