/* ============================================================
 * 手写作业生成器 · render.js
 * 排版引擎 + 纸张绘制 + 手写抖动 + 导出（PNG / 零依赖 PDF）
 * 依赖 catalog.js 暴露的 window.HW
 * 坐标：排版一律用毫米(mm)，渲染时按 dpi 缩放
 * ============================================================ */
(function (root) {
  'use strict';
  var HW = root.HW = root.HW || {};
  var CAT = HW.catalog, RNG = HW.rng;

  var PX_PER_MM = 96 / 25.4; // 参考（仅用于离线测量）

  /* ================= 工具 ================= */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function isFullWidth(code) {
    return (code >= 0x2E80 && code <= 0x9FFF) ||   // CJK 部首~统一表意
           (code >= 0xF900 && code <= 0xFAFF) ||
           (code >= 0xFF00 && code <= 0xFF60) ||    // 全角
           (code >= 0xFFE0 && code <= 0xFFE6) ||
           (code >= 0x20000 && code <= 0x2FA1F);    // 扩展区
  }
  function isNoLineStart(ch) { return CAT.NO_LINE_START.indexOf(ch) >= 0; }
  function isNoLineEnd(ch) { return CAT.NO_LINE_END.indexOf(ch) >= 0; }
  // 英文「词」字符：字母、数字、词内撇号（for don't / it's）。用于整词换行，避免把单词拦腰截断。
  function isWordChar(ch) {
    if (!ch) return false;
    var c = ch.charCodeAt(0);
    return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || ch === "'" || ch === '’';
  }

  // 统一「谁归中文字体」：CJK 之外，把全套中文标点 / 全角符号也一并归到中文字体。
  // 这样选任意一款中文字体，整篇（含引号「」“” — … 等）都是这一款，不会漏到英文字体里去。
  var PUNCT_CN = '、。〈〉《》「」『』【】〔〕（）［］｛｝！？，．：；‘’“”·～￥…—－　・«»‹›×÷±≠≤≥√∞∑∏∈∪∩→←↑↓°′″¥€£§¶©®™';
  function isCnChar(code, ch) {
    if (isFullWidth(code)) return true;
    if (code < 0x80) return false;                 // 纯 ASCII 一律归英文
    if (PUNCT_CN.indexOf(ch) >= 0) return true;
    if (code >= 0x2000 && code <= 0x206F) return true;  // 常用标点区
    if (code >= 0x2E00 && code <= 0x2E7F) return true;  // 补充标点区
    if (code >= 0x3000 && code <= 0x30FF) return true;  // CJK 符号
    return false;
  }

  // 用高斯分布取抖动（均值0，标准差~1，截断到[-3,3]）
  function gauss(rng) {
    var u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    var g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return clamp(g, -3, 3);
  }

  /* ================= 字体加载 ================= */
  var loaded = {}; // id -> FontFace
  function loadFont(def) {
    if (!def) return Promise.resolve(null);
    if (def.kind !== 'bundled') return Promise.resolve(def.family);
    if (loaded[def.id]) return Promise.resolve(def.family);
    if (typeof FontFace === 'undefined') return Promise.resolve(def.family);
    var ff = new FontFace(def.family, 'url("' + def.file + '")');
    return ff.load().then(function (f) {
      document.fonts.add(f);
      loaded[def.id] = f;
      return def.family;
    }).catch(function (e) {
      console.warn('[HW] 字体加载失败', def.file, e);
      return def.family;
    });
  }
  // 界面显示字体（楷体子集）：自托管，摆脱对系统 KaiTi 的依赖；失败则静默回落到 --f-kai 的系统栈
  var _uiKai = false;
  function loadUiKai() {
    if (_uiKai || typeof FontFace === 'undefined') return Promise.resolve();
    return new FontFace('HW_KaiDisplay', 'url("fonts/ui/KaiDisplay.ttf")').load().then(function (f) {
      document.fonts.add(f); _uiKai = true;
    }).catch(function () { });
  }

  function loadAllBundled(onProgress) {
    var list = CAT.FONTS.filter(function (f) { return f.kind === 'bundled'; });
    var done = 0;
    return Promise.all(list.map(function (d) {
      return loadFont(d).then(function (r) { done++; onProgress && onProgress(done, list.length); return r; });
    }));
  }

  /* ================= 纸张纹理（真实照片，内嵌 data URI）=================
   * 放在 js/textures.js，以字符串形式内嵌；data URI 与页面同源，画进 canvas 不会污染，
   * 因此 file:// 下依然能正常导出 PNG/PDF。 */
  var _tex = {};   // name -> {img, ready}
  function texImage(name) {
    if (!name) return null;
    var t = _tex[name];
    if (t) return t.ready ? t.img : null;
    t = _tex[name] = { img: null, ready: false };
    var src = (HW.textures || {})[name];
    if (src && typeof Image !== 'undefined') {
      var im = new Image();
      im.onload = function () { t.ready = true; if (HW.onTextureLoad) HW.onTextureLoad(name); };
      im.src = src;
      t.img = im;
    }
    return null;
  }
  // 预加载全部纹理（本地内嵌，立即解码）
  function loadTextures() {
    var names = HW.textures || {};
    for (var k in names) { if (names.hasOwnProperty(k)) texImage(k); }
  }

  /* ================= 测量 ================= */
  var _mctx = null;
  function measureCtx() {
    if (!_mctx) { var c = document.createElement('canvas'); _mctx = c.getContext('2d'); }
    return _mctx;
  }
  var _cache = {};
  // 返回该字符相对「字号(100px)」的宽度倍数。CJK=1，拉丁按实测
  function widthFactor(ch, family) {
    var code = ch.codePointAt(0);
    if (isFullWidth(code)) return 1.0;
    var key = family + '|' + ch;
    if (key in _cache) return _cache[key];
    var ctx = measureCtx();
    ctx.font = '100px ' + family;
    var w = ctx.measureText(ch).width / 100;
    if (!(w > 0) || w > 1) w = w > 1 ? 1 : 0.55;
    // 手写感：拉丁稍微放宽一点
    w = clamp(w * 1.02, 0.28, 1.0);
    _cache[key] = w;
    return w;
  }

  /* ================= 断行（含避头尾） ================= */
  // tokens: [{ch, unit(1|2)}], capacity: 一行可容纳的单位数
  // 返回若干行，每行是 token 数组
  function wrapTokens(tokens, capacity) {
    var lines = [], cur = [], used = 0;
    function flush() { if (cur.length) { lines.push(cur); cur = []; used = 0; } }
    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i], u = tk.unit;
      if (used + u > capacity && cur.length) {
        if (isNoLineStart(tk.ch)) {
          // 避头：行首禁则字符悬挂到本行末（允许超一点）
          cur.push(tk); flush(); continue;
        }
        if (isNoLineEnd(cur[cur.length - 1].ch)) {
          // 避尾：把行末的开括号推到下一行，再重试当前 token
          var moved = cur.pop(); used -= moved.unit;
          flush();
          cur.push(moved); used = moved.unit;
          if (used + u > capacity) { flush(); } // 极端情况：moved 自己占满
          // 重新处理当前 token
          i--; continue;
        }
        flush();
      }
      cur.push(tk); used += u;
    }
    flush();
    return lines;
  }

  // 与 wrapTokens 同规则，但英文「整词换行」：一个词的字符绝不被拆到两行。
  // 只有当一个词放不下、且它是本行第一个词（被迫单独成行）时才落回逐字符断行，避免死循环。
  function wrapTokensWord(tokens, capacity) {
    var lines = [], cur = [], used = 0, i = 0, n = tokens.length;
    function flush() { if (cur.length) { lines.push(cur); cur = []; used = 0; } }
    while (i < n) {
      var tk = tokens[i], u = tk.unit;
      if (used + u <= capacity) { cur.push(tk); used += u; i++; continue; }
      if (!cur.length) { cur.push(tk); used += u; i++; continue; }   // 单个 token 就超行宽，硬放
      var ch = tk.ch;
      if (isNoLineStart(ch)) { cur.push(tk); used += u; i++; flush(); continue; }  // 避头：悬挂
      if (isNoLineEnd(cur[cur.length - 1].ch)) {                     // 避尾：行末开括号推到下一行
        var mv = cur.pop(); used -= mv.unit; flush(); cur.push(mv); used = mv.unit; continue;
      }
      if (isWordChar(ch) && isWordChar(cur[cur.length - 1].ch)) {
        // 词被拦腰截断 → 把该词在本行已排的部分整段移到下一行
        var k = cur.length;
        while (k > 0 && isWordChar(cur[k - 1].ch)) k--;
        var word = cur.splice(k);
        var wUsed = 0; for (var q = 0; q < word.length; q++) wUsed += word[q].unit;
        used -= wUsed;
        flush();
        cur = word; used = wUsed;
        continue;   // 处理当前 token（此时是本行第一个词）
      }
      var start = i;
      while (start < n && !isWordChar(tokens[start].ch)) start++;   // 跳过行首的空格/标点
      if (start < n) {
        // 下一个「词」从 start 开始；接得上就整体下移，不拆断
        var we = start, wU = 0;
        while (we < n && isWordChar(tokens[we].ch)) { wU += tokens[we].unit; we++; }
        if (used + wU <= capacity) {
          for (var k2 = 0; k2 < start - i; k2++) { cur.push(tokens[i + k2]); used += tokens[i + k2].unit; }
          i = start; continue;
        }
      }
      flush();   // 词本身太长或本行已有内容 → 从该词起另起一行
    }
    flush();
    return lines;
  }

  // 转换为 unit 数组：CJK=2，拉丁=1（格纸）；flow 模式用像素宽度另算
  function toUnits(paras) {
    return paras.map(function (p) {
      var arr = [], chars = Array.from(p);
      for (var i = 0; i < chars.length; i++) {
        var ch = chars[i];
        if (ch === '\t') { arr.push({ ch: ' ', unit: 2 }); continue; }
        arr.push({ ch: ch, unit: isFullWidth(ch.codePointAt(0)) ? 2 : 1 });
      }
      return arr;
    });
  }

  /* ================= 版面几何 ================= */
  function pageSize(paper) {
    var ps = CAT.PAGE[paper.page] || CAT.PAGE.A4;
    var w = ps[0], h = ps[1];
    if (paper.orientation === 'landscape') { var t = w; w = h; h = t; }
    return { w: w, h: h };
  }
  function margins(paper, opts) {
    var m = paper.margins || { t: 20, r: 20, b: 20, l: 20 };
    if (opts && opts.marginMm >= 0) m = { t: opts.marginMm, r: opts.marginMm, b: opts.marginMm, l: opts.marginMm };
    return m;
  }
  function areaOf(paper, opts) {
    var ps = pageSize(paper), m = margins(paper, opts);
    return { x: m.l, y: m.t, w: ps.w - m.l - m.r, h: ps.h - m.t - m.b, pageW: ps.w, pageH: ps.h, m: m };
  }
  // 整篇「手动调整形状」：用户按住四周边框改出的版面框（mm）。存在时覆盖纸张默认边距，
  // 文字在这个框里自动重排（拉宽→每行更多字），并只在框内分页。
  function flowBounds(paper, opts, area) {
    var fb = opts && opts.flowBox;
    if (!fb) return null;
    var x0 = Math.max(0, Math.min(fb.x, fb.x + fb.w));
    var y0 = Math.max(0, Math.min(fb.y, fb.y + fb.h));
    var x1 = Math.min(area.pageW, Math.max(fb.x, fb.x + fb.w));
    var y1 = Math.min(area.pageH, Math.max(fb.y, fb.y + fb.h));
    // 太小或基本等于整页 → 视作没调（也顺手清掉，避免老草稿里 {0,0,0,0} 污染排版）
    if (x1 - x0 < 12 || y1 - y0 < 12) { delete opts.flowBox; return null; }
    if (x1 - x0 > area.pageW - 1 && y1 - y0 > area.pageH - 1) { delete opts.flowBox; return null; }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, pageW: area.pageW, pageH: area.pageH, m: area.m };
  }

  /* ================= 排版主函数（输出 mm 坐标） ================= */
  // 返回：{ pages:[ {tokens:[{ch,x,y(基线),sizeRot...}], paper, area, kind, geom } ], meta }
  // 每行的原始排布：{ rawX, rawY, size }，供「逐行拖动微调」算出相对整行的偏移量。
  function withOffsets(page) {
    for (var i = 0; i < page.tokens.length; i++) {
      var t = page.tokens[i];
      t.rawX = t.x; t.rawY = t.y;
      // flow 模式记录含字间距的推进量，供界面「行框/框选」按真实间距取包围盒
      if (t.adv !== undefined) t.rawAdv = t.adv;
      else t.rawAdv = t.size;
    }
    return page;
  }
  function layout(text, paper, opts) {
    var seed = (opts && opts.seed) ? String(opts.seed) : (Math.random().toString(36).slice(2) + Date.now());
    var rng = RNG.makeRng('layout:' + seed);
    var paras = String(text).replace(/\r\n?/g, '\n').split('\n');
    var area = areaOf(paper, opts);
    var pages = [];
    var dpi = 1; // mm 空间与 dpi 无关

    if (paper.kind === 'grid') {
      var cell = paper.cell;
      var cols = Math.max(1, Math.floor(area.w / cell));
      var rows = Math.max(1, Math.floor(area.h / cell));
      var capacity = cols * 2;                     // 每格 2 单位
      var units = toUnits(paras);
      var gcn = (opts && opts.sizeCn > 0) ? opts.sizeCn : 1;   // 中文字号倍率
      var gen = (opts && opts.sizeEn > 0) ? opts.sizeEn : 1;   // 英文字号倍率
      var tcn = (opts && opts.trackCn) || 0;                   // 中文逐字间距(mm)
      var ten = (opts && opts.trackEn) || 0;                   // 英文逐字间距(mm)
      // 网格区域整体居中，得到左上角
      var gLeft = area.x + (area.w - cols * cell) / 2;
      var gTop = area.y + (area.h - rows * cell) / 2;
      var page = null, row = 0;
      function newGridPage() {
        page = { kind: 'grid', paper: paper, area: area,
          geom: { x0: gLeft + cell * 0.5, y0: gTop + cell * 0.5, left: gLeft, top: gTop, cell: cell, cols: cols, rows: rows }, tokens: [] };
        pages.push(page); row = 0;
      }
      newGridPage();
      for (var pi = 0; pi < units.length; pi++) {
        var lineTokens = wrapTokensWord(units[pi], capacity);
        for (var li = 0; li < lineTokens.length; li++) {
          if (row >= rows) newGridPage();
          var tok = lineTokens[li], used = 0, slot = 0;
          for (var ti = 0; ti < tok.length; ti++) {
            var t = tok[ti];
            if (used + t.unit > capacity) break; // 理论上 wrapTokens 已保证不超
            // 逐字间距：按已占槽位线性累加（后一列随间距整体外推，右侧自然溢出到下一页）
            var gap = (t.unit === 2 ? tcn : ten);
            // 字符占 [used, used+unit)，中心落在半格网格
            var cx = gLeft + (used + t.unit / 2) * (cell / 2) + slot * gap;
            var base = cell * (t.unit === 2 ? 0.92 : 0.80);
            var size = t.unit === 2 ? base * gcn : base * 0.87 * gen;
            var by = gTop + row * cell + cell * 0.40; // 基线
            page.tokens.push({ ch: t.ch, x: cx, y: by, size: size, unit: t.unit, line: row, offDx: 0, offDy: 0, __lineSize: size });
            used += t.unit; slot++;
          }
          row++;
        }
      }
      // 若最后一页空则丢弃（除首屏）
      if (!page.tokens.length && pages.length > 1) pages.pop();
    } else {
      // flow：横线 / 空白 / 自定义
      // 自动字号：所有非格子纸统一到「格子稿纸」的观感字号（9mm 格 ×0.92 ≈ 8.3mm），
      // 这样换成横线纸 / 空白纸 / 自定义上传纸张时，字不会突然变小。
      // 横线纸再按行高设上限，防止字顶到上下的印刷线（10mm 行→最多 8.4mm）。
      var AUTO_FS_MM = 8.3;
      var gcn2 = (opts && opts.sizeCn > 0) ? opts.sizeCn : 1;
      var gen2 = (opts && opts.sizeEn > 0) ? opts.sizeEn : 1;
      var tcn2 = (opts && opts.trackCn) || 0;   // 中文逐字间距(mm)
      var ten2 = (opts && opts.trackEn) || 0;   // 英文逐字间距(mm)
      var baseFs = (opts && opts.fontSizeMm > 0) ? opts.fontSizeMm : AUTO_FS_MM;
      if (paper.lineMm && baseFs > paper.lineMm * 0.84) baseFs = paper.lineMm * 0.84;
      // 中/英各自独立缩放：中文 = base × sizeCn，英文 = base × 0.87 × sizeEn
      // （0.87 沿用格子稿纸里中/英的字号比例，换成横线纸后不会忽大忽小）。
      // 各自再按行高设上限，防止字顶到上下印刷线。
      var fsMm = baseFs * gcn2;
      var enFsMm = baseFs * 0.87 * gen2;
      if (paper.lineMm) {
        var cap = paper.lineMm * 0.96;
        if (fsMm > cap) fsMm = cap;
        if (enFsMm > cap) enFsMm = cap;
      }
      // 整篇「形状调整」：有 flowBox 就按它排版（框内自动重排 + 只在框内分页），否则用纸张默认区域。
      var fArea = (!opts || !opts.noFlowBox) ? flowBounds(paper, opts, area) : null;
      if (!fArea) fArea = area;
      var bodyLineH = (paper.lineMm || 10.5) * ((opts && opts.lineSpacing) || 1.0);
      var enLineH = bodyLineH * 0.80;   // 纯英文行更矮，一行能多排几行（接近真人写英文的感觉）
      var indent = fsMm * 2;            // 段首缩进两字
      var pkind = paper.kind === 'custom' ? 'custom' : (paper.kind === 'line' ? 'line' : 'blank');
      // 「拉丁行」判定：该行除空格/制表符外全是英文/数字/半角 → 用矮行高；有中文或全角标点 → 用正常行高。
      function lineHeightOf(str) {
        for (var i = 0; i < str.length; i++) {
          var c = str[i];
          if (c === ' ' || c === '\t') continue;
          if (isCnChar(c.codePointAt(0), c)) return bodyLineH;
        }
        return enLineH;
      }
      var page2 = null, lineIdx2 = 0, yLine = 0;
      function newFlowPage() {
        if (page2 && page2.tokens.length) pages.push(page2);
        page2 = { kind: pkind, paper: paper, area: fArea,
          geom: { left: fArea.x, top: fArea.y, lineH: bodyLineH, linesPerPage: 0, fsMm: fsMm, flow: !!fArea.flow }, tokens: [] };
        lineIdx2 = 0; yLine = fArea.y;
      }
      // 把一条已经分好行的字符数组落成 token（行首缩进/行末悬挂开括号在此处理，与渲染位置一致）
      function emitLine(w) {
        var ind = w.indent ? indent : 0;
        var xs = fArea.x + ind;
        var content = w.items;
        var hanger = '';   // 行尾悬挂的开括号（只有它单独成段时才不悬挂）
        while (content.length > 1 && isNoLineEnd(content[content.length - 1].ch)) hanger = content.pop().ch + hanger;
        var lh = lineHeightOf(content.map(function (o) { return o.ch; }).join('') + hanger);
        // 这一行放不下（超出调整框底）→ 先换页（当前页非空才换；空页时硬放，防止框比一行还矮时死循环）
        if (page2.tokens.length && yLine + lh > fArea.y + fArea.h + 0.01) newFlowPage();
        var by = yLine + lh * 0.76;
        var x = xs;
        for (var q = 0; q < content.length; q++) {
          var o = content[q];
          if (o.ch !== ' ' && o.ch !== '\t') {
            page2.tokens.push({ ch: o.ch, x: x, y: by, size: o.full ? fsMm : enFsMm, adv: o.advT, full: o.full, line: lineIdx2, offDx: 0, offDy: 0, __lineSize: fsMm });
          }
          x += o.advT;
        }
        for (var h = 0; h < hanger.length; h++) {   // 悬挂的开括号：贴到右界外一点
          page2.tokens.push({ ch: hanger[h], x: fArea.x + fArea.w + fsMm * 0.1 + h * fsMm, y: by, size: fsMm, adv: fsMm, full: true, line: lineIdx2, offDx: 0, offDy: 0, __lineSize: fsMm });
        }
        lineIdx2++; yLine += lh;
      }
      newFlowPage();
      for (var pIdx = 0; pIdx < paras.length; pIdx++) {
        var chars = Array.from(paras[pIdx]);
        var line = { items: [], w: 0, indent: true };   // 段首缩进两字，换行后不再缩进
        var ci = 0;
        while (ci < chars.length) {
          var ch2 = chars[ci];
          var full = isCnChar(ch2.codePointAt(0), ch2);
          var mf = full ? currentFamilyCn : currentFamilyEn;
          var adv = full ? fsMm : Math.max(widthFactor(ch2, mf) * enFsMm, enFsMm * 0.30);
          var advT = adv + (full ? tcn2 : ten2);
          var indW = line.indent ? indent : 0;
          var avail = fArea.w - indW;
          // 英文整词换行：词内字符、本行已有内容、放不下 → 把该词整段挪到下一行（绝不从词中间截断）
          if (isWordChar(ch2) && line.items.length && isWordChar(line.items[line.items.length - 1].ch) && line.w + advT > avail) {
            var b = line.items.length;
            while (b > 0 && isWordChar(line.items[b - 1].ch)) b--;
            if (b > 0) {                         // 本行确实有内容 → 词整体下移
              var word = line.items.splice(b), ww = 0;
              for (var wi = 0; wi < word.length; wi++) ww += word[wi].advT;
              emitLine({ items: line.items, indent: line.indent });
              line = { items: word, w: ww, indent: false };
              continue;
            }
          }
          // 放不下 → 换行（标点悬挂：行首禁则允许略超右界）
          if (line.w + advT > avail && !isNoLineStart(ch2) && line.items.length) {
            emitLine({ items: line.items, indent: line.indent });
            line = { items: [], w: 0, indent: false };
            continue;
          }
          line.items.push({ ch: ch2, full: full, advT: advT });
          line.w += advT;
          ci++;
        }
        if (line.items.length) emitLine({ items: line.items, indent: line.indent });
      }
      if (page2 && page2.tokens.length) pages.push(page2);
    }
    if (pages.length === 0) {
      pages.push({ kind: 'blank', paper: paper, area: area, geom: {}, tokens: [] });
    }
    for (var pg = 0; pg < pages.length; pg++) withOffsets(pages[pg]);

    return { pages: pages, seed: seed, area: area, dpi: dpi };
  }

  /* ================= 纸张绘制 ================= */
  function mm2px(mm, dpi) { return mm * dpi / 25.4; }

  function paintPaper(ctx, page, dpi, rng) {
    var paper = page.paper, st = paper.style || {};
    var area = page.area;
    var W = mm2px(area.pageW, dpi), H = mm2px(area.pageH, dpi);
    ctx.save();
    ctx.fillStyle = st.paper || '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // 真实纸张照片底图（cover 铺满整页）；未就绪时回落到纯色
    var tex = texImage(st.tex);
    if (tex) {
      var ir = tex.width / tex.height, cr = W / H, dw, dh, dx, dy;
      if (ir > cr) { dh = H; dw = H * ir; dx = (W - dw) / 2; dy = 0; }
      else { dw = W; dh = W / ir; dx = 0; dy = (H - dh) / 2; }
      ctx.drawImage(tex, dx, dy, dw, dh);
    }

    // 纹理/做旧（有照片底图时不再叠加噪点，避免过脏）
    var grain = tex ? 0 : (st.grain || 0);
    if (grain > 0) {
      ctx.globalAlpha = grain;
      for (var i = 0; i < Math.min(26000, W * H / 900); i++) {
        var gx = rng() * W, gy = rng() * H;
        var s = (0.4 + rng() * 1.4) * (dpi / 300);
        var v = 90 + Math.floor(rng() * 130);
        ctx.fillStyle = 'rgb(' + v + ',' + (v - 6) + ',' + (v - 18) + ')';
        ctx.fillRect(gx, gy, s, s);
      }
      ctx.globalAlpha = 1;
    }
    // 实拍感：轻微暗角 + 暖色
    if (st.live) {
      var g = ctx.createRadialGradient(W * 0.5, H * 0.42, Math.min(W, H) * 0.25, W * 0.5, H * 0.5, Math.max(W, H) * 0.78);
      g.addColorStop(0, 'rgba(255,252,244,0.10)');
      g.addColorStop(1, 'rgba(120,104,78,0.16)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    // 折痕/卷角阴影
    if (st.crease) {
      ctx.save();
      var cg = ctx.createLinearGradient(0, H * 0.75, 0, H);
      cg.addColorStop(0, 'rgba(0,0,0,0)');
      cg.addColorStop(1, 'rgba(90,74,52,0.10)');
      ctx.fillStyle = cg; ctx.fillRect(0, H * 0.75, W, H * 0.25);
      ctx.restore();
    }
    if (st.edgeFold) {
      // 右下角折角
      var s2 = mm2px(10, dpi);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(W - s2, H - s2); ctx.lineTo(W, H - s2); ctx.lineTo(W - s2, H); ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.10)';
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    return { W: W, H: H };
  }

  // 手绘风格直线（带轻微抖动）
  function handLine(ctx, x1, y1, x2, y2, jitter, rng) {
    if (jitter <= 0) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); return; }
    var seg = 6 + Math.floor(rng() * 4);
    ctx.beginPath(); ctx.moveTo(x1, y1);
    for (var i = 1; i <= seg; i++) {
      var t = i / seg;
      var jx = (rng() - 0.5) * jitter, jy = (rng() - 0.5) * jitter;
      ctx.lineTo(x1 + (x2 - x1) * t + jx, y1 + (y2 - y1) * t + jy);
    }
    ctx.stroke();
  }

  function drawGrid(ctx, page, dpi, rng) {
    var g = page.geom, st = page.paper.style || {};
    var cellPx = mm2px(g.cell, dpi);
    // 网格左上角 = 第一格中心向左上各退半格
    var left = mm2px(g.x0 - g.cell * 0.5, dpi);
    var top = mm2px(g.y0 - g.cell * 0.5, dpi);
    var jit = st.live ? cellPx * 0.010 : 0;
    ctx.save();
    ctx.strokeStyle = st.grid || '#c0392b';
    ctx.lineWidth = Math.max(1, mm2px(st.gridWidth || 0.28, dpi));
    ctx.lineCap = 'round';
    var W = g.cols * cellPx, H = g.rows * cellPx;
    // 竖线
    for (var c = 0; c <= g.cols; c++) {
      var x = left + c * cellPx;
      handLine(ctx, x, top, x, top + H, jit, rng);
    }
    // 横线
    for (var r = 0; r <= g.rows; r++) {
      var y = top + r * cellPx;
      handLine(ctx, left, y, left + W, y, jit, rng);
    }
    // 王字/田字格内虚线：每格中央的横竖中线（浅一点、更细），是田字格的标志
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = st.grid || '#c0392b';
    ctx.lineWidth = Math.max(1, mm2px((st.gridWidth || 0.28) * 0.72, dpi));
    ctx.setLineDash([Math.max(2, cellPx * 0.16), Math.max(2, cellPx * 0.15)]);
    for (var cc = 0; cc < g.cols; cc++) {
      var cxm = left + (cc + 0.5) * cellPx;
      handLine(ctx, cxm, top, cxm, top + H, jit, rng);
    }
    for (var rr = 0; rr < g.rows; rr++) {
      var ym = top + (rr + 0.5) * cellPx;
      handLine(ctx, left, ym, left + W, ym, jit, rng);
    }
    ctx.setLineDash([]);
    ctx.restore();
    // 外框加粗
    ctx.lineWidth = Math.max(1.4, mm2px((st.gridWidth || 0.28) * 1.8, dpi));
    ctx.strokeRect(left, top, W, H);
    ctx.restore();
  }

  // 页边印刷标记：底部一条细线与居中页码，像练习本印好的页码
  var STAMP_FACE = '"HW_KaiDisplay","Kaiti SC",KaiTi,"楷体",serif';
  function drawMargin(ctx, page, dpi, idx, total) {
    var st = page.paper.style || {}, area = page.area;
    var W = mm2px(area.pageW, dpi), H = mm2px(area.pageH, dpi);
    var cx = mm2px(area.x + area.w / 2, dpi);
    // 固定在距页底 9mm 处（落在纸面下边距内，不越出纸张）
    var baseY = H - mm2px(9, dpi);
    var ink = st.grid || st.rule || '#c0392b';
    ctx.save();
    ctx.strokeStyle = ink; ctx.globalAlpha = 0.5;
    ctx.lineWidth = Math.max(1, mm2px(0.22, dpi));
    var lw = mm2px(14, dpi);
    handLine(ctx, cx - lw, baseY - mm2px(6.4, dpi), cx + lw, baseY - mm2px(6.4, dpi), 0, Math.random);
    ctx.globalAlpha = 0.85;
    var fs = mm2px(3.4, dpi);
    ctx.font = fs.toFixed(2) + 'px ' + (STAMP_FACE || '"Times New Roman",serif');
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = ink;
    ctx.fillText(String(idx + 1) + ' / ' + total, cx, baseY - mm2px(1.2, dpi));
    ctx.restore();
  }

  function drawLines(ctx, page, dpi, rng) {
    var g = page.geom, st = page.paper.style || {};
    var linePx = mm2px(g.lineH, dpi);
    var left = mm2px(page.area.x - 2, dpi);
    var right = mm2px(page.area.x + page.area.w + 2, dpi);
    var top = mm2px(page.area.y, dpi);
    var jit = st.live ? linePx * 0.006 : 0;
    ctx.save();
    ctx.strokeStyle = st.rule || '#c0392b';
    ctx.lineWidth = Math.max(1, mm2px(st.ruleWidth || 0.3, dpi));
    ctx.lineCap = 'round';
    for (var r = 0; r <= g.linesPerPage; r++) {
      var y = top + r * linePx;
      handLine(ctx, left, y, right, y, jit, rng);
    }
    // 顶部标题栏
    if (st.headerLine) {
      ctx.lineWidth = Math.max(1, mm2px((st.ruleWidth || 0.3) * 1.3, dpi));
      handLine(ctx, left, top, right, top, jit, rng);
    }
    ctx.restore();
  }

  /* ================= 手写字符渲染 ================= */
  function inkFont(sizePx, family, bold) {
    return (bold ? 'bold ' : '') + sizePx.toFixed(2) + 'px ' + family;
  }

  // 真实笔迹不是单一纯色：同一支笔每个字的墨色深浅在轻微变化。
  // 注意只做「同色深浅」抖动（三通道一起缩放），不偏移各通道——否则字与字之间
  // 会出现偏红/偏绿/偏紫的色相漂移，看起来像彩色字体。
  var _inkBase = {};
  function parseInk(hex) {
    if (_inkBase[hex]) return _inkBase[hex];
    var h = String(hex || '#1b1b22');
    if (h.charAt(0) !== '#' || h.length < 7) h = '#1b1b22';
    return (_inkBase[hex] = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  }
  // 每字一个「落笔力度」系数：整字整体深浅 + 笔锋两端略深，依旧是同色系，不偏色。
  // pressure 默认 1；0 = 完全均匀（老行为）。
  function inkColorFor(hex, rng, strength, pressure) {
    var b = parseInk(hex);
    var s = (strength === undefined || strength === false) ? 1 : strength;
    var pr = (pressure === undefined) ? 1 : pressure;
    // k：>1 略深（按得重）/ <1 略浅（落笔轻）。范围克制约 0.82~1.14。
    var k = 1 + gauss(rng) * 0.06 * s * pr;
    if (k < 0.82) k = 0.82; else if (k > 1.14) k = 1.14;
    function ci(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
    return { css: 'rgb(' + ci(b[0] * k) + ',' + ci(b[1] * k) + ',' + ci(b[2] * k) + ')', k: k };
  }
  // 判断是否「深色墨」（黑/蓝黑/深灰）——深墨才做边缘锐化，铅笔/棕墨保留柔和边
  function isDarkInk(hex) {
    var b = parseInk(hex);
    return (b[0] * 0.30 + b[1] * 0.59 + b[2] * 0.11) < 120;
  }
  // 单色 + 透明度
  function inkAlpha(hex, a) {
    var b = parseInk(hex);
    function ci(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
    return 'rgba(' + ci(b[0]) + ',' + ci(b[1]) + ',' + ci(b[2]) + ',' + a + ')';
  }

  /* ---- 墨迹颗粒（笔芯出墨不匀 / 纸张吸墨）：一张可平铺的灰噪点，再染色成墨色叠加 ----
   * 生成一次缓存。drawToken 在最上层用极低透明度叠一层，让实心笔画有"颗粒感"而非塑料感。 */
  var _grunge = { cv: null, size: 0 };
  function paperGrainTile() {
    var S = 128;
    if (_grunge.cv && _grunge.size === S) return _grunge.cv;
    var cv;
    if (typeof document === 'undefined') return null;
    cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    var c = cv.getContext('2d');
    var im = c.createImageData(S, S), d = im.data;
    var rng = RNG.makeRng('grain-tile');
    for (var i = 0; i < d.length; i += 4) {
      var v = 30 + rng() * 205;          // 亮度噪点
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    c.putImageData(im, 0, 0);
    // 轻微低通（把白噪声变成"颗粒"而不是"雪花"）
    c.globalAlpha = 0.5; c.drawImage(cv, 0, 0); c.globalAlpha = 1;
    _grunge.cv = cv; _grunge.size = S;
    return cv;
  }
  var _gpat = null, _gpatCtx = null;
  function grainPattern(ctx) {
    if (_gpat && _gpatCtx === ctx) return _gpat;
    var tile = paperGrainTile(); if (!tile) return null;
    try { _gpat = ctx.createPattern(tile, 'repeat'); _gpatCtx = ctx; } catch (e) { _gpat = null; }
    return _gpat;
  }

  // 逐字「削细」用的离屏小画布（复用以省内存；每次同步用完即贴回）
  var _tmpCv = null;
  function _tmpCanvas(w, h) {
    if (!_tmpCv) _tmpCv = document.createElement('canvas');
    var W = Math.max(2, Math.ceil(w)), H = Math.max(2, Math.ceil(h));
    if (_tmpCv.width !== W) _tmpCv.width = W;
    if (_tmpCv.height !== H) _tmpCv.height = H;
    var c = _tmpCv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    return _tmpCv;
  }

  // 深色墨（近黑）锐化：把抗锯齿的半透明灰边二值化，得到「拍摄出来那种干脆的黑」，
  // 而不是放大后一圈灰渐变的电脑字。彩色/铅笔墨保留柔和边缘（否则会显得脏）。
  function crispify(octx, gw, gh, thr) {
    var gim = octx.getImageData(0, 0, gw, gh), gd = gim.data;
    for (var i = 3; i < gd.length; i += 4) gd[i] = gd[i] < thr ? 0 : 255;
    octx.putImageData(gim, 0, 0);
  }

  function drawToken(ctx, tk, dpi, cfg, rng, drift) {
    // 归属：CJK + 中文标点 → 中文字体；ASCII 拉丁/数字 → 英文字体（两套字体分开选）
    var code = tk.ch.codePointAt(0);
    var isCJK = isCnChar(code, tk.ch);
    var family = isCJK ? (cfg.familyCn || cfg.family) : (cfg.familyEn || cfg.family);
    var sizePx = mm2px(tk.size, dpi);
    var x = mm2px(tk.x, dpi);
    var y = mm2px(tk.y, dpi);
    var d = drift || { dy: 0, dx: 0, scale: 1, alpha: 1 };

    var mess = cfg.messyRatio / 100;   // 0..1
    var cramp = cfg.charRandom / 100;  // 0..1

    // 位置抖动（凌乱度）：整行漂移 + 每字微抖 + 用户逐行拖动微调
    var jx = d.dx + gauss(rng) * mess * sizePx * 0.11 + mm2px(tk.ox || 0, dpi);
    var jy = d.dy + gauss(rng) * mess * sizePx * 0.22 + mm2px(tk.oy || 0, dpi);
    // 形变（笔画凌乱度）
    var sx = 1 + gauss(rng) * cramp * 0.16;
    var sy = 1 + gauss(rng) * cramp * 0.16;
    var rot = gauss(rng) * cramp * 0.075;
    var shear = gauss(rng) * cramp * 0.14;

    // 顿挫：每字一个「落笔力度」→ 墨色深浅 + 字形微缩放 + 收笔倾斜，都是同色系不偏色
    var pressure = (cfg.inkPressure === undefined) ? 1 : cfg.inkPressure;
    var ink = inkColorFor(cfg.inkColor, rng, cfg.inkJitter, pressure);
    var inkCol = ink.css;
    var press = clamp((ink.k - 1) * 6, -0.65, 0.65);     // 力度 -0.65..0.65
    sx *= clamp(1 + press * 0.07, 0.955, 1.045);
    sy *= clamp(1 + press * 0.07, 0.955, 1.045);
    shear += press * 0.05;
    // 顿挫的落笔轻重：**黑墨靠笔画粗细**（真实黑笔是不透明的，浓淡变化极小），
    // 只把不透明度在极小区间内微动：合成到白纸上 luma 仍在 14~33（一眼就是黑），
    // 绝不发灰。彩色墨才用较宽的透明度区间（彩色变淡≠发灰，是想要的水感）。
    var dark = isDarkInk(cfg.inkColor);
    var charAlpha = dark
      ? clamp(0.95 + press * 0.06, 0.92, 1.0)      // 黑/蓝黑：几乎不透明，纯黑为主
      : clamp(0.88 + press * 0.20, 0.74, 1.0);     // 彩色：保留较明显的浓淡

    var wv = isCJK ? (cfg.weightCn || 0) : (cfg.weightEn || 0);
    var drawAlpha = clamp(d.alpha, 0.78, 1);

    // 收笔渐隐：沿字向右下建一条线性渐变，起笔重、收笔轻。
    // 注意：只对彩色/浅墨用。**深墨（黑/蓝黑）绝不能加渐变**——实拍的黑笔是一笔纯黑，
    // 渐变会在笔画末端留出低透明的灰边，锐化(crispify)阈值又把低透明像素直接抹掉
    // → 就是你看到的「放大见灰渐变、笔画发虚」。深墨一律纯色填充。
    var fillStyle = inkCol;
    if (!dark && pressure > 0 && Math.abs(press) > 0.08) {
      var len = Math.max(4, sizePx * 0.95);
      try {
        var g2 = ctx.createLinearGradient(-len * 0.5, -len * 0.12, len * 0.5, len * 0.12);
        var hi = inkAlpha(cfg.inkColor, clamp(0.40 + press * 0.5, 0.10, 0.85));
        var lo = inkAlpha(cfg.inkColor, clamp(0.80 + press * 0.35, 0.35, 1));
        g2.addColorStop(0, lo); g2.addColorStop(1, hi);
        fillStyle = g2;
      } catch (e) { fillStyle = inkCol; }
    }

    // 单字离屏画布：所有形变、力度、锐化都在这张上做完，再整块贴回主画布。
    // 离屏的意义：贴回主画布那一刻不再抖第二个随机数——修复「同一颗种子两次导出不一样」。
    var pad = sizePx * 0.75 + 6;
    var gw = Math.ceil(sizePx * 2.4 + pad * 2), gh = Math.ceil(sizePx * 2.4 + pad * 2);
    var oc = _tmpCanvas(gw, gh), ox = gw / 2, oy = gh / 2;
    var octx = oc.getContext('2d');
    octx.lineJoin = 'round';
    octx.miterLimit = 2;
    octx.font = inkFont(sizePx, family, cfg.bold);
    octx.save();
    octx.translate(ox, oy);
    octx.textBaseline = 'alphabetic';
    octx.textAlign = 'center';
    octx.rotate(rot);
    octx.transform(1, 0, shear, 1, 0, 0);
    octx.scale(sx * d.scale, sy * d.scale);
    if (wv > 0 && !cfg.fast) {                           // 更粗：先沿外轮廓描边，再填字身（拖动快速稿跳过）
      var lw = sizePx * (wv / 100) * 0.0575;             // +20 → 约 0.0115×字号
      octx.lineWidth = lw;
      if (wv >= 16) { octx.shadowColor = inkCol; octx.shadowBlur = lw * 0.8; } // 最粗：再叠外发光
      octx.strokeStyle = fillStyle;
      octx.strokeText(tk.ch, 0, 0);
      octx.shadowBlur = 0;
    }
    octx.fillStyle = fillStyle;
    octx.fillText(tk.ch, 0, 0);
    // 顿挫（落笔重的那一下）：只在原地把笔画微微压粗，绝不位移。
    // 位移式「双印」会在字上留一条淡的错位副本，深墨锐化(crispify)又把它二值化成实黑笔
    // → 放大看就是「重影、发虚」，细笔画字体尤其明显（用户反馈）。故改为原地加重。
    if (pressure > 0 && press > 0.22 && wv >= 0) {
      octx.save();
      octx.lineJoin = 'round';
      octx.lineWidth = sizePx * 0.018 * (press - 0.2);   // 极小，只是"压重"一点点，不改字形轮廓
      octx.strokeStyle = fillStyle;
      octx.strokeText(tk.ch, 0, 0);
      octx.restore();
    }
    octx.restore();

    if (wv < 0) {
      // 更细：用 destination-out 沿外轮廓擦一圈（擦掉的是透明度，墨色不变，不会发灰）
      octx.save();
      octx.font = inkFont(sizePx, family, cfg.bold);
      octx.textBaseline = 'alphabetic'; octx.textAlign = 'center';
      octx.translate(ox, oy);
      octx.rotate(rot); octx.transform(1, 0, shear, 1, 0, 0); octx.scale(sx * d.scale, sy * d.scale);
      octx.globalCompositeOperation = 'destination-out';
      octx.lineWidth = sizePx * (0.002 + (-wv) * 0.0026);
      octx.strokeText(tk.ch, 0, 0);
      octx.restore();
      if (!cfg.fast) crispify(octx, gw, gh, 90);
    } else if (dark && !cfg.fast) {
      // 深墨：二值化边缘 → 干脆、锐利的黑（放大也不见灰渐变）。拖动快速稿跳过（getImageData 很贵）
      crispify(octx, gw, gh, 68);
    }

    // 墨迹颗粒（笔芯出墨不匀）：只叠在字形不透明处，纯叠色、不模糊，避免"塑料感色块"
    // 拖动快速稿跳过颗粒：每字一次 pattern 铺满很贵。
    if (cfg.inkTexture > 0 && !cfg.fast) {
      var pat = grainPattern(octx);
      if (pat) {
        octx.save();
        octx.globalCompositeOperation = 'source-atop';
        octx.globalAlpha = clamp(cfg.inkTexture * 0.16, 0, 1);
        octx.fillStyle = pat;
        octx.fillRect(0, 0, gw, gh);
        octx.restore();
      }
    }

    // 贴回主画布：完全不 blur、不投影。深墨靠上面的锐化边缘，已足够"实、黑、清"。
    // globalAlpha 乘上逐字力度 → 黑字也有自然的落笔轻重（顿挫）。
    ctx.save();
    ctx.globalAlpha = drawAlpha * charAlpha;
    ctx.translate(x + jx, y + jy);
    ctx.drawImage(oc, -ox, -oy);
    ctx.restore();

    // 涂改 / 勾画
    if (cfg.mistakeRate > 0) {
      var p = cfg.mistakeRate / 100 * 0.55;
      if (rng() < p) {
        ctx.save();
        ctx.strokeStyle = cfg.inkColor;
        ctx.lineWidth = Math.max(1, sizePx * 0.055);
        ctx.lineCap = 'round';
        ctx.globalAlpha = 0.92;
        var hw = sizePx * 0.62, hh = sizePx * 0.72;
        var kind = rng();
        if (kind < 0.5) {
          // 随机涂黑勾画
          var n = 2 + Math.floor(rng() * 3);
          for (var k = 0; k < n; k++) {
            ctx.beginPath();
            var a = rng() * Math.PI * 2;
            ctx.moveTo(x - hw + rng() * 2 * hw, y - hh * 0.5 + rng() * hh);
            for (var s = 0; s < 3; s++) {
              ctx.lineTo(x + (rng() - 0.5) * 2 * hw, y - hh * 0.4 + (rng() - 0.5) * hh * 1.2);
            }
            ctx.stroke();
          }
        } else {
          // 横线划掉
          ctx.beginPath();
          ctx.moveTo(x - hw, y - sizePx * 0.28 + (rng() - 0.5) * sizePx * 0.1);
          ctx.lineTo(x + hw, y - sizePx * 0.30 + (rng() - 0.5) * sizePx * 0.1);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  /* ================= 预渲染缓存（拖动性能） =================
   * 逐行拖动时若每帧重绘「纸张 + 全部字」，几百字一帧要上百毫秒（实测 240 字 108ms）。
   * 改为「纸一张 + 每行字一张」的位图缓存：建一次，之后每帧只做十几次 drawImage，
   * 无论多少字都能满帧。字形内容（含随机抖动/涂改）在建缓存时定死，与实时渲染同种子同顺序，
   * 所以「预览看到什么，导出就是什么」。
   * ---------------------------------------------------------------- */

  // 把一页的字按「行」聚合（与 app.js linesOfPage 同口径：line 未定义归到 'x'）
  function tokensByLine(page) {
    var lines = [];
    for (var i = 0; i < page.tokens.length; i++) {
      var t = page.tokens[i];
      var k = (t.line === undefined ? 'x' : t.line);
      var L = null;
      for (var j = 0; j < lines.length; j++) if (lines[j].line === k) { L = lines[j]; break; }
      if (!L) { L = { line: k, tokens: [] }; lines.push(L); }
      L.tokens.push(t);
    }
    return lines;
  }

  // 只画「纸面」：底色 + 纹理照片 + 格子/横线 + 页边，不含任何字。返回一张 canvas。
  function buildPaper(layoutRes, pageIdx, cfg, dpi) {
    var page = layoutRes.pages[pageIdx];
    var area = page.area;
    var W = Math.round(mm2px(area.pageW, dpi)), H = Math.round(mm2px(area.pageH, dpi));
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    var rng = RNG.makeRng('page:' + layoutRes.seed + ':' + pageIdx);
    if (page.paper.kind === 'custom' && cfg.customImage) {
      var img = cfg.customImage;
      var ir = img.width / img.height, cr = W / H, dw, dh, dx, dy;
      if (ir > cr) { dh = H; dw = H * ir; dx = (W - dw) / 2; dy = 0; }
      else { dw = W; dh = W / ir; dx = 0; dy = (H - dh) / 2; }
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, dx, dy, dw, dh);
    } else {
      paintPaper(ctx, page, dpi, rng);
      if (page.kind === 'grid') drawGrid(ctx, page, dpi, rng);
      else if (page.kind === 'line') drawLines(ctx, page, dpi, rng);
      if (cfg.pageNumber !== false) drawMargin(ctx, page, dpi, pageIdx, layoutRes.pages.length);
    }
    return cv;
  }

  // 每行一张「透明小图」（尺寸裁到该行包围盒，减小每帧 blit 面积）。
  // 行内每字按「零行偏移」绘制，故之后整行平移只需改 drawImage 的 dx/dy。
  // 行级漂移(k)与逐字随机(rng)的消耗顺序与 renderPage 完全一致 → 与实时渲染逐像素相同。
  function buildLineLayers(layoutRes, pageIdx, cfg, dpi) {
    var page = layoutRes.pages[pageIdx];
    var rng = RNG.makeRng('page:' + layoutRes.seed + ':' + pageIdx);
    var drng = RNG.makeRng('drift:' + layoutRes.seed + ':' + pageIdx);
    var messy = cfg.messyRatio / 100;
    var lines = tokensByLine(page);
    var layers = [];
    for (var li = 0; li < lines.length; li++) {
      var L = lines[li];
      var ft = L.tokens[0];
      // 行级漂移：口径同 renderPage（每行消耗一次 drng）
      var d = {
        dy: gauss(drng) * messy * (ft.size || 5) * 0.14,
        dx: gauss(drng) * messy * (ft.size || 5) * 0.06,
        scale: 1 + gauss(drng) * messy * 0.05,
        alpha: 1 - Math.min(0.16, Math.abs(gauss(drng)) * messy * 0.05)
      };
      // 包围盒（mm）→ px；留足字形越界与涂改笔画的余量
      var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (var q = 0; q < L.tokens.length; q++) {
        var t = L.tokens[q], s = t.size || 8.3;
        if (t.x - s * 1.4 < minX) minX = t.x - s * 1.4;
        if (t.x + s * 1.4 > maxX) maxX = t.x + s * 1.4;
        if (t.y - s * 1.5 < minY) minY = t.y - s * 1.5;
        if (t.y + s * 1.0 > maxY) maxY = t.y + s * 1.0;
      }
      var padMm = 0.8;
      var X0 = Math.floor(mm2px(minX - padMm, dpi));
      var Y0 = Math.floor(mm2px(minY - padMm, dpi));
      var X1 = Math.ceil(mm2px(maxX + padMm, dpi));
      var Y1 = Math.ceil(mm2px(maxY + padMm, dpi));
      var BW = Math.max(2, X1 - X0), BH = Math.max(2, Y1 - Y0);
      var lc = document.createElement('canvas');
      lc.width = BW; lc.height = BH;
      var lctx = lc.getContext('2d');
      lctx.translate(-X0, -Y0);   // 把绝对 px 坐标映射进本行小图
      for (var ti = 0; ti < L.tokens.length; ti++) {
        var tk = L.tokens[ti];
        var sx0 = tk.ox || 0, sy0 = tk.oy || 0;
        tk.ox = 0; tk.oy = 0;                       // 行内先按零偏移画（行偏移交给 blit）
        drawToken(lctx, tk, dpi, cfg, rng, d);
        tk.ox = sx0; tk.oy = sy0;                   // 还原 token
      }
      layers.push({ line: L.line, canvas: lc, x0: X0, y0: Y0 });
    }
    return layers;
  }

  // 一页的完整缓存：纸 + 各行小图
  function buildPageCache(layoutRes, pageIdx, cfg, dpi) {
    return { base: buildPaper(layoutRes, pageIdx, cfg, dpi), lines: buildLineLayers(layoutRes, pageIdx, cfg, dpi) };
  }

  // 用缓存渲染一页：纸 blit 一次 + 每行按「行偏移 + 整篇偏移 + 跨页项」blit。
  // 每帧只做「若干行数」次 drawImage，字数再多也快。offs 从 token 真值读，调用方无需传。
  // 跨页项 (源页 - 当前页) * 页高：把「被拖到别的页」的行画到相邻页的画布上（画到画布外会被自动裁掉），
  // 这样逐行微调能把一行拖到上一页/下一页，而不是拖出当页就凭空消失。
  // cacheFor(p) 用于取其它源页的缓存；缺省时只画本页（退回旧行为）。
  function renderWithCache(canvas, layoutRes, pageIdx, cfg, dpi, cache, cacheFor) {
    if (!cache) return renderPage(canvas, layoutRes, pageIdx, cfg, dpi);
    var page = layoutRes.pages[pageIdx];
    var area = page.area;
    var W = Math.round(mm2px(area.pageW, dpi)), H = Math.round(mm2px(area.pageH, dpi));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(cache.base, 0, 0);
    var pageH = layoutRes.area.pageH;
    var gx = (cfg.textOffset && cfg.textOffset.dx) || 0;
    var gy = (cfg.textOffset && cfg.textOffset.dy) || 0;
    var nP = layoutRes.pages.length;
    for (var p = 0; p < nP; p++) {
      var src = layoutRes.pages[p];
      // 每行当前偏移（从 token 真值读，拖动时 app.js 已更新 offDx/offDy）
      var off = {}, anyDy = false;
      for (var i = 0; i < src.tokens.length; i++) {
        var t = src.tokens[i];
        var k = (t.line === undefined ? 'x' : t.line);
        if (!off[k]) off[k] = { dx: t.offDx || 0, dy: t.offDy || 0 };
        if (t.offDy) anyDy = true;
      }
      // 别的页只有在「有纵向位移」时才可能跨到本页；没有就整页跳过（保住无微调时的速度）
      if (p !== pageIdx && !anyDy && !gy) continue;
      var c = (p === pageIdx) ? cache : (cacheFor ? cacheFor(p) : null);
      if (!c) continue;
      var crossMm = (p - pageIdx) * pageH;
      for (var j = 0; j < c.lines.length; j++) {
        var lay = c.lines[j];
        var o = off[lay.line] || { dx: 0, dy: 0 };
        var px = lay.x0 + mm2px(o.dx + gx, dpi);            // 不取整：亚像素平移，拖动更顺滑
        var py = lay.y0 + mm2px(crossMm + o.dy + gy, dpi);  // 本页时 crossMm=0，与旧行为逐像素一致
        ctx.drawImage(lay.canvas, px, py);
      }
    }
    return canvas;
  }

  /* ================= 渲染整页 ================= */
  // 渲染第 pageIdx 页到给定 canvas（canvas 尺寸会被设定为 dpi 对应像素）
  function renderPage(canvas, layoutRes, pageIdx, cfg, dpi) {
    var page = layoutRes.pages[pageIdx];
    var area = page.area;
    var W = Math.round(mm2px(area.pageW, dpi));
    var H = Math.round(mm2px(area.pageH, dpi));
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    var rng = RNG.makeRng('page:' + layoutRes.seed + ':' + pageIdx);
    // 自定义背景
    if (page.paper.kind === 'custom' && cfg.customImage) {
      var img = cfg.customImage;
      var ir = img.width / img.height, cr = W / H, dw, dh, dx, dy;
      if (ir > cr) { dh = H; dw = H * ir; dx = (W - dw) / 2; dy = 0; }
      else { dw = W; dh = W / ir; dx = 0; dy = (H - dh) / 2; }
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, dx, dy, dw, dh);
    } else {
      paintPaper(ctx, page, dpi, rng);
      if (page.kind === 'grid') drawGrid(ctx, page, dpi, rng);
      else if (page.kind === 'line') drawLines(ctx, page, dpi, rng);
      if (cfg.pageNumber !== false) drawMargin(ctx, page, dpi, pageIdx, layoutRes.pages.length);
    }

    var globalDx = (cfg.textOffset && cfg.textOffset.dx) || 0;
    var globalDy = (cfg.textOffset && cfg.textOffset.dy) || 0;
    var pageH = layoutRes.area.pageH;
    var messy = cfg.messyRatio / 100;
    // 逐字手写：先按「行」生成整体缓慢漂移（真人一行会整体起伏，而非每字乱跳）。
    var drng = RNG.makeRng('drift:' + layoutRes.seed + ':' + pageIdx);
    // 跨页项：一行被拖到相邻页后，仍画到本页画布上（越界自动裁掉）；rng/drng 按「源页」取，
    // 与单页微调时逐像素一致——所以「拖出去的行」导出/打印与预览看到的一模一样。
    for (var sp = 0; sp < layoutRes.pages.length; sp++) {
      var src = layoutRes.pages[sp];
      var shiftY = (sp - pageIdx) * pageH;
      var isHome = (sp === pageIdx);
      var sRng = isHome ? rng : RNG.makeRng('page:' + layoutRes.seed + ':' + sp);
      var sDrng = isHome ? drng : RNG.makeRng('drift:' + layoutRes.seed + ':' + sp);
      var lineMap = {};
      var showOther = !isHome && (!!globalDy);
      for (var i = 0; i < src.tokens.length; i++) {
        var tk = src.tokens[i];
        var k = (tk.line === undefined ? 'x' : tk.line);
        var d = lineMap[k];
        if (!d) {
          // 每行都消耗一次 sDrng（与 buildLineLayers 同序），保证同一行的漂移与其基础位图一致
          d = lineMap[k] = {
            dy: gauss(sDrng) * messy * (tk.size || 5) * 0.14,
            dx: gauss(sDrng) * messy * (tk.size || 5) * 0.06,
            scale: 1 + gauss(sDrng) * messy * 0.05,
            alpha: 1 - Math.min(0.16, Math.abs(gauss(sDrng)) * messy * 0.05)
          };
          // 别的页：只有该行确实有纵向位移、或整篇有 dy，才可能落到本页画布上
          d.show = isHome || showOther || !!tk.offDy;
        }
        if (!d.show) continue;
        tk.ox = (tk.offDx || 0) + globalDx;
        tk.oy = shiftY + (tk.offDy || 0) + globalDy;
        drawToken(ctx, tk, dpi, cfg, sRng, d);
      }
    }
    return canvas;
  }

  /* ================= 「整篇形状拖动」廉价预览 =================
   * 拖版面框时每次重排都会改变换行/分页，若每帧走 buildPageCache（逐字建离屏 + getImageData 锐化）
   * 一帧要上百毫秒 → 卡顿、不跟手。这里只做「纸面 blit（复用外部缓存）+ 纯 fillText 字形」的轻量整页重绘：
   * 不做离屏、不做锐化/颗粒/描边，位置/字号/逐行漂移与全质量稿同序，松手后重建即定稿。
   * 只用于拖动过程中，绝不用来导出。 */
  function renderReflowPreview(canvas, layoutRes, pageIdx, cfg, dpi, paperCanvas) {
    var page = layoutRes.pages[pageIdx];
    var area = page.area;
    var W = Math.round(mm2px(area.pageW, dpi)), H = Math.round(mm2px(area.pageH, dpi));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (paperCanvas) ctx.drawImage(paperCanvas, 0, 0);
    else { var rng0 = RNG.makeRng('page:' + layoutRes.seed + ':' + pageIdx); paintPaper(ctx, page, dpi, rng0); }

    var gx = (cfg.textOffset && cfg.textOffset.dx) || 0;
    var gy = (cfg.textOffset && cfg.textOffset.dy) || 0;
    var pageH = layoutRes.area.pageH;
    var messy = cfg.messyRatio / 100;
    var nP = layoutRes.pages.length;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    var lastFont = '';
    for (var sp = 0; sp < nP; sp++) {
      var src = layoutRes.pages[sp];
      var shiftY = (sp - pageIdx) * pageH;
      var isHome = (sp === pageIdx);
      var sRng = RNG.makeRng('page:' + layoutRes.seed + ':' + sp);
      var sDrng = RNG.makeRng('drift:' + layoutRes.seed + ':' + sp);
      var showOther = !isHome && (!!gy);
      var lineMap = {};
      for (var i = 0; i < src.tokens.length; i++) {
        var tk = src.tokens[i];
        var k = (tk.line === undefined ? 'x' : tk.line);
        var d = lineMap[k];
        if (!d) {
          d = lineMap[k] = {
            dy: gauss(sDrng) * messy * (tk.size || 5) * 0.14,
            dx: gauss(sDrng) * messy * (tk.size || 5) * 0.06,
            alpha: 1 - Math.min(0.16, Math.abs(gauss(sDrng)) * messy * 0.05)
          };
          d.show = isHome || showOther || !!tk.offDy;
        }
        if (!d.show) continue;
        var code = tk.ch.codePointAt(0);
        var isCJK = isCnChar(code, tk.ch);
        var family = isCJK ? (cfg.familyCn || cfg.family) : (cfg.familyEn || cfg.family);
        var sizePx = mm2px(tk.size, dpi);
        var jx = d.dx + gauss(sRng) * messy * sizePx * 0.11 + mm2px(tk.ox || 0, dpi);
        var jy = d.dy + gauss(sRng) * messy * sizePx * 0.22 + mm2px(tk.oy || 0, dpi);
        var ink = inkColorFor(cfg.inkColor, sRng, cfg.inkJitter, cfg.inkPressure);
        var f = inkFont(sizePx, family, cfg.bold);
        if (f !== lastFont) { ctx.font = f; lastFont = f; }
        ctx.fillStyle = ink.css;
        ctx.fillText(tk.ch, mm2px(tk.x, dpi) + jx, mm2px(tk.y + shiftY, dpi) + jy + mm2px(gy, dpi));
      }
    }
    return canvas;
  }

  /* ================= 零依赖 PDF 导出 ================= */
  // 把若干张 canvas（每页）打包成一个 PDF。使用 JPEG 压缩以控制体积。
  function canvasToJpegBytes(canvas, quality) {
    var dataUrl = canvas.toDataURL('image/jpeg', quality || 0.9);
    var b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    var bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function buildPDF(pagesData, pageWmm, pageHmm) {
    // pagesData: [{jpeg:Uint8Array, w:px, h:px}]
    var enc = [];
    function push(s) { for (var i = 0; i < s.length; i++) enc.push(s.charCodeAt(i) & 0xff); }
    function pushBytes(b) { for (var i = 0; i < b.length; i++) enc.push(b[i]); }
    var offsets = [];
    function obj(n, body) {
      offsets[n] = enc.length;
      push(n + ' 0 obj\n'); push(body); push('\nendobj\n');
    }
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    var N = pagesData.length;
    var kids = [];
    // 对象编号：1=Catalog,2=Pages,3..(3+N-1)=Page, 每页含 Contents+Image
    var firstPageObj = 3;
    var objsPerPage = 3; // Page, Contents, Image
    var total = 2 + N * objsPerPage;
    var ptW = pageWmm / 25.4 * 72, ptH = pageHmm / 25.4 * 72;

    var pageObjIds = [];
    for (var i = 0; i < N; i++) pageObjIds.push(firstPageObj + i * objsPerPage);

    // Catalog
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    // Pages
    obj(2, '<< /Type /Pages /Count ' + N + ' /Kids [' + pageObjIds.map(function (id) { return id + ' 0 R'; }).join(' ') + '] >>');

    for (var p = 0; p < N; p++) {
      var pd = pagesData[p];
      var pageId = firstPageObj + p * objsPerPage;
      var contId = pageId + 1;
      var imgId = pageId + 2;
      var contName = 'Im' + p;
      // Page
      obj(pageId, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + ptW.toFixed(2) + ' ' + ptH.toFixed(2) +
        '] /Resources << /XObject << /' + contName + ' ' + imgId + ' 0 R >> >> /Contents ' + contId + ' 0 R >>');
      // Content stream
      var content = 'q\n' + ptW.toFixed(2) + ' 0 0 ' + ptH.toFixed(2) + ' 0 0 cm\n/' + contName + ' Do\nQ\n';
      obj(contId, '<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream');
      // Image XObject
      var head = '<< /Type /XObject /Subtype /Image /Width ' + pd.w + ' /Height ' + pd.h +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + pd.jpeg.length + ' >>\nstream\n';
      offsets[imgId] = enc.length;
      push(imgId + ' 0 obj\n'); push(head); pushBytes(pd.jpeg); push('\nendstream\nendobj\n');
    }

    // xref
    var xrefStart = enc.length;
    push('xref\n0 ' + (total + 1) + '\n');
    push('0000000000 65535 f \n');
    for (var o = 1; o <= total; o++) {
      var off = offsets[o] || 0;
      var s = ('0000000000' + off).slice(-10) + ' 00000 n \n';
      push(s);
    }
    push('trailer\n<< /Size ' + (total + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF');
    return new Blob([new Uint8Array(enc)], { type: 'application/pdf' });
  }

  /* ================= 对外 API ================= */
  // 中英文两套字体，由 app 前置设定，供测量与绘制
  var currentFamilyCn = '"楷体","KaiTi",serif';
  var currentFamilyEn = currentFamilyCn;
  HW.render = {
    loadFont: loadFont,
    loadAllBundled: loadAllBundled,
    loadUiKai: loadUiKai,
    loadTextures: loadTextures,
    texImage: texImage,
    // 兼容旧签名 layout(text, paper, opts, family)；新签名传 {cn, en} 两套字体
    layout: function (text, paper, opts, family, familyEn) {
      if (family && typeof family === 'object') {
        currentFamilyCn = family.cn || currentFamilyCn;
        currentFamilyEn = family.en || currentFamilyCn;
      } else if (family) {
        currentFamilyCn = family;
        currentFamilyEn = familyEn || family;
      }
      HW.render._lastFamilyCn = currentFamilyCn;
      HW.render._lastFamilyEn = currentFamilyEn;
      return layout(text, paper, opts);
    },
    renderPage: function (canvas, res, pageIdx, cfg, dpi) {
      cfg.familyCn = cfg.familyCn || currentFamilyCn || HW.render._lastFamilyCn;
      cfg.familyEn = cfg.familyEn || currentFamilyEn || HW.render._lastFamilyEn || cfg.familyCn;
      return renderPage(canvas, res, pageIdx, cfg, dpi);
    },
    // 预渲染缓存：建一次「纸 + 每行字」的位图，拖动时用 renderWithCache 每帧只 blit
    buildPageCache: function (res, pageIdx, cfg, dpi) {
      cfg.familyCn = cfg.familyCn || currentFamilyCn || HW.render._lastFamilyCn;
      cfg.familyEn = cfg.familyEn || currentFamilyEn || HW.render._lastFamilyEn || cfg.familyCn;
      return buildPageCache(res, pageIdx, cfg, dpi);
    },
    // 只画纸面（不含字）——供「整篇形状拖动」时的快速预览复用
    buildPaper: function (res, pageIdx, cfg, dpi) {
      return buildPaper(res, pageIdx, cfg, dpi);
    },
    renderWithCache: function (canvas, res, pageIdx, cfg, dpi, cache, cacheFor) {
      cfg.familyCn = cfg.familyCn || currentFamilyCn || HW.render._lastFamilyCn;
      cfg.familyEn = cfg.familyEn || currentFamilyEn || HW.render._lastFamilyEn || cfg.familyCn;
      return renderWithCache(canvas, res, pageIdx, cfg, dpi, cache, cacheFor);
    },
    // 「整篇形状拖动」时的廉价整页预览：纸面 blit（可传已建好的纸画布）+ 纯 fillText。绝不用于导出。
    renderReflowPreview: function (canvas, res, pageIdx, cfg, dpi, paperCanvas) {
      cfg.familyCn = cfg.familyCn || currentFamilyCn || HW.render._lastFamilyCn;
      cfg.familyEn = cfg.familyEn || currentFamilyEn || HW.render._lastFamilyEn || cfg.familyCn;
      return renderReflowPreview(canvas, res, pageIdx, cfg, dpi, paperCanvas);
    },
    pagePixelSize: function (paper, dpi) {
      var a = areaOf(paper, {});
      return { w: Math.round(mm2px(a.pageW, dpi)), h: Math.round(mm2px(a.pageH, dpi)) };
    },
    canvasToJpegBytes: canvasToJpegBytes,
    buildPDF: buildPDF,
    mm2px: mm2px,
    pageSize: pageSize,
    // 默认排版区域（mm）+ 是否支持「整篇形状调整」（格子纸用印刷格，不支持）
    areaOf: areaOf,
    supportsFlowBox: function (paper) { return !!paper && paper.kind !== 'grid'; },
    // 当前整篇调整框（mm）；没调过返回默认排版区域
    flowBoxOf: function (paper, opts) {
      var a = areaOf(paper, opts || {});
      return flowBounds(paper, opts || {}, a) || { x: a.x, y: a.y, w: a.w, h: a.h };
    },
    _internals: { wrapTokens: wrapTokens, wrapTokensWord: wrapTokensWord, isFullWidth: isFullWidth, isCnChar: isCnChar, areaOf: areaOf, flowBounds: flowBounds }
  };
})(typeof window !== 'undefined' ? window : globalThis);
