/* ============================================================
 * 手写作业生成器 · app.js  界面与交互
 * 依赖 window.HW (catalog + rng + render)
 * ============================================================ */
(function () {
  'use strict';
  var HW = window.HW, CAT = HW.catalog, R = HW.render;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var cfg = Object.assign({}, CAT.DEFAULTS);
  var customImage = null;   // 自定义背景 Image（当前选中的那张）

  /* ---------------- 纸张增删存 ---------------- */
  // 用户对内置纸张的增删记录；启动时套用到 CAT.PAPERS 上
  var paperStore = { removed: [], custom: [] };
  var customImages = {};    // id -> Image（当前会话内已解码的自定义纸张底图）
  var moreOpen = false;     // 「更多纸张」是否展开

  function loadPaperStore() {
    try {
      var raw = localStorage.getItem(CAT.USER_PAPER_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o === 'object') {
          paperStore.removed = Array.isArray(o.removed) ? o.removed : [];
          paperStore.custom = Array.isArray(o.custom) ? o.custom : [];
        }
      }
    } catch (e) { paperStore = { removed: [], custom: [] }; }
  }
  // 只持久化纸张的「数据字段」，剥掉 user/removable/builtin 这些运行期标记
  function storeJSON() {
    var custom = paperStore.custom.map(function (p) {
      return { dataUrl: p.dataUrl, id: p.id, name: p.name, kind: 'custom', uploaded: !!p.uploaded,
        page: p.page, orientation: p.orientation, margins: p.margins, style: p.style };
    });
    return JSON.stringify({ removed: paperStore.removed, custom: custom });
  }
  function savePaperStore() {
    try { localStorage.setItem(CAT.USER_PAPER_KEY, storeJSON()); }
    catch (e) { toast('纸张删除记录存不进本地（可能空间已满）', 'err'); }
  }
  // 把增删套到 CAT.PAPERS：始终从原始内置表重建，避免重复添加
  var BASE_PAPERS = null;
  function applyPaperStore() {
    if (!BASE_PAPERS) BASE_PAPERS = CAT.PAPERS.slice();   // 首次调用前先留一份内置表
    var keep = BASE_PAPERS.filter(function (p) {
      return p.id !== 'custom' && paperStore.removed.indexOf(p.id) < 0;
    });
    keep.forEach(function (p) { p.builtin = true; p.removable = true; });   // 内置纸：可删，删了能加回
    paperStore.custom.forEach(function (p) { p.user = true; p.removable = true; keep.push(p); });
    var self = BASE_PAPERS.filter(function (p) { return p.id === 'custom'; })[0];
    if (self) keep.push(self);   // 末尾保留「自定义背景(上传图片)」作为添加入口
    CAT.PAPERS.length = 0;
    Array.prototype.push.apply(CAT.PAPERS, keep);
  }
  var lastLayout = null;    // 最近一次排版结果
  var lastPages = [];       // 预览 canvas 列表
  var previewDpi = 130;
  var busy = false;
  var lineEdit = false;     // 微调模式（开/关）
  var dragMode = 'line';    // 'line' = 逐行拖动；'block' = 整篇拖动
  var overlays = [];        // 每页的微调覆盖层
  var dragging = null;      // 正在拖动的对象
  var selLines = [];        // 多选的行：{pi, key}
  var marquee = null;       // 框选矩形（CSS 像素，相对当前覆盖层）

  function selIndex(pi, key) {
    for (var i = 0; i < selLines.length; i++) if (selLines[i].pi === pi && selLines[i].key === key) return i;
    return -1;
  }
  function isSelected(pi, key) { return selIndex(pi, key) >= 0; }
  function toggleSel(pi, key) {
    var i = selIndex(pi, key);
    if (i >= 0) selLines.splice(i, 1); else selLines.push({ pi: pi, key: key });
  }
  function clearSel() { selLines = []; }
  function findLine(page, key) {
    var ls = linesOfPage(page);
    for (var i = 0; i < ls.length; i++) if (ls[i].key === key) return ls[i];
    return null;
  }

  /* ---------------- 逐行微调：命中 / 覆盖层 ---------------- */
  // 把一页的 token 按「行」聚合（key = line）
  function linesOfPage(page) {
    var lines = [];
    for (var i = 0; i < page.tokens.length; i++) {
      var t = page.tokens[i];
      if (t.rawX === undefined) continue;
      var key = (t.line === undefined ? 'x' : t.line);
      var L = null;
      for (var j = 0; j < lines.length; j++) if (lines[j].key === key) { L = lines[j]; break; }
      if (!L) { L = { key: key, tokens: [] }; lines.push(L); }
      L.tokens.push(t);
    }
    return lines;
  }
  // 计算「当前屏幕上」文字的实际位置（行偏移 + 整篇全局偏移），供框选与命中用
  function lineBBox(L) {
    var gx = (cfg.textOffset && cfg.textOffset.dx) || 0;
    var gy = (cfg.textOffset && cfg.textOffset.dy) || 0;
    var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (var i = 0; i < L.tokens.length; i++) {
      var t = L.tokens[i], s = t.size || 8.3;
      var aw = t.rawAdv || s;   // 含逐字间距的真实推进量（flow 模式）；格纸回落到字号
      var bx = t.rawX + (t.offDx || 0) + gx, by = t.rawY + (t.offDy || 0) + gy;
      x0 = Math.min(x0, bx - aw * 0.5); x1 = Math.max(x1, bx + aw * 0.5);
      y0 = Math.min(y0, by - s * 0.78); y1 = Math.max(y1, by + s * 0.30);
    }
    return { x0: x0, x1: x1, y0: y0, y1: y1 };
  }
  // 整页所有 token 的包围盒（供「整篇拖动」用）
  function pageBBox(page) {
    var all = page.tokens.filter(function (t) { return t.rawX !== undefined; });
    if (!all.length) return null;
    return lineBBox({ tokens: all });
  }
  function lineOffset(L) {
    var t = L.tokens[0];
    return { dx: (t && t.offDx) || 0, dy: (t && t.offDy) || 0 };
  }
  function setLineOffset(L, dx, dy) {
    for (var i = 0; i < L.tokens.length; i++) { L.tokens[i].offDx = dx; L.tokens[i].offDy = dy; }
  }
  // 命中：给定某个浏览页 canvas 内的 CSS 坐标，返回命中的行 { pi(源页), key }（无命中返回 null）。
  // 被拖到别页的行也能在本页命中（按 (源页-浏览页)*页高 平移后判断）。
  function hitLine(cx, cy, cssW, viewPi) {
    if (!lastLayout) return null;
    var area = (lastLayout.pages[viewPi].area) || lastLayout.area;
    if (!area || cssW <= 0) return null;
    var mmPerPx = area.pageW / cssW;
    var mx = cx * mmPerPx, my = cy * mmPerPx;
    var pageH = area.pageH, best = null, bestD = 1e9;
    for (var sp = 0; sp < lastLayout.pages.length; sp++) {
      var shift = (sp - viewPi) * pageH;
      var lines = linesOfPage(lastLayout.pages[sp]);
      for (var i = 0; i < lines.length; i++) {
        var b = lineBBox(lines[i]);
        var y0 = b.y0 + shift, y1 = b.y1 + shift;
        if (mx < b.x0 - 1.5 || mx > b.x1 + 1.5 || my < y0 - 1.5 || my > y1 + 1.5) continue;
        var mid = (y0 + y1) / 2, d = Math.abs(my - mid);
        if (d < bestD) { bestD = d; best = { pi: sp, key: lines[i].key }; }
      }
    }
    return best;
  }
  // 重画某页的微调覆盖层（每行一个虚线框）。本页的行照旧，别页被拖进本页的行也画出框。
  function drawLineHighlights(pi) {
    var ov = overlays[pi];
    if (!ov) return;
    ov.innerHTML = '';
    if (!lineEdit || !lastLayout) return;
    var page = lastLayout.pages[pi];
    var area = page.area || lastLayout.area;
    var w = ov.clientWidth;
    if (!w) { requestAnimationFrame(function () { drawLineHighlights(pi); }); return; }
    var pxPerMm = w / area.pageW;
    var pageH = area.pageH;
    function mk(b, cls) {
      var el = document.createElement('div');
      el.className = 'line-box' + (cls ? ' ' + cls : '');
      el.style.left = (b.x0 * pxPerMm) + 'px';
      el.style.top = (b.y0 * pxPerMm) + 'px';
      el.style.width = ((b.x1 - b.x0) * pxPerMm) + 'px';
      el.style.height = ((b.y1 - b.y0) * pxPerMm) + 'px';
      return el;
    }

    if (dragMode === 'block') {
      var pb = pageBBox(page);
      if (pb) ov.appendChild(mk(pb, 'block'));
      return;
    }
    for (var sp = 0; sp < lastLayout.pages.length; sp++) {
      var shift = (sp - pi) * pageH;      // 源页的行平移到本页坐标
      var lines = linesOfPage(lastLayout.pages[sp]);
      for (var i = 0; i < lines.length; i++) {
        var b = lineBBox(lines[i]);
        var y0 = b.y0 + shift, y1 = b.y1 + shift;
        if (y1 < 0 || y0 > pageH) continue;   // 不在本页画布内
        ov.appendChild(mk({ x0: b.x0, x1: b.x1, y0: y0, y1: y1 }, isSelected(sp, lines[i].key) ? 'sel' : 'dim'));
      }
    }
  }
  // 更新多选（切换或清空）后重画（不重新渲染画布，只用框标记，位置不变）
  function refreshSel() {
    for (var i = 0; i < lastPages.length; i++) drawLineHighlights(i);
    var b = $('#btnClearSel');
    if (b) b.textContent = selLines.length ? ('清空选择(' + selLines.length + ')') : '清空选择';
  }
  // 预渲染缓存：每页「纸 + 每行字」的位图。拖动时每帧只做十几次 drawImage（几十上百字也满帧），
  // 建缓存的代价一次性付掉。签名变化（换字体/纸/墨色/抖动…）才重建。
  var pageCaches = [], lastCacheSig = '';
  function cacheSig() {
    var c = renderCfg();
    return [lastLayout ? lastLayout.seed : '', previewDpi, c.familyCn, c.familyEn, c.inkColor,
      c.inkJitter, c.inkPressure, c.inkTexture, c.bold, c.mistakeRate, c.messyRatio, c.charRandom,
      c.weightCn, c.weightEn, c.pageNumber, c.customImage ? (c.customImage.width + 'x' + c.customImage.height) : ''
    ].join('|');
  }
  function pageCache(pi) {
    var sig = cacheSig();
    if (sig !== lastCacheSig) { pageCaches = []; lastCacheSig = sig; }
    if (!pageCaches[pi]) pageCaches[pi] = R.buildPageCache(lastLayout, pi, renderCfg(), previewDpi);
    return pageCaches[pi];
  }
  // 取「任意页」的缓存（跨页绘制时用：把拖到别的页的行也画出来）
  function cacheFor(pi) { return pageCache(pi); }

  /* ---------------- 撤回 / 重做（前后各 10 步） ----------------
   * 快照只存「调整状态」：整篇偏移 textOffset + 各行偏移。锚点用 token 原始坐标(rawX/rawY)，
   * 因为行重排后 line key 会变，原始坐标才稳。undo 栈任意时刻 ≤10、redo 栈 ≤10。 */
  var undoStack = [], redoStack = [], UNDO_MAX = 10;
  function snapAdj() {
    var rows = [];
    if (lastLayout) {
      for (var p = 0; p < lastLayout.pages.length; p++) {
        var toks = lastLayout.pages[p].tokens;
        for (var i = 0; i < toks.length; i++) {
          var t = toks[i];
          if (t.offDx || t.offDy) rows.push([p, +(t.rawX || 0).toFixed(3), +(t.rawY || 0).toFixed(3), +(t.offDx || 0).toFixed(3), +(t.offDy || 0).toFixed(3)]);
        }
      }
    }
    return { off: { dx: (cfg.textOffset && cfg.textOffset.dx) || 0, dy: (cfg.textOffset && cfg.textOffset.dy) || 0 }, rows: rows };
  }
  function applyAdj(s) {
    if (!lastLayout) return;
    cfg.textOffset = { dx: s.off.dx, dy: s.off.dy };
    for (var p = 0; p < lastLayout.pages.length; p++) {
      var toks = lastLayout.pages[p].tokens;
      for (var i = 0; i < toks.length; i++) { toks[i].offDx = 0; toks[i].offDy = 0; }
    }
    for (var r = 0; r < s.rows.length; r++) {
      var row = s.rows[r], page = lastLayout.pages[row[0]];
      if (!page) continue;
      var toks2 = page.tokens, best = null, bestD = 1e9;
      for (var j = 0; j < toks2.length; j++) {
        var t = toks2[j];
        var d = Math.abs(t.rawX - row[1]) + Math.abs(t.rawY - row[2]);
        if (d < bestD) { bestD = d; best = t; }
      }
      if (best) { best.offDx = row[3]; best.offDy = row[4]; }
    }
    refreshCacheAfterAdj();
  }
  function pushUndo() {   // 在“将要改变位置”的操作之前调用
    if (!lastLayout) return;
    undoStack.push(snapAdj());
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack = [];
    syncUndoUI();
  }
  // 拖动：只有真正移动了才把「按下时的快照」记一步（单击选中/取消 不记，避免空步挤掉历史）
  function dragCommit(dg) {
    if (!dg || dg.moved) return;
    dg.moved = true;
    undoStack.push(dg.snap);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack = [];
    syncUndoUI();
  }
  function applyAdjEdit(fn) { fn(); refreshCacheAfterAdj(); }   // 一次性调整（复位等）后重画
  // 调整位置后：缓存里的「纸」不受影响（纸不含字），只需重画（缓存 blit 即可）
  function refreshCacheAfterAdj() {
    for (var i = 0; i < lastPages.length; i++) {
      var cv = lastPages[i]; if (!cv) continue;
      R.renderWithCache(cv, lastLayout, i, renderCfg(), previewDpi, pageCache(i), cacheFor);
      drawLineHighlights(i);
    }
  }
  function undo() {
    if (!undoStack.length) { toast('没有可撤回的调整', 'err'); return; }
    redoStack.push(snapAdj());
    if (redoStack.length > UNDO_MAX) redoStack.shift();
    applyAdj(undoStack.pop());
    syncUndoUI();
  }
  function redo() {
    if (!redoStack.length) { toast('没有可重做的调整', 'err'); return; }
    undoStack.push(snapAdj());
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    applyAdj(redoStack.pop());
    syncUndoUI();
  }
  function syncUndoUI() {
    var u = $('#btnUndoAdj'), r = $('#btnRedoAdj');
    if (u) { u.disabled = !undoStack.length; u.style.opacity = undoStack.length ? '' : '.4'; }
    if (r) { r.disabled = !redoStack.length; r.style.opacity = redoStack.length ? '' : '.4'; }
  }

  // 拖动高频重绘：用缓存渲染（纸 blit 一次 + 每行 blit 一次），不再每帧重画全部字。
  // 跨页拖动时源页的行移走了、目标页要显示移入的行 → 所有页都得刷（都走缓存，仍是每页十几次 drawImage）。
  var _dragRaf = 0, _dragPage = null;
  function queueDragRedraw(pi) {
    if (pi !== undefined) _dragPage = pi;
    if (_dragRaf) return;
    _dragRaf = requestAnimationFrame(function () {
      _dragRaf = 0;
      if (!lastLayout) return;
      _dragPage = null;
      for (var i = 0; i < lastPages.length; i++) {
        var cv = lastPages[i]; if (!cv) continue;
        R.renderWithCache(cv, lastLayout, i, renderCfg(), previewDpi, pageCache(i), cacheFor);   // 缓存 blit，不叠行框
      }
    });
  }
  function endDragRedraw() {   // 松手：补一帧 + 行高亮
    if (_dragRaf) { cancelAnimationFrame(_dragRaf); _dragRaf = 0; }
    redrawAll();
  }
  // 多选整体拖动：所有选中行一起位移
  function dragSelTo(dx, dy) {
    for (var s = 0; s < selLines.length; s++) {
      var L = findLine(lastLayout.pages[selLines[s].pi], selLines[s].key);
      if (L) setLineOffset(L, dx, dy);
    }
  }
  // 微调改动会影响所有页（整篇拖动 / hoist 归一），统一重画全部预览页
  function redrawAll() {
    if (!lastLayout) return;
    for (var i = 0; i < lastPages.length; i++) redrawPreview(i);
  }
  function redrawPreview(pi) {
    var cv = lastPages[pi];
    if (!cv) return;
    R.renderWithCache(cv, lastLayout, pi, renderCfg(), previewDpi, pageCache(pi), cacheFor);   // 预览统一走缓存（快且与拖动一致）
    drawLineHighlights(pi);
  }
  function syncEditUI() {
    var b = $('#btnLineEdit');
    if (b) {
      b.classList.toggle('on', lineEdit);
      b.setAttribute('aria-pressed', lineEdit ? 'true' : 'false');
      b.textContent = lineEdit ? '微调中 · 点击退出' : '逐行微调';
    }
    var mb = $('#btnModeLine'), bb = $('#btnModeBlock');
    if (mb) mb.classList.toggle('on', dragMode === 'line');
    if (bb) bb.classList.toggle('on', dragMode === 'block');
    var mb2 = $('#modeLineEdit');
    if (mb2) mb2.style.display = lineEdit ? 'inline-flex' : 'none';
  }
  function setLineEdit(on) {
    lineEdit = !!on;
    if (!lineEdit) clearSel();
    document.body.classList.toggle('line-edit', lineEdit);
    syncEditUI();
    for (var i = 0; i < lastPages.length; i++) drawLineHighlights(i);
    refreshSel();
    if (lineEdit) toast(dragMode === 'block'
      ? '拖动整篇文字：所有页一起移动'
      : '拖动一行调整位置，可拖到上一页/下一页；点一下行框可多选，或空白处框选，多选后一起拖', 'ok');
  }
  function setDragMode(m) {
    dragMode = m === 'block' ? 'block' : 'line';
    clearSel();
    syncEditUI();
    for (var i = 0; i < lastPages.length; i++) drawLineHighlights(i);
    refreshSel();
  }
  function resetAdj() {
    pushUndo();   // 复位也进历史，可撤回
    cfg.textOffset = { dx: 0, dy: 0 };
    if (lastLayout) {
      for (var p = 0; p < lastLayout.pages.length; p++) {
        var toks = lastLayout.pages[p].tokens;
        for (var i = 0; i < toks.length; i++) { toks[i].offDx = 0; toks[i].offDy = 0; }
      }
    }
    redrawAll();
    refreshSel();
    toast('已复位全部微调', 'ok');
  }
  // 按下某个已选中的行 → 整组一起拖动；否则按下未选中行 → 直接单行拖动
  function startSelDrag(viewPi, hit, e, rect) {
    var page = lastLayout.pages[viewPi];
    var area = page.area || lastLayout.area;
    dragging = { kind: 'sel', pi: viewPi, srcPi: hit.pi, key: hit.key, startX: e.clientX, startY: e.clientY, mmPerPx: area.pageW / rect.width, sx: {}, moved: false, snap: snapAdj() };
    for (var j = 0; j < selLines.length; j++) {
      var L = findLine(lastLayout.pages[selLines[j].pi], selLines[j].key);
      if (!L) continue;
      dragging.sx[selLines[j].pi + ':' + selLines[j].key] = lineOffset(L);
    }
  }
  // 把一页画布的拖动事件绑到「行」或「整篇」上
  function bindDrag(cv, pi) {
    cv.addEventListener('pointerdown', function (e) {
      if (!lineEdit || !lastLayout) return;
      var rect = cv.getBoundingClientRect();
      var page = lastLayout.pages[pi];
      var area = page.area || lastLayout.area;
      var mmPerPx = area.pageW / rect.width;
      var cx = e.clientX - rect.left, cy = e.clientY - rect.top;

      if (dragMode === 'block') {
        var pb = pageBBox(page);
        if (!pb) return;
        var mx = cx * mmPerPx, my = cy * mmPerPx;
        if (mx < pb.x0 - 4 || mx > pb.x1 + 4 || my < pb.y0 - 4 || my > pb.y1 + 4) return;
        dragging = {
          kind: 'block', pi: pi, startX: e.clientX, startY: e.clientY, mmPerPx: mmPerPx,
          baseDx: (cfg.textOffset && cfg.textOffset.dx) || 0,
          baseDy: (cfg.textOffset && cfg.textOffset.dy) || 0,
          snap: snapAdj(), moved: false
        };
      } else {
        var hit = hitLine(cx, cy, rect.width, pi);
        if (hit === null) {
          // 空白处按下 → 开始框选（按住 Shift = 追加选择）
          marquee = { pi: pi, x0: cx, y0: cy, x1: cx, y1: cy, w: rect.width, add: !!e.shiftKey };
          try { cv.setPointerCapture(e.pointerId); } catch (err) { }
          e.preventDefault();
          return;
        }
        if (isSelected(hit.pi, hit.key)) { startSelDrag(pi, hit, e, rect); }
        else {
          var L = findLine(lastLayout.pages[hit.pi], hit.key);
          if (!L) return;
          var o = lineOffset(L);
          dragging = {
            kind: 'line', pi: pi, srcPi: hit.pi, L: L, key: hit.key, startX: e.clientX, startY: e.clientY,
            mmPerPx: mmPerPx, baseDx: o.dx, baseDy: o.dy, moved: false, snap: snapAdj()
          };
        }
      }
      try { cv.setPointerCapture(e.pointerId); } catch (err) { }
      cv.classList.add('dragging');
      e.preventDefault();
    });
    cv.addEventListener('pointermove', function (e) {
      if (marquee && marquee.pi === pi) {
        var r = cv.getBoundingClientRect();
        marquee.x1 = e.clientX - r.left; marquee.y1 = e.clientY - r.top;
        showMarquee(pi);
        return;
      }
      if (!dragging || dragging.pi !== pi) return;
      // 移动阈值：<3px 视作点击（用于选行），不触发位移、也不记历史
      if (!dragging.moved) {
        var mdx = e.clientX - dragging.startX, mdy = e.clientY - dragging.startY;
        if (mdx * mdx + mdy * mdy < 9) return;
      }
      dragCommit(dragging);   // 首次真实移动才记一步
      var dx = dragging.baseDx + (e.clientX - dragging.startX) * dragging.mmPerPx;
      var dy = dragging.baseDy + (e.clientY - dragging.startY) * dragging.mmPerPx;
      if (dragging.kind === 'block') {
        cfg.textOffset = { dx: dx, dy: dy };
        queueDragRedraw();
      } else if (dragging.kind === 'sel') {
        for (var j = 0; j < selLines.length; j++) {
          var k = selLines[j].pi + ':' + selLines[j].key;
          var L = findLine(lastLayout.pages[selLines[j].pi], selLines[j].key);
          var s0 = dragging.sx[k];
          if (L && s0) setLineOffset(L, s0.dx + (e.clientX - dragging.startX) * dragging.mmPerPx, s0.dy + (e.clientY - dragging.startY) * dragging.mmPerPx);
        }
        queueDragRedraw();   // 多选也可能被拖到别页 → 所有页一起刷
      } else {
        dragging.moved = true;
        setLineOffset(dragging.L, dx, dy);
        queueDragRedraw(pi);
      }
    });
    function up(e) {
      if (marquee && marquee.pi === pi) {
        finishMarquee(pi);
        marquee = null; cv.classList.remove('dragging');
        try { cv.releasePointerCapture(e.pointerId); } catch (err) { }
        return;
      }
      if (!dragging || dragging.pi !== pi) return;
      var wasLine = dragging.kind === 'line' && !dragging.moved;
      var linePi = wasLine ? dragging.srcPi : pi;
      var lineKey = wasLine ? dragging.key : null;
      var wasSel = dragging.kind === 'sel' && !dragging.moved;
      var selPi = wasSel ? dragging.srcPi : pi;
      var selKey = wasSel ? dragging.key : null;
      dragging = null; cv.classList.remove('dragging');
      endDragRedraw();   // 松手：补一帧全质量（拖动中是快速稿）+ 重建行高亮
      try { cv.releasePointerCapture(e.pointerId); } catch (err) { }
      // 单击未选中的行 → 加入多选（不拖动位置）
      if (wasLine) { toggleSel(linePi, lineKey); refreshSel(); }
      // 单击已选中的行（没拖动）→ 取消该行选中
      else if (wasSel) { toggleSel(selPi, selKey); refreshSel(); }
    }
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
  }
  // 框选：实时显示矩形
  function showMarquee(pi) {
    var ov = overlays[pi];
    if (!ov || !marquee) return;
    var el = ov.querySelector('.marquee');
    if (!el) { el = document.createElement('div'); el.className = 'marquee'; ov.appendChild(el); }
    var x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1);
    var w = Math.abs(marquee.x1 - marquee.x0), h = Math.abs(marquee.y1 - marquee.y0);
    el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.width = w + 'px'; el.style.height = h + 'px';
  }
  // 框选结束：与矩形相交的行批量选中（按住 Shift 为追加）
  function finishMarquee(pi) {
    if (!marquee) return;
    var x0 = Math.min(marquee.x0, marquee.x1), x1 = Math.max(marquee.x0, marquee.x1);
    var y0 = Math.min(marquee.y0, marquee.y1), y1 = Math.max(marquee.y0, marquee.y1);
    if (x1 - x0 < 4 && y1 - y0 < 4) { refreshSel(); return; } // 空白处轻点 = 清空选择
    if (!marquee.add) clearSel();
    var page = lastLayout.pages[pi], area = page.area || lastLayout.area;
    var mmPerPx = area.pageW / marquee.w, pageH = area.pageH;
    var selM = { x0: x0 * mmPerPx, x1: x1 * mmPerPx, y0: y0 * mmPerPx, y1: y1 * mmPerPx };
    // 扫所有源页：本页的行 + 被拖进本页的别页行（按 (源页-本页)*页高 平移后判断）
    for (var sp = 0; sp < lastLayout.pages.length; sp++) {
      var shift = (sp - pi) * pageH;
      var lines = linesOfPage(lastLayout.pages[sp]);
      for (var i = 0; i < lines.length; i++) {
        var bb = lineBBox(lines[i]);
        var by0 = bb.y0 + shift, by1 = bb.y1 + shift;
        if (bb.x1 < selM.x0 || bb.x0 > selM.x1 || by1 < selM.y0 || by0 > selM.y1) continue;
        if (!isSelected(sp, lines[i].key)) selLines.push({ pi: sp, key: lines[i].key });
      }
    }
    refreshSel();
  }

  /* ---------------- 暗夜 / 白天模式 ---------------- */
  // 尽早应用，避免刷新时先亮后暗的闪动。主题只影响界面，不影响导出（导出仍是白纸黑字）。
  (function theme() {
    var KEY = 'hw_theme';
    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) { }
    if (!saved) saved = 'light';
    function apply(t) {
      document.documentElement.setAttribute('data-theme', t);
      var lbl = document.getElementById('btnThemeLbl');
      var btn = document.getElementById('btnTheme');
      var dark = t === 'dark';
      if (lbl) lbl.textContent = dark ? '白天' : '暗夜';
      if (btn) {
        btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
        btn.setAttribute('title', dark ? '切换到白天模式' : '切换到暗夜模式');
      }
    }
    apply(saved);
    var b = document.getElementById('btnTheme');
    if (b) b.onclick = function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      apply(next);
      try { localStorage.setItem(KEY, next); } catch (e) { }
    };
  })();

  /* ---------------- 提示 ---------------- */
  var toastTimer = null;
  function toast(msg, type) {
    var el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show ' + (type || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast ' + (type || ''); }, 2600);
  }

  function setMeta(txt) { var el = $('#previewMeta'); if (el) el.textContent = txt || ''; }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function stamp() { var d = new Date(); return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()); }

  // 字体按语言分两组：中文(cn) / 英文(en)。手写英文只作用于拉丁字母数字，其余归中文。
  function fontScope(f) {
    if (f.scope && f.scope !== 'both') return f.scope;
    return f.group === '手写·英文' ? 'en' : 'cn';
  }
  // 某字体是否出现在指定栏：自载字体(scope='both')中英两栏都出现，由你选哪栏来定归属。
  function inScope(f, scope) { return fontScope(f) === scope || f.scope === 'both'; }
  function firstOfScope(scope) {
    return CAT.FONTS.filter(function (f) { return inScope(f, scope); })[0] || CAT.FONTS[0];
  }

  /* 中文大字体（每款 3~25MB）不为列表预览整体加载；改用只含"手写示例"的极小预览子集
   * （各几 KB，见 fonts/previews/），开出列表即显示；完整字体仍在该字体被选中 / 生成时按需加载。 */
  var pvReady = {};
  function cnPreviewPath(f) {
    return String(f.file).replace(/handwriting[\\/]cn[\\/]/, 'previews/').replace(/\.(otf|ttf)$/i, '.ttf');
  }
  function previewFamilyFor(f, scope) {
    if (scope === 'en' || f.kind !== 'bundled' || !f.file) return f.family;
    var fam = 'PV_' + f.family;
    return pvReady[fam] ? '"' + fam + '"' : f.family;
  }
  function loadCnPreviews(after) {
    var items = CAT.FONTS.filter(function (f) { return f.kind === 'bundled' && fontScope(f) === 'cn' && f.file; });
    if (typeof FontFace === 'undefined') { after && after(); return; }
    var pending = [];
    items.forEach(function (f) {
      var fam = 'PV_' + f.family;
      if (pvReady[fam]) return;
      pending.push(new Promise(function (res) {
        var ff = new FontFace(fam, 'url("' + cnPreviewPath(f) + '")');
        ff.load().then(function (x) { document.fonts.add(x); pvReady[fam] = 1; })
          .catch(function () { })
          .then(res);
      }));
    });
    Promise.all(pending).then(function () { after && after(); });
  }
  function curFontCn() { return CAT.FONTS.filter(function (f) { return f.id === cfg.fontIdCn; })[0] || firstOfScope('cn'); }
  function curFontEn() { return CAT.FONTS.filter(function (f) { return f.id === cfg.fontIdEn; })[0] || firstOfScope('en'); }
  function curPaper() { return CAT.PAPERS.filter(function (p) { return p.id === cfg.paperId; })[0] || CAT.PAPERS[0]; }
  function isSystemFont(f) { return f.kind === 'system'; }
  function fontFamilyFor(f) { return f.family; }
  function markInk() {
    $$('.inkdot').forEach(function (d) {
      d.classList.toggle('on', d.dataset.c.toLowerCase() === String(cfg.inkColor).toLowerCase());
    });
  }

  /* ---------------- 构建字体选择器（中文 / 英文 两组） ---------------- */
  function buildFontCombo() {
    buildFontListFor('cn', '#fontList', '#fontSearch', cfg.fontIdCn);
    buildFontListFor('en', '#fontListEn', '#fontSearchEn', cfg.fontIdEn);
  }

  function buildFontListFor(scope, listSel, searchSel, selId) {
    var list = $(listSel);
    if (!list) return;
    list.innerHTML = '';
    var q = ($(searchSel).value || '').trim().toLowerCase();
    // 按字体名首字母排序：中文用拼音（zh-Hans-CN），英文用英文字母序；数字/拉丁排在最后
    var coll = scope === 'en' ? 'en' : 'zh-Hans-CN';
    var items = CAT.FONTS.filter(function (f) { return inScope(f, scope); });
    items.sort(function (a, b) { return a.name.localeCompare(b.name, coll, { sensitivity: 'base' }); });
    items.forEach(function (f) {
      if (q && f.name.toLowerCase().indexOf(q) < 0 && f.id.indexOf(q) < 0) return;
      var di = document.createElement('div');
      di.className = 'item' + (f.id === selId ? ' on' : '');
      di.dataset.id = f.id;
      var left = document.createElement('div');
      var sample = scope === 'en' ? 'Aa Handwriting' : '手写示例';
      left.innerHTML = '<div>' + f.name + '</div><div class="g">' + f.group + '</div>';
      var prev = document.createElement('span');
      prev.className = 'prev';
      prev.style.fontFamily = previewFamilyFor(f, scope);
      prev.textContent = sample;
      di.appendChild(left); di.appendChild(prev);
      di.onclick = function () {
        if (scope === 'en') cfg.fontIdEn = f.id; else cfg.fontIdCn = f.id;
        buildFontCombo(); refreshStatus();
        // 大字体按需加载：选中后再拉取，加载完刷新一次让示例字显示出来
        if (f.kind === 'bundled') {
          var info = $('#fontLoadInfo');
          if (info) info.textContent = '正在加载「' + f.name + '」…';
          R.loadFont(f).then(function () { buildFontCombo(); if (info) info.textContent = '字体已就绪'; });
        }
      };
      list.appendChild(di);
    });
  }

  /* ---------------- 构建纸张选择器 ---------------- */
  function paperSwatch(p) {
    var st = p.style || {};
    var c = document.createElement('div');
    c.className = 'sw';
    c.style.background = st.paper || '#fff';
    // 有真实纸张纹理照片（内嵌 data URI）时，优先用照片作底
    var texUrl = (st.tex && CAT && HW.textures && HW.textures[st.tex])
      ? 'url("' + HW.textures[st.tex] + '")' : null;
    if (p.kind === 'grid') {
      var g1 = 'linear-gradient(' + (st.grid || '#c0392b') + ' 1px,transparent 1px)';
      var g2 = 'linear-gradient(90deg,' + (st.grid || '#c0392b') + ' 1px,transparent 1px)';
      c.style.backgroundImage = texUrl ? (g1 + ',' + g2 + ',' + texUrl) : (g1 + ',' + g2);
      c.style.backgroundSize = texUrl ? '5px 5px,5px 5px,cover' : '5px 5px';
      if (texUrl) c.style.backgroundPosition = '0 0,0 0,center';
    } else if (p.kind === 'line') {
      var l1 = 'repeating-linear-gradient(' + (st.rule || '#c0392b') + ' 0 1px,transparent 1px 5px)';
      c.style.backgroundImage = texUrl ? (l1 + ',' + texUrl) : l1;
      c.style.backgroundSize = texUrl ? 'auto,cover' : '';
      if (texUrl) c.style.backgroundPosition = '0 0,center';
    } else if (p.uploaded && customImages[p.id]) {
      var uu = customImages[p.id];
      c.style.backgroundImage = 'url("' + uu.src + '")';
      c.style.backgroundSize = 'cover';
      c.style.backgroundPosition = 'center';
    } else if (p.kind === 'custom') {
      c.style.background = 'linear-gradient(135deg,#334,#667)';
    } else if (texUrl) {
      // 纯纹理纸（白/米色/牛皮/做旧）
      c.style.backgroundImage = texUrl;
      c.style.backgroundSize = 'cover';
      c.style.backgroundPosition = 'center';
    }
    return c;
  }
  // 单张纸张卡片；removable 为 true 时右上角带「×」删除
  function paperCard(p) {
    var card = document.createElement('div');
    card.className = 'paper-card' + (p.id === cfg.paperId ? ' on' : '') + (p.user || p.uploaded ? ' user' : '');
    card.appendChild(paperSwatch(p));
    var nm = document.createElement('div');
    nm.className = 'nm'; nm.textContent = p.name;
    card.appendChild(nm);
    if (p.removable) {
      var del = document.createElement('span');
      del.className = 'del'; del.textContent = '×'; del.title = '删除这张纸';
      del.onclick = function (e) { e.stopPropagation(); removePaper(p); };
      card.appendChild(del);
    }
    card.onclick = function () { cfg.paperId = p.id; onPaperChange(); };
    return card;
  }
  function buildPaperList() {
    var box = $('#paperList'), mbox = $('#paperListMore'), cbox = $('#customPaperList');
    var main = [], more = [], mine = [], n = 0;
    CAT.PAPERS.forEach(function (p) {
      if (p.kind === 'custom') { mine.push(p); return; }
      if (p.more) { more.push(p); return; }
      main.push(p);
    });
    // 用户自建的纸（含上传的），归到「自定义纸张」段
    mine = mine.filter(function (p) { return p.id === 'custom'; })
      .concat(mine.filter(function (p) { return p.id !== 'custom'; }));

    box.innerHTML = ''; main.forEach(function (p) { box.appendChild(paperCard(p)); });
    mbox.innerHTML = ''; more.forEach(function (p) { mbox.appendChild(paperCard(p)); });
    cbox.innerHTML = ''; mine.forEach(function (p) { cbox.appendChild(paperCard(p)); });

    mbox.hidden = !moreOpen;
    var btn = $('#paperMoreBtn');
    if (btn) btn.setAttribute('aria-expanded', moreOpen ? 'true' : 'false');
    var mn = $('#paperMoreN');
    if (mn) mn.textContent = '（' + more.length + '）';
  }
  function onPaperChange() {
    buildPaperList();
    var p = curPaper();
    // 选中上传类纸张时才显示上传区
    var showUpload = p.kind === 'custom' || p.uploaded;
    $('#customBgRow').style.display = showUpload ? 'block' : 'none';
    if (showUpload && p.uploaded) $('#customBgName').value = p.name;
    refreshStatus();
  }

  /* ---------------- 纸张增删 ---------------- */
  function removePaper(p) {
    var msg = p.removable ? ('删除纸张「' + p.name + '」？') : ('这是内置纸张，删除后可在「更多纸张」里重新加回。删除「' + p.name + '」？');
    if (!window.confirm(msg)) return;
    if (p.builtin) {
      var next = []; for (var i = 0; i < CAT.PAPERS.length; i++) if (CAT.PAPERS[i].id !== p.id) next.push(CAT.PAPERS[i]);
      CAT.PAPERS.length = 0; Array.prototype.push.apply(CAT.PAPERS, next);
      if (paperStore.removed.indexOf(p.id) < 0) paperStore.removed.push(p.id);
    } else {
      for (var j = 0; j < paperStore.custom.length; j++) if (paperStore.custom[j].id === p.id) { paperStore.custom.splice(j, 1); }
      var nx = []; for (var k = 0; k < CAT.PAPERS.length; k++) if (CAT.PAPERS[k].id !== p.id) nx.push(CAT.PAPERS[k]);
      CAT.PAPERS.length = 0; Array.prototype.push.apply(CAT.PAPERS, nx);
      delete customImages[p.id];
    }
    savePaperStore();
    if (cfg.paperId === p.id) cfg.paperId = 'tex_hnkj_letter';
    onPaperChange();
    toast('已删除：' + p.name, 'ok');
  }

  /* ---------------- 滑块 ---------------- */
  function bindSlider(id, key) {
    var el = $('#' + id), out = $('#' + id + 'Val');
    el.value = cfg[key];
    out.textContent = cfg[key];
    el.oninput = function () { cfg[key] = +el.value; out.textContent = el.value; refreshStatus(); };
  }
  // 中/英字号倍率滑块（显示为 "1.00×"）
  function bindSize(id, key) {
    var el = $('#' + id), out = $('#' + id + 'Val');
    el.value = cfg[key] || 1;
    out.textContent = (+el.value).toFixed(2) + '×';
    el.oninput = function () { cfg[key] = +el.value; out.textContent = (+el.value).toFixed(2) + '×'; };
    el.onchange = function () { if (lastPages.length) redrawAll(); };
  }
  // 中/英笔画粗细滑块（负 = 更细，0 = 标准，正 = 更粗）
  function weightLabel(v) { v = +v; return v === 0 ? '标准' : (v > 0 ? ('+' + v) : String(v)); }
  function bindWeight(id, key) {
    var el = $('#' + id), out = $('#' + id + 'Val');
    el.value = cfg[key] || 0;
    out.textContent = weightLabel(el.value);
    el.oninput = function () { cfg[key] = +el.value; out.textContent = weightLabel(el.value); };
    // 松开滑块立即按新粗细重画（预览已生成时）
    el.onchange = function () { if (lastPages.length) redrawAll(); };
  }
  // 中/英字间距滑块（mm，正 = 更松）。间距影响排版，改完需要重新排版，故用 doPreview。
  function bindTrack(id, key) {
    var el = $('#' + id), out = $('#' + id + 'Val');
    el.value = cfg[key] || 0;
    out.textContent = (+el.value).toFixed(2);
    el.oninput = function () { cfg[key] = +el.value; out.textContent = (+el.value).toFixed(2); };
    el.onchange = function () { if (lastPages.length && !busy) doPreview(); };
  }
  // 纯渲染参数滑块（改完只需重画，不用重新排版）
  function bindRenderSlider(id, key, dec) {
    var el = $('#' + id), out = $('#' + id + 'Val');
    el.value = cfg[key];
    out.textContent = (+el.value).toFixed(dec);
    el.oninput = function () { cfg[key] = +el.value; out.textContent = (+el.value).toFixed(dec); };
    el.onchange = function () { if (lastPages.length) redrawAll(); };
  }

  /* ---------------- 采集参数 ---------------- */
  function collectOpts() {
    return {
      seed: cfg.seed || '',
      fontSizeMm: cfg.fontSizeMm,
      sizeCn: cfg.sizeCn,
      sizeEn: cfg.sizeEn,
      trackCn: cfg.trackCn || 0,
      trackEn: cfg.trackEn || 0,
      lineSpacing: cfg.lineSpacing,
      bold: cfg.bold
    };
  }

  function renderCfg(fast) {
    var p = curPaper(), fcn = curFontCn(), fen = curFontEn();
    var fsMm = cfg.fontSizeMm > 0 ? cfg.fontSizeMm : (p.lineMm ? p.lineMm * 0.60 : 0);
    return {
      fast: !!fast,
      familyCn: fontFamilyFor(fcn),
      familyEn: fontFamilyFor(fen),
      inkColor: cfg.inkColor,
      inkJitter: cfg.inkJitter,
      inkPressure: cfg.inkPressure,
      inkTexture: cfg.inkTexture,
      bold: cfg.bold,
      mistakeRate: cfg.mistakeRate,
      messyRatio: cfg.messyRatio,
      charRandom: cfg.charRandom,
      pageNumber: cfg.pageNumber,
      textOffset: cfg.textOffset,
      weightCn: cfg.weightCn,
      weightEn: cfg.weightEn,
      customImage: p.uploaded ? (customImages[p.id] || null) : customImage
    };
  }

  function refreshStatus() {
    var txt = $('#text').value;
    var p = curPaper(), fcn = curFontCn(), fen = curFontEn();
    $('#stat').textContent = '字符 ' + Array.from(txt.replace(/\s/g, '')).length +
      ' · 中：' + fcn.name + ' · 英：' + fen.name + ' · 纸张：' + p.name;
  }

  /* ---------------- 预览 ---------------- */
  function doPreview() {
    if (busy) return;
    var text = $('#text').value;
    if (!text || !text.trim()) { toast('请先输入要转成手写的文字', 'err'); return; }
    if (text.length > 20000) { toast('文字太多了，先拆小一点再生', 'err'); return; }
    busy = true;
    var box = $('#preview');
    setMeta('生成中…');
    box.innerHTML = '<div class="empty"><div class="big">写</div><div class="hint">正在生成手写稿…</div>' +
      '<div class="progress" style="margin:14px auto 0"><i id="pg" style="width:8%"></i></div></div>';
    var fcn = curFontCn(), fen = curFontEn(), p = curPaper();
    $('#pg') && ($('#pg').style.width = '15%');

    Promise.all([R.loadFont(fcn), R.loadFont(fen)]).then(function () {
      var fams = { cn: fontFamilyFor(fcn), en: fontFamilyFor(fen) };
      lastLayout = R.layout(text, p, collectOpts(), fams);
      lastPages = []; overlays = []; dragging = null; clearSel(); marquee = null;
      pageCaches = []; lastCacheSig = '';   // 新布局：丢弃旧页缓存（避免同种子复用导致画错）
      undoStack = []; redoStack = []; syncUndoUI();   // 新布局：清空撤回/重做历史
      box.innerHTML = '';
      var total = lastLayout.pages.length;
      $('#pg') && ($('#pg').style.width = '35%');

      var i = 0;
      function next() {
        if (i >= total) {
          busy = false; $('#pg') && ($('#pg').style.width = '100%');
          toast('生成完成，共 ' + total + ' 页', 'ok');
          setMeta('共 ' + total + ' 页 · ' + cfg.dpi + ' dpi');
          refreshStatus();
          if (lineEdit) for (var q = 0; q < lastPages.length; q++) drawLineHighlights(q);
          return;
        }
        var holder = document.createElement('div');
        holder.className = 'page-holder';
        var stack = document.createElement('div');
        stack.className = 'page-stack';
        var cv = document.createElement('canvas');
        R.renderWithCache(cv, lastLayout, i, renderCfg(), previewDpi, pageCache(i), cacheFor);   // 预览统一走缓存
        lastPages.push(cv);
        stack.appendChild(cv);
        var ov = document.createElement('div');
        ov.className = 'line-overlay';
        stack.appendChild(ov);
        overlays.push(ov);
        bindDrag(cv, i);
        holder.appendChild(stack);
        var cap = document.createElement('div');
        cap.className = 'cap'; cap.textContent = '第 ' + (i + 1) + ' / ' + total + ' 页（预览已压缩，下载为高清）';
        holder.appendChild(cap);
        box.appendChild(holder);
        i++;
        var pct = 35 + (i / total) * 60;
        $('#pg') && ($('#pg').style.width = pct + '%');
        requestAnimationFrame(function () { setTimeout(next, 0); });
      }
      next();
    });
  }

  /* ---------------- 导出 PNG ----------------
   * 走宿主原生保存桥（native.js）：单页弹「另存为」、多页弹「选择文件夹」，
   * 直接写盘，不再触发 WebView2/浏览器「下载多个文件」的拦截。 */
  function exportPNG(which) {
    if (!lastLayout) { toast('请先生成预览', 'err'); return; }
    var dpi = cfg.dpi;
    var st = stamp();
    var idxs = (which === 'all') ? lastLayout.pages.map(function (_, i) { return i; }) : [which];
    var items = idxs.map(function (i) { return { idx: i, name: '手写稿_' + st + '_p' + (i + 1) + '.png' }; });
    toast('正在导出 PNG（' + dpi + 'dpi）…');
    if (!HW.native) {                                  // 理论到不了，兜个底
      idxs.forEach(function (i) {
        var cv0 = document.createElement('canvas');
        R.renderPage(cv0, lastLayout, i, renderCfg(), dpi);
        cv0.toBlob(function (b) { download(b, '手写稿_' + st + '_p' + (i + 1) + '.png'); }, 'image/png');
      });
      return;
    }
    HW.native.exportAll(items, function (it) {
      var cv = document.createElement('canvas');
      R.renderPage(cv, lastLayout, it.idx, renderCfg(), dpi);
      return new Promise(function (res) {
        cv.toBlob(function (b) { cv.width = cv.height = 0; res(b); }, 'image/png');
      });
    }, function (done, total) {
      if (total > 1) toast('正在导出 PNG… ' + done + '/' + total);
    }).then(function (r) {
      if (r && r.canceled) { toast('已取消导出'); return; }
      if (r && r.error) { toast('导出失败：' + r.error, 'err'); return; }
      var where = (r && r.label) ? '：' + r.label : '';
      toast('已导出 ' + idxs.length + ' 张' + (r && r.fallback ? '（浏览器下载文件夹）' : where), 'ok');
    });
  }

  /* ---------------- 导出预览图（所见即所得） ----------------
   * 直接把预览那版渲染（previewDpi 低分辨率 + 同样的墨迹/抖动）落盘，
   * 观感柔和、接近真实手写照片，不像高 dpi 导出那么锐利。 */
  function exportPreview() {
    if (!lastLayout) { toast('请先生成预览', 'err'); return; }
    var st = stamp();
    var items = lastLayout.pages.map(function (_, i) { return { idx: i, name: '手写稿_' + st + '_预览_p' + (i + 1) + '.png' }; });
    toast('正在导出预览图…');
    function render(it) {
      var cv = document.createElement('canvas');
      R.renderPage(cv, lastLayout, it.idx, renderCfg(), previewDpi);   // 与预览同分辨率、同参数
      return new Promise(function (res) {
        cv.toBlob(function (b) { cv.width = cv.height = 0; res(b); }, 'image/png');
      });
    }
    if (!HW.native) {
      items.forEach(function (it) { render(it).then(function (b) { download(b, it.name); }); });
      return;
    }
    HW.native.exportAll(items, render, function (done, total) {
      if (total > 1) toast('正在导出预览图… ' + done + '/' + total);
    }).then(function (r) {
      if (r && r.canceled) { toast('已取消导出'); return; }
      if (r && r.error) { toast('导出失败：' + r.error, 'err'); return; }
      var where = (r && r.label) ? '：' + r.label : '';
      toast('已导出 ' + items.length + ' 张预览图' + (r && r.fallback ? '（浏览器下载文件夹）' : where), 'ok');
    });
  }

  /* ---------------- 导出 PDF ---------------- */
  function exportPDF() {
    if (!lastLayout) { toast('请先生成预览', 'err'); return; }
    if (busy) return;
    busy = true;
    var dpi = cfg.dpi, N = lastLayout.pages.length;
    var box = $('#preview');
    var bar = document.createElement('div');
    bar.className = 'empty'; bar.id = 'pdfProg';
    bar.innerHTML = '<div class="big">写</div><div class="hint">正在生成 PDF…</div>' +
      '<div class="progress" style="margin:14px auto 0"><i id="pg2" style="width:3%"></i></div>';
    box.appendChild(bar);
    var area = lastLayout.area;
    var name = '手写稿_' + stamp() + '.pdf';
    var data = [], i = 0;
    function finish(blob) {
      var done = function (r) {
        bar.remove(); busy = false;
        if (r && r.canceled) { toast('已取消保存'); return; }
        if (r && r.error) { toast('保存失败：' + r.error, 'err'); return; }
        var where = (r && r.label) ? '：' + r.label : '';
        toast('PDF 已保存' + (r && r.fallback ? '（浏览器下载文件夹）' : where), 'ok');
      };
      if (HW.native) HW.native.exportAll([{ name: name }], function () { return blob; }).then(done);
      else { download(blob, name); done({}); }
    }
    function step() {
      if (i >= N) {
        finish(R.buildPDF(data, area.pageW, area.pageH));
        return;
      }
      var cv = document.createElement('canvas');
      R.renderPage(cv, lastLayout, i, renderCfg(), dpi);
      var jpeg = R.canvasToJpegBytes(cv, 0.86);
      data.push({ jpeg: jpeg, w: cv.width, h: cv.height });
      i++;
      $('#pg2') && ($('#pg2').style.width = (3 + i / N * 94) + '%');
      // 释放画布
      cv.width = cv.height = 0;
      requestAnimationFrame(function () { setTimeout(step, 0); });
    }
    step();
  }

  /* 打印：生成图片再用 img */
  function doPrint2() {
    if (!lastLayout) { toast('请先生成预览', 'err'); return; }
    var dpi = 190, N = lastLayout.pages.length, area = lastLayout.area;
    var w = window.open('', '_blank');
    w.document.write('<!doctype html><meta charset="utf-8"><title>打印手写稿</title>');
    w.document.write('<style>@page{size:' + area.pageW + 'mm ' + area.pageH + 'mm;margin:0}' +
      'html,body{margin:0;padding:0}img{display:block;width:100%;page-break-after:always}</style>');
    w.document.write('<body>');
    for (var i = 0; i < N; i++) {
      var cv = document.createElement('canvas');
      R.renderPage(cv, lastLayout, i, renderCfg(), dpi);
      w.document.write('<img src="' + cv.toDataURL('image/png') + '">');
      cv.width = cv.height = 0;
    }
    w.document.write('</body>');
    w.document.close();
    setTimeout(function () { try { w.focus(); w.print(); } catch (e) { } }, 700);
  }

  /* ---------------- 载入本地字体文件 ----------------
   * 把任意 ttf / otf / woff2 作为 FontFace 注册，注入字体列表顶部。
   * 这样只要下载到任何手写字体，丢进来就能用，效果直接对标原站。
   * ---------------------------------------------------------- */
  var privFonts = [];
  // 本地载入的字体不做中/英猜测（浏览器回退链不可靠）：同时进中、英两个列表，
  // 你在哪一栏选中它，它就归哪一栏 —— 选任意一款都能覆盖整篇内容。
  function onLocalFont(files) {
    if (!files || !files.length) return;
    Array.prototype.slice.call(files).forEach(function (file) {
      var base = file.name.replace(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/, '');
      var fam = 'HW_PRIV_' + base.replace(/[^A-Za-z0-9_]/g, '_') + '_' + Math.random().toString(36).slice(2, 6);
      var url = URL.createObjectURL(file);
      var ff = new FontFace(fam, 'url("' + url + '")');
      ff.load().then(function (f) {
        document.fonts.add(f);
        var item = { id: 'priv_' + fam, name: base + ' ★自载', kind: 'system',
          family: '"' + fam + '"', group: '自定义·中英通用', scope: 'both' };
        CAT.FONTS.unshift(item); privFonts.unshift(item);
        buildFontCombo();
        toast('已载入：' + base + '（中/英字体栏都可选）', 'ok');
      }).catch(function (e) { toast('字体载入失败：' + base, 'err'); });
    });
  }

  /* ---------------- 自定义背景（上传纸张） ---------------- */
  // 把一张上传图变成一张可复用的纸张对象；persist=true 时存进 localStorage
  function addUploadedPaper(file, name, persist) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var id = 'up_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
        var pid = name && name.trim() ? name.trim() : ('自定义背景 ' + (paperStore.custom.length + 1));
        var paper = { id: id, name: pid, kind: 'custom', uploaded: true, page: 'A4', orientation: 'portrait',
          margins: { t: 20, r: 20, b: 20, l: 20 }, style: { paper: '#ffffff', grain: 0 } };
        if (persist) {
          // 存 dataURL（可跨会话）；超过本地配额就退化成仅本会话可用
          try {
            var maxW = 1600;
            var cv = document.createElement('canvas');
            var sc = Math.min(1, maxW / img.width);
            cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            var dataUrl = cv.toDataURL('image/jpeg', 0.8);
            var probe = JSON.parse(JSON.stringify(paperStore));
            probe.custom = paperStore.custom.concat([Object.assign({ dataUrl: dataUrl }, paper)]);
            localStorage.setItem(CAT.USER_PAPER_KEY, JSON.stringify(probe));  // 先试存
            paperStore = probe;
            applyPaperStore();
            var pimg = new Image();
            pimg.onload = function () { customImages[id] = pimg; resolve(paper); };
            pimg.onerror = function () { customImages[id] = img; resolve(paper); };
            pimg.src = dataUrl;
            return;
          } catch (e) {
            toast('长期保存失败（本地空间不足），本次仍可使用', 'err');
          }
        }
        // 仅本次会话：保留 objectURL
        paperStore.custom.push(paper);
        customImages[id] = img;
        savePaperStore();
        applyPaperStore();
        resolve(paper);
      };
      img.onerror = function () { toast('图片读取失败', 'err'); resolve(null); };
      img.src = URL.createObjectURL(file);
    });
  }

  function onCustomBg(file) {
    if (!file) return;
    var name = ($('#customBgName').value || '').trim();
    var persist = $('#customBgPersist').checked;
    addUploadedPaper(file, name, persist).then(function (paper) {
      if (!paper) return;
      if (persist) savePaperStore();
      cfg.paperId = paper.id;
      customImage = customImages[paper.id] || null;
      $('#customBgName').value = '';
      onPaperChange();
      toast('已添加纸张：' + paper.name + (persist ? '（已长期保存）' : ''), 'ok');
      if (lastLayout) doPreview();
    });
  }

  // 启动时把长期保存的上传纸张解码回来
  function restoreUploadedPapers() {
    var pend = paperStore.custom.filter(function (p) { return p.dataUrl; }).length;
    paperStore.custom.forEach(function (p) {
      if (p.dataUrl) {
        var im = new Image();
        im.onload = function () { customImages[p.id] = im; if (--pend <= 0) buildPaperList(); };
        im.onerror = function () { if (--pend <= 0) buildPaperList(); };
        im.src = p.dataUrl;
      }
    });
    return !!pend;
  }

  /* ---------------- 本地草稿 ---------------- */
  function saveDraft() {
    try {
      localStorage.setItem('hw_draft', JSON.stringify({ text: $('#text').value, cfg: cfg }));
      toast('草稿已存到本地浏览器', 'ok');
    } catch (e) { toast('保存失败', 'err'); }
  }
  function loadDraft() {
    try {
      var d = JSON.parse(localStorage.getItem('hw_draft') || 'null');
      if (!d) { toast('没有本地草稿', 'err'); return; }
      $('#text').value = d.text || '';
      Object.assign(cfg, d.cfg || {});
      syncUI(); toast('草稿已载入', 'ok');
    } catch (e) { toast('载入失败', 'err'); }
  }

  /* ---------------- 按需联网加载脚本（Word/OCR 用，多 CDN 自动回退） ---------------- */
  var _loadedScripts = {};
  function loadOne(url) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = url; s.onload = function () { res(url); };
      s.onerror = function () { s.remove(); rej(new Error('fail ' + url)); };
      document.head.appendChild(s);
    });
  }
  function loadScript(urls) {
    if (typeof urls === 'string') urls = [urls];
    var key = urls[0];
    if (_loadedScripts[key]) return _loadedScripts[key];
    _loadedScripts[key] = (function tryAt(i) {
      if (i >= urls.length) return Promise.reject(new Error('所有 CDN 均不可用'));
      return loadOne(urls[i]).catch(function () { return tryAt(i + 1); });
    })(0);
    return _loadedScripts[key];
  }
  var CDN = {
    mammoth: [
      'https://unpkg.com/mammoth@1.8.0/mammoth.browser.min.js',
      'https://fastly.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js',
      'https://registry.npmmirror.com/mammoth/1.8.0/files/mammoth.browser.min.js'
    ],
    tesseract: [
      'https://unpkg.com/tesseract.js@5.1.0/dist/tesseract.min.js',
      'https://fastly.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js',
      'https://registry.npmmirror.com/tesseract.js/5.1.0/files/dist/tesseract.min.js'
    ]
  };

  function onLoadWord(file) {
    if (!file) return;
    if (/\.(txt)$/i.test(file.name)) {
      var r = new FileReader();
      r.onload = function () { $('#text').value = r.result; refreshStatus(); doPreview(); };
      r.readAsText(file, 'utf-8'); return;
    }
    toast('正在联网加载 Word 解析库…');
    loadScript(CDN.mammoth).then(function () {
      return file.arrayBuffer();
    }).then(function (buf) {
      return window.mammoth.extractRawText({ arrayBuffer: buf });
    }).then(function (res) {
      $('#text').value = res.value || '';
      toast('Word 导入成功，共 ' + Array.from(res.value || '').length + ' 字', 'ok');
      refreshStatus(); doPreview();
    }).catch(function (e) { toast('Word 导入失败：' + e.message + '（可把文字直接粘进去）', 'err'); });
  }

  function onLoadImg(file) {
    if (!file) return;
    toast('正在联网加载 OCR 引擎（首次较慢）…');
    loadScript(CDN.tesseract).then(function () {
      return window.Tesseract.createWorker('chi_sim+eng');
    }).then(function (worker) {
      toast('正在识别图片中的文字…');
      return worker.recognize(file).then(function (o) {
        worker.terminate();
        return o.data.text;
      });
    }).then(function (text) {
      text = (text || '').replace(/\n{3,}/g, '\n\n').trim();
      if (!text) { toast('没识别到文字，换张清晰的', 'err'); return; }
      $('#text').value = text;
      toast('图片识别成功，共 ' + Array.from(text).length + ' 字', 'ok');
      refreshStatus(); doPreview();
    }).catch(function (e) { toast('OCR 失败：' + e.message, 'err'); });
  }

  function syncUI() {
    $('#fontSearch').value = ''; $('#fontSearchEn').value = '';
    buildFontCombo(); buildPaperList();
    $('#mistake-ratio').value = cfg.mistakeRate; $('#mistake-ratioVal').textContent = cfg.mistakeRate;
    $('#messy-ratio').value = cfg.messyRatio; $('#messy-ratioVal').textContent = cfg.messyRatio;
    $('#char-random').value = cfg.charRandom; $('#char-randomVal').textContent = cfg.charRandom;
    $('#inkColor').value = cfg.inkColor;
    $('#bold').checked = !!cfg.bold;
    $('#inkJitter').checked = cfg.inkJitter !== false;
    $('#pageNumber').checked = cfg.pageNumber !== false;
    $('#dpi').value = cfg.dpi;
    $('#seed').value = cfg.seed || '';
    $('#fontSize').value = cfg.fontSizeMm;
    $('#lineSpacing').value = cfg.lineSpacing;
    $('#sizeCn').value = cfg.sizeCn || 1; $('#sizeCnVal').textContent = (+(cfg.sizeCn || 1)).toFixed(2) + '×';
    $('#sizeEn').value = cfg.sizeEn || 1; $('#sizeEnVal').textContent = (+(cfg.sizeEn || 1)).toFixed(2) + '×';
    $('#weightCn').value = cfg.weightCn || 0; $('#weightCnVal').textContent = weightLabel(cfg.weightCn || 0);
    $('#weightEn').value = cfg.weightEn || 0; $('#weightEnVal').textContent = weightLabel(cfg.weightEn || 0);
    $('#trackCn').value = cfg.trackCn || 0; $('#trackCnVal').textContent = (+(cfg.trackCn || 0)).toFixed(2);
    $('#trackEn').value = cfg.trackEn || 0; $('#trackEnVal').textContent = (+(cfg.trackEn || 0)).toFixed(2);
    $('#inkPressure').value = (cfg.inkPressure === undefined ? 1 : cfg.inkPressure); $('#inkPressureVal').textContent = (+$('#inkPressure').value).toFixed(1);
    $('#inkTexture').value = (cfg.inkTexture === undefined ? 0.4 : cfg.inkTexture); $('#inkTextureVal').textContent = (+$('#inkTexture').value).toFixed(2);
    var cp = curPaper();
    var showUpload = cp.kind === 'custom' || cp.uploaded;
    $('#customBgRow').style.display = showUpload ? 'block' : 'none';
    if (showUpload && cp.uploaded) $('#customBgName').value = cp.name;
    markInk();
    refreshStatus();
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    loadPaperStore();
    applyPaperStore();
    restoreUploadedPapers();   // 把长期保存的上传纸张解码回来（解码完成后刷新列表）

    bindSlider('mistake-ratio', 'mistakeRate');
    bindSlider('messy-ratio', 'messyRatio');
    bindSlider('char-random', 'charRandom');

    $('#inkColor').oninput = function () { cfg.inkColor = this.value; markInk(); };
    $$('.inkdot').forEach(function (d) {
      d.onclick = function () { cfg.inkColor = d.dataset.c; $('#inkColor').value = d.dataset.c; markInk(); };
    });
    $('#bold').onchange = function () { cfg.bold = this.checked; };
    $('#inkJitter').onchange = function () { cfg.inkJitter = this.checked; };
    $('#pageNumber').onchange = function () { cfg.pageNumber = this.checked; };
    $('#dpi').onchange = function () { cfg.dpi = +this.value; };
    $('#seed').oninput = function () { cfg.seed = this.value.trim(); };
    $('#fontSize').oninput = function () { cfg.fontSizeMm = +this.value || 0; };
    $('#lineSpacing').oninput = function () { cfg.lineSpacing = +this.value || 1; };
    bindSize('sizeCn', 'sizeCn');
    bindSize('sizeEn', 'sizeEn');
    $('#btnSizeReset').onclick = function () {
      cfg.sizeCn = 1; cfg.sizeEn = 1;
      $('#sizeCn').value = 1; $('#sizeCnVal').textContent = '1.00×';
      $('#sizeEn').value = 1; $('#sizeEnVal').textContent = '1.00×';
    };
    bindWeight('weightCn', 'weightCn');
    bindWeight('weightEn', 'weightEn');
    $('#btnWeightReset').onclick = function () {
      cfg.weightCn = 0; cfg.weightEn = 0;
      $('#weightCn').value = 0; $('#weightCnVal').textContent = '标准';
      $('#weightEn').value = 0; $('#weightEnVal').textContent = '标准';
    };
    bindTrack('trackCn', 'trackCn');
    bindTrack('trackEn', 'trackEn');
    $('#btnTrackReset').onclick = function () {
      cfg.trackCn = 0; cfg.trackEn = 0;
      $('#trackCn').value = 0; $('#trackCnVal').textContent = '0.00';
      $('#trackEn').value = 0; $('#trackEnVal').textContent = '0.00';
      if (lastPages.length && !busy) doPreview();
    };
    bindRenderSlider('inkPressure', 'inkPressure', 1);
    bindRenderSlider('inkTexture', 'inkTexture', 2);
    $('#fontSearch').oninput = buildFontCombo;
    $('#fontSearchEn').oninput = buildFontCombo;
    $('#customBg').onchange = function () { onCustomBg(this.files[0]); this.value = ''; };
    // 「更多纸张」折叠
    $('#paperMoreBtn').onclick = function () { moreOpen = !moreOpen; buildPaperList(); };
    // 上传区：点击 + 拖放
    var dz = $('#customBgDrop'), dzWrap = $('#customBgRow');
    if (dz) {
      dz.onclick = function () { $('#customBg').click(); };
      ['dragenter', 'dragover'].forEach(function (ev) {
        dzWrap.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('hot'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        dzWrap.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('hot'); });
      });
      dzWrap.addEventListener('drop', function (e) {
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) onCustomBg(f);
      });
    }
    $('#fileWord').onchange = function () { onLoadWord(this.files[0]); this.value = ''; };
    $('#fileImg').onchange = function () { onLoadImg(this.files[0]); this.value = ''; };
    $('#fileFont').onchange = function () { onLocalFont(this.files); this.value = ''; };
    $('#btnLoadWord').onclick = function () { $('#fileWord').click(); };
    $('#btnLoadImg').onclick = function () { $('#fileImg').click(); };
    $('#btnLoadFont').onclick = function () { $('#fileFont').click(); };

    $('#btnPreview').onclick = doPreview;
    $('#btnLineEdit').onclick = function () { setLineEdit(!lineEdit); };
    $('#btnModeLine').onclick = function () { setDragMode('line'); };
    $('#btnModeBlock').onclick = function () { setDragMode('block'); };
    $('#btnClearSel').onclick = function () { clearSel(); refreshSel(); };
    $('#btnResetAdj').onclick = resetAdj;
    $('#btnUndoAdj').onclick = undo;
    $('#btnRedoAdj').onclick = redo;
    // 快捷键：Ctrl+Z 撤回 / Ctrl+Y、Ctrl+Shift+Z 重做（微调模式下生效，不抢输入框）
    document.addEventListener('keydown', function (e) {
      if (!lineEdit || !lastLayout) return;
      var tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      var mod = e.ctrlKey || e.metaKey; if (!mod) return;
      var k = (e.key || '').toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    });
    syncUndoUI();
    $('#btnSeed').onclick = function () {
      cfg.seed = Math.random().toString(36).slice(2, 9);
      $('#seed').value = cfg.seed; doPreview();
    };
    $('#btnPngAll').onclick = function () { exportPNG('all'); };
    $('#btnPngOne').onclick = function () { exportPNG(0); };
    $('#btnPngPreview').onclick = exportPreview;
    $('#btnPdf').onclick = exportPDF;
    $('#btnPrint').onclick = doPrint2;
    $('#btnSave').onclick = saveDraft;
    $('#btnLoad').onclick = loadDraft;

    $('#text').addEventListener('input', refreshStatus);
    syncEditUI();
    window.addEventListener('resize', function () {
      for (var i = 0; i < lastPages.length; i++) drawLineHighlights(i);
    });

    syncUI();

    // 预加载内嵌的真实纸张纹理（data URI，本地立即解码）
    R.loadTextures();
    HW.onTextureLoad = function () { buildPaperList(); };
    // 自托管界面楷体子集（几百 KB，立即加载；失败静默回落到系统楷体）
    R.loadUiKai();

    // 字体按需加载：小体积的英文手写体立即加载用于下拉预览；
    // 大体积中文字体（每款 3~25MB）只在被选中/生成时才拉取，避免一次加载两百多 MB 拖死页面。
    var eager = CAT.FONTS.filter(function (f) {
      return f.kind === 'bundled' && f.group === '手写·英文';
    });
    var eagerDone = 0;
    Promise.all(eager.map(function (d) {
      return R.loadFont(d).then(function (r) {
        eagerDone++;
        var el = $('#fontLoadInfo'); if (el) el.textContent = '字体加载 ' + eagerDone + '/' + eager.length;
        buildFontCombo();
        return r;
      });
    })).then(function () {
      var el = $('#fontLoadInfo'); if (el) el.textContent = '字体已就绪';
      buildFontCombo();
    });

    // 中文预览子集（各几 KB）自动加载，中文列表即时显示"手写示例"；完整字体仍按需加载
    loadCnPreviews(buildFontCombo);

    $('#text').value = '语文作业：\n\n请同学们认真抄写下面的段落，注意书写工整，标点符号要占格。中英文都要写规范。\n\n春天来了，万物复苏。小草偷偷地从土里钻出来，嫩嫩的，绿绿的。园子里，田野里，瞧去，一大片一大片满是的。\n\nEnglish Practice: Spring is coming, and everything comes back to life. The little grass sneaks out of the soil, tender and green. Let us read the passage aloud and copy it carefully.\n\n春天来了，一起读：Spring is the best season of the year. 让我们珍惜时光，好好学习，天天向上。';
    refreshStatus();
    setTimeout(doPreview, 200);
  }

  document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('error', function (e) { console.error(e.message); });
})();
