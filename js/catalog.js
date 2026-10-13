/* ============================================================
 * 手写作业生成器 · catalog.js
 * 字体 / 纸张 / 默认参数 / 可复现随机数引擎 / 中文避头尾字符集
 * 纯浏览器全局脚本，无任何依赖。挂载到 window.HW
 * ============================================================ */
(function (root) {
  'use strict';

  /* -------------------- 可复现随机数 (mulberry32) -------------------- */
  function xmur3(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return h >>> 0;
    };
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seedStr) {
    var seed = xmur3(String(seedStr));
    return mulberry32(seed());
  }

  /* -------------------- 中文避头尾字符集 ----------------------
   * 行首禁用：这些标点不能出现在一行的开头（要挤到上一行行尾）
   * 行尾禁用：这些开括号不能出现在一行末尾（要推到下一行行首）
   * ---------------------------------------------------------- */
  // 行首禁则（避头）：收尾标点 / 后括号
  var NO_LINE_START = '，。、；：？！）］｝〉》」』】〕"\'%‰℃′″…—·,.;:?!)]}〉》';
  // 行尾禁则（避尾）：起首标点 / 前括号
  var NO_LINE_END = '（［｛〈《「『【〔([{〈《';

  /* -------------------- 字体表 --------------------
   * 只保留手写字体（kind 全部为 'bundled'，随程序分发，通过 FontFace 注册，family 用 id 做别名）。
   * 来源：找字网 zhaozi.cn 免费商用专区 · 洋芋田 potatofield.cn 字体库 · 我的定稿。
   * 按需加载：中文字体较大(3~25MB)，被选中时才拉取，避免一次性加载上百 MB。
   * ---------------------------------------------------------- */
  var FONTS = [
    // ===== 手写字体 =====
    // 仅保留「全简体覆盖」手写体：实测常用字 + 中文标点 100% 命中原字体，
    // 绝不回落到系统字体（否则会出现「同一句里部分字不是该字体」）。
    // 已剔除：仅繁体字库(辰宇落雁体·细/清松手写体)·繁体向字库(道须/851马克/衡山/英椎/佑字/刻石录等，
    // 缺「这/说/时/长」等常用简体字)·非手写或重复(沐瑶/演示/汉仪/cjkfonts 等)。
    { id: 'hw_XiaoXiangziRongyao', name: '小箱子荣耀体', kind: 'bundled', file: 'fonts/handwriting/cn/XiaoXiangziRongyao.ttf', family: 'HW_XiaoXiangziRongyao', group: '手写·中文' },
    { id: 'hw_HanchanShouzhuo', name: '寒蝉手拙体', kind: 'bundled', file: 'fonts/handwriting/cn/HanchanShouzhuo.ttf', family: 'HW_HanchanShouzhuo', group: '手写·中文' },
    { id: 'hw_WangQiangShouxie', name: '王强手写体', kind: 'bundled', file: 'fonts/handwriting/cn/WangQiangShouxie.ttf', family: 'HW_WangQiangShouxie', group: '手写·中文' },
    { id: 'hw_XinyeNianti', name: '新叶念体', kind: 'bundled', file: 'fonts/handwriting/cn/XinyeNianti.otf', family: 'HW_XinyeNianti', group: '手写·中文' },
    { id: 'hw_HongleiBanshu', name: '鸿雷板书简体', kind: 'bundled', file: 'fonts/handwriting/cn/HongleiBanshu.ttf', family: 'HW_HongleiBanshu', group: '手写·板书' },
    { id: 'hw_QiantuBifeng', name: '千图笔锋手写体', kind: 'bundled', file: 'fonts/handwriting/cn/QiantuBifeng.ttf', family: 'HW_QiantuBifeng', group: '手写·中文' },
    { id: 'hw_PingFangShaoHua', name: '平方韶华体', kind: 'bundled', file: 'fonts/handwriting/cn/PingFangShaoHuaTi.ttf', family: 'HW_PingFangShaoHua', group: '手写·中文' },
    { id: 'hw_LikeJianJianTi', name: '栗壳坚坚体', kind: 'bundled', file: 'fonts/handwriting/cn/LikeJianJianTi.ttf', family: 'HW_LikeJianJianTi', group: '手写·中文' },
    { id: 'cn_yozai', name: '悠哉手写（我的定稿）', kind: 'bundled', file: 'fonts/handwriting/cn/Yozai-Regular.ttf', family: 'HW_Yozai', group: '手写·中文' },
    { id: 'hw_PippaHandwriting', name: 'Pippa Handwriting', kind: 'bundled', file: 'fonts/handwriting/en/PippaHandwriting.ttf', family: 'HW_PippaHandwriting', group: '手写·英文' },
    { id: 'hw_Brusher', name: 'Brusher', kind: 'bundled', file: 'fonts/handwriting/en/Brusher.otf', family: 'HW_Brusher', group: '手写·英文' },
    { id: 'hw_SimpleScript', name: 'Simple Script', kind: 'bundled', file: 'fonts/handwriting/en/SimpleScript.ttf', family: 'HW_SimpleScript', group: '手写·英文' },
    { id: 'hw_SignaturaMonoline', name: 'Signatura Monoline', kind: 'bundled', file: 'fonts/handwriting/en/SignaturaMonoline.otf', family: 'HW_SignaturaMonoline', group: '手写·英文' },
    { id: 'hw_PlaylistScript', name: 'Playlist Script', kind: 'bundled', file: 'fonts/handwriting/en/PlaylistScript.otf', family: 'HW_PlaylistScript', group: '手写·英文' },
    { id: 'hw_CuteAurora', name: 'Cute Aurora', kind: 'bundled', file: 'fonts/handwriting/en/CuteAurora.ttf', family: 'HW_CuteAurora', group: '手写·英文' },
    { id: 'hw_Kalmansk', name: 'Kalmansk', kind: 'bundled', file: 'fonts/handwriting/en/Kalmansk.otf', family: 'HW_Kalmansk', group: '手写·英文' },
    { id: 'hw_OneDay', name: 'One Day', kind: 'bundled', file: 'fonts/handwriting/en/OneDay.otf', family: 'HW_OneDay', group: '手写·英文' },
    { id: 'hw_ZhiyongWrite', name: 'Zhiyong Write', kind: 'bundled', file: 'fonts/handwriting/en/ZhiyongWrite.ttf', family: 'HW_ZhiyongWrite', group: '手写·英文' },
    { id: 'en_kalam', name: 'Kalam（我的定稿·英文）', kind: 'bundled', file: 'fonts/handwriting/en/Kalam-Regular.ttf', family: 'HW_Kalam', group: '手写·英文' },
    { id: 'hw_ArchitectsDaughter', name: "Architects Daughter", kind: 'bundled', file: 'fonts/handwriting/en/ArchitectsDaughter.ttf', family: 'HW_ArchitectsDaughter', group: '手写·英文' },
    { id: 'hw_PatrickHand', name: 'Patrick Hand', kind: 'bundled', file: 'fonts/handwriting/en/PatrickHand.ttf', family: 'HW_PatrickHand', group: '手写·英文' },
    { id: 'hw_Caveat', name: 'Caveat', kind: 'bundled', file: 'fonts/handwriting/en/Caveat.ttf', family: 'HW_Caveat', group: '手写·英文' },
    { id: 'hw_Neucha', name: 'Neucha', kind: 'bundled', file: 'fonts/handwriting/en/Neucha.ttf', family: 'HW_Neucha', group: '手写·英文' },
    { id: 'hw_EduAUVICWANTHand', name: 'Edu AU VIC WA NT Hand', kind: 'bundled', file: 'fonts/handwriting/en/EduAUVICWANTHand.ttf', family: 'HW_EduAUVICWANTHand', group: '手写·英文' },
    { id: 'hw_ShadowsIntoLight', name: 'Shadows Into Light', kind: 'bundled', file: 'fonts/handwriting/en/ShadowsIntoLight.ttf', family: 'HW_ShadowsIntoLight', group: '手写·英文' },
    { id: 'hw_Handlee', name: 'Handlee', kind: 'bundled', file: 'fonts/handwriting/en/Handlee.ttf', family: 'HW_Handlee', group: '手写·英文' },
    { id: 'hw_JustAnotherHand', name: 'Just Another Hand', kind: 'bundled', file: 'fonts/handwriting/en/JustAnotherHand.ttf', family: 'HW_JustAnotherHand', group: '手写·英文' }
  ];

  /* -------------------- 纸张表 --------------------
   * more: true 表示「不怎么用到」的次要纸张，界面里折叠进「更多纸张」。
   * kind: 'grid' 格子纸 / 'line' 横线纸 / 'blank' 空白纸 / 'custom' 自定义上传图
   * page: A4 / B5 / A3  (单位 mm)
   * orientation: 'portrait' 纵向 / 'landscape' 横向
   * 格子纸: cell 格子边长(mm)；cols×rows 每页字数
   * 横线纸: lineMm 行高(mm)
   * margins: 上右下左(mm)
   * style: 颜色等
   * ---------------------------------------------------------- */
  var PAGE = { A4: [210, 297], B5: [176, 250], A3: [297, 420] };

  var PAPERS = [
    // ===== 实拍纸张（用户拍摄，已转正裁成 A4 纵向）· 置顶 =====
    { id: 'tex_cnbook', name: '实拍·语文作业本', kind: 'blank', page: 'A4', orientation: 'portrait',
      margins: { t: 24, r: 22, b: 22, l: 22 }, style: { paper: '#fdfbf7', tex: 'cnbook', grain: 0 } },
    { id: 'tex_hnkj_letter', name: '实拍·河南科技大学信稿纸', kind: 'blank', page: 'A4', orientation: 'portrait',
      margins: { t: 40, r: 22, b: 20, l: 22 }, style: { paper: '#fcfcf8', tex: 'hnkj_letter', grain: 0 } },
    { id: 'tex_hnkj_report', name: '实拍·河南科技大学实验报告', kind: 'blank', page: 'A4', orientation: 'portrait',
      margins: { t: 30, r: 24, b: 24, l: 24 }, style: { paper: '#eef3ea', tex: 'hnkj_report', grain: 0 } },

    // ===== 格子稿纸 =====
    //  tex: 底图纹理（见 js/textures.js 内嵌的真实纸张照片）；grain 与 tex 不叠加
    { id: 'grid_red_live', name: '红格子稿纸(400字/页)', kind: 'grid', page: 'A4', orientation: 'portrait',
      cell: 9.0, cols: 20, rows: 20, margins: { t: 22, r: 20, b: 18, l: 20 },
      style: { paper: '#f7f2e6', tex: 'cream', grid: '#c0392b', gridWidth: 0.28, live: true, edgeFold: true } },
    { id: 'grid_red_print', name: '可打印·红格子稿纸(400字/页)', kind: 'grid', page: 'A4', orientation: 'portrait',
      cell: 9.0, cols: 20, rows: 20, margins: { t: 22, r: 20, b: 18, l: 20 },
      style: { paper: '#ffffff', grain: 0, grid: '#d23a2c', gridWidth: 0.26 } },
    { id: 'grid_black_print', name: '可打印·黑格子稿纸(400字/页)', kind: 'grid', page: 'A4', orientation: 'portrait',
      cell: 9.0, cols: 20, rows: 20, margins: { t: 22, r: 20, b: 18, l: 20 },
      style: { paper: '#ffffff', grain: 0, grid: '#333333', gridWidth: 0.26 } },

    // ===== 信稿纸（单红线）=====
    { id: 'line_red_live', name: '单红线信稿纸', kind: 'line', page: 'A4', orientation: 'portrait',
      lineMm: 10.5, margins: { t: 24, r: 22, b: 20, l: 22 },
      style: { paper: '#f8f3e8', tex: 'white', rule: '#c0392b', ruleWidth: 0.3, live: true, headerLine: true } },
    { id: 'line_red_print', name: '可打印·单红线A4信稿纸', kind: 'line', page: 'A4', orientation: 'portrait',
      lineMm: 10.0, margins: { t: 22, r: 20, b: 18, l: 20 },
      style: { paper: '#ffffff', grain: 0, rule: '#c0392b', ruleWidth: 0.3 } },
    { id: 'line_red_wide', name: '可打印·单红线信稿纸(宽边距)', kind: 'line', page: 'A4', orientation: 'portrait',
      lineMm: 12.0, margins: { t: 30, r: 30, b: 28, l: 30 },
      style: { paper: '#ffffff', grain: 0, rule: '#c0392b', ruleWidth: 0.3 } },

    // ===== 纹理纸（纯照片底图，无印刷线）=====
    { id: 'tex_white', name: '白纸纹理', kind: 'blank', page: 'A4', orientation: 'portrait',
      margins: { t: 24, r: 22, b: 22, l: 22 }, style: { paper: '#ffffff', tex: 'white' } },
    { id: 'tex_cream', more: true, name: '米色纸纹理', kind: 'blank', page: 'A4', orientation: 'portrait',
      margins: { t: 24, r: 22, b: 22, l: 22 }, style: { paper: '#f7f2e6', tex: 'cream' } },
    { id: 'tex_kraft', more: true, name: '牛皮纸纹理', kind: 'blank', page: 'A4', orientation: 'portrait',
      margins: { t: 24, r: 22, b: 22, l: 22 }, style: { paper: '#d8c3a0', tex: 'kraft' } },
    { id: 'tex_aged', more: true, name: '做旧纸纹理', kind: 'blank', page: 'A4', orientation: 'portrait',
      margins: { t: 24, r: 22, b: 22, l: 22 }, style: { paper: '#e8e0cc', tex: 'aged' } },

    // ===== 草稿纸 / 空白打印纸 =====
    { id: 'draft_live', more: true, name: '草稿纸·做旧实拍', kind: 'blank', page: 'A4', orientation: 'portrait',
      margins: { t: 20, r: 18, b: 18, l: 18 },
      style: { paper: '#efe9dd', tex: 'aged', crease: true } },
    { id: 'a4_p', more: true, name: '可打印·A4纸·纵向', kind: 'blank', page: 'A4', orientation: 'portrait',
      margins: { t: 25, r: 22, b: 22, l: 22 }, style: { paper: '#ffffff', grain: 0 } },
    { id: 'a4_l', more: true, name: '可打印·A4纸·横向', kind: 'blank', page: 'A4', orientation: 'landscape',
      margins: { t: 22, r: 25, b: 22, l: 25 }, style: { paper: '#ffffff', grain: 0 } },
    { id: 'b5_p', more: true, name: '可打印·B5纸·纵向', kind: 'blank', page: 'B5', orientation: 'portrait',
      margins: { t: 22, r: 20, b: 20, l: 20 }, style: { paper: '#ffffff', grain: 0 } },
    { id: 'b5_l', more: true, name: '可打印·B5纸·横向', kind: 'blank', page: 'B5', orientation: 'landscape',
      margins: { t: 20, r: 22, b: 20, l: 22 }, style: { paper: '#ffffff', grain: 0 } },
    { id: 'a3_p', more: true, name: '可打印·A3纸·纵向', kind: 'blank', page: 'A3', orientation: 'portrait',
      margins: { t: 28, r: 25, b: 25, l: 25 }, style: { paper: '#ffffff', grain: 0 } },
    { id: 'a3_l', more: true, name: '可打印·A3纸·横向', kind: 'blank', page: 'A3', orientation: 'landscape',
      margins: { t: 25, r: 28, b: 25, l: 28 }, style: { paper: '#ffffff', grain: 0 } },

    // ===== 自定义 =====
    { id: 'custom', name: '自定义背景(上传图片)', kind: 'custom', page: 'A4', orientation: 'portrait',
      margins: { t: 20, r: 20, b: 20, l: 20 }, style: { paper: '#ffffff', grain: 0 } }
  ];

  /* -------------------- 默认参数 -------------------- */
  var DEFAULTS = {
    fontIdCn: 'hw_XiaoXiangziRongyao',  // 中文字体（写中文/标点）· 默认小箱子荣耀体
    fontIdEn: 'en_kalam',   // 英文字体（写数字/拉丁字母）· 默认 Kalam
    paperId: 'tex_hnkj_letter',
    fontSizeMm: 0,          // 0 = 按纸张自动
    sizeCn: 1,              // 中文字号倍率（1 = 默认）
    sizeEn: 1,              // 英文字号倍率（1 = 默认）
    trackCn: 0,             // 中文逐字间距(mm，负=更紧，正=更松)
    trackEn: 0,             // 英文/数字逐字间距(mm)
    weightCn: 0,            // 中文笔画粗细（0 = 标准，0~60）
    weightEn: 0,            // 英文笔画粗细（0 = 标准，0~60）
    lineSpacing: 1,         // 横线纸行距倍数
    inkColor: '#0d0e12',    // 黑色中性笔真实墨色（比纯黑略暖、落地后不发灰）
    inkJitter: true,        // 逐字墨色/深浅自然变化
    inkPressure: 1,         // 落笔顿挫（起收笔深浅/粗细变化）0~2
    inkTexture: 0.4,        // 墨迹颗粒质感（笔芯出墨不匀）0~1
    bold: false,
    pageNumber: false,      // 页边印页码（默认关，保持纸张原貌；可勾选打开）
    mistakeRate: 0,         // 随机勾画涂改概率 0-100（默认 0：干净无涂改）
    messyRatio: 10,         // 文字位置凌乱度 0-100
    charRandom: 5,          // 字体笔画凌乱度 0-100
    dpi: 300,               // 150 / 300 / 600
    seed: '',               // 空 = 随机种子；可固定以复现
    marginMm: -1,           // -1 = 用纸张默认边距
    textOffset: { dx: 0, dy: 0 } // 整篇文字整体微调（单位 mm，所有页一起移动）
  };

  root.HW = root.HW || {};

  /* 应用版本号（单一出处）：更新检查拿它跟 GitHub 最新 Release 比。
   * 发新版时改这里 + package.json 的 version + launcher/App.cs 的 AppVer。 */
  root.HW.appVersion = '1.3.4';

  /* 用户对纸张的增删记录（app.js 读它、改 PAPERS，再写回 localStorage）：
   *   removed: [内置纸张 id]         —— 被删掉的内置纸
   *   custom:  [纸张对象]            —— 用户自己加的（含 uploaded:true 的上传背景）
   * PAPERS 是「内置默认表」，app.js 启动时会在它基础上套用上述增删。 */
  var USER_PAPER_KEY = 'hw_papers_v1';

  root.HW.catalog = {
    FONTS: FONTS, PAPERS: PAPERS, DEFAULTS: DEFAULTS, PAGE: PAGE,
    NO_LINE_START: NO_LINE_START, NO_LINE_END: NO_LINE_END,
    USER_PAPER_KEY: USER_PAPER_KEY
  };
  root.HW.rng = { makeRng: makeRng, xmur3: xmur3, mulberry32: mulberry32 };
})(typeof window !== 'undefined' ? window : globalThis);
