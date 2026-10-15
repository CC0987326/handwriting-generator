/* ============================================================
 * 手写作业生成器 · store.js  本地配置存储层
 *
 * 解决四件事：
 *   1) 纸张背景       —— 记住「用户上次选的纸张」，启动自动套用（不再有单独的默认纸张设定）
 *   2) 方案保存       —— 6 个方案位，存/套用/重命名/清除/设为默认；导入 / 导出
 *   3) 参数还原默认   —— 由 app.js 调 defaults() 拿出厂参数
 *   4) 跨版本继承     —— 所有配置写在固定 key 的 localStorage 里，版本更新不丢；
 *                        读取时与出厂默认「合并」，新版本新增字段自动补齐、旧字段保留
 *
 * 存储 key（稳定不变，是跨版本继承的前提）：
 *   hw_cfg_v1       当前参数快照（自动保存，下次打开还原）
 *   hw_presets_v1   方案表 { slots:[6], def:索引|-1 }
 *   hw_lastpaper_v1 上次选的纸张 id（启动套用它）
 * 纸张增删/自传图仍走 catalog.js 的 hw_papers_v1（app.js 维护），这里不碰。
 * ============================================================ */
(function (root) {
  'use strict';
  var HW = root.HW = root.HW || {};

  var K_CFG = 'hw_cfg_v1';
  var K_PRESET = 'hw_presets_v1';
  var K_DEFPAPER = 'hw_defpaper_v1';     // 旧版「默认纸张」记录，仅用于启动时清掉（本版起改为「记住上次纸张」）
  var K_LASTPAPER = 'hw_lastpaper_v1';   // 上次选择的纸张 id（启动自动套用）
  var SLOTS = 6;                     // 方案位数量

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { } }

  function deepClone(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } }

  // 危险键：JSON.parse 会把 "__proto__" 当自有属性；直接 `out["__proto__"]=x` 会触发 setter 改原型（原型污染）
  function isDangerousKey(k) { return k === '__proto__' || k === 'constructor' || k === 'prototype'; }

  function isPlainObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  // 按「默认值的类型」校验候选值：类型不符就丢弃（用默认值），避免脏包把数值字段灌成字符串
  // 导致渲染层算术出 NaN → 整页空白。def 里没有的键（运行期字段如 flowBox）按值自身类型宽松接受。
  function coerceByType(defVal, val) {
    if (defVal === undefined) {                 // 默认里没有这个键：只接受标量或普通对象
      if (val === null || typeof val !== 'object') return { ok: true, v: val };
      return isPlainObj(val) ? { ok: true, v: deepClone(val) } : { ok: false };
    }
    if (isPlainObj(defVal)) {
      if (!isPlainObj(val)) return { ok: false };
      var sub = {}, sk;
      for (sk in defVal) if (Object.prototype.hasOwnProperty.call(defVal, sk)) sub[sk] = deepClone(defVal[sk]);
      for (sk in val) {
        if (!Object.prototype.hasOwnProperty.call(val, sk) || isDangerousKey(sk)) continue;
        var r = coerceByType(defVal[sk], val[sk]);
        if (r.ok) sub[sk] = r.v;
      }
      return { ok: true, v: sub };
    }
    if (typeof defVal === 'number') return isNum(val) ? { ok: true, v: val } : { ok: false };
    if (typeof defVal === 'boolean') return typeof val === 'boolean' ? { ok: true, v: val } : { ok: false };
    if (typeof defVal === 'string') return typeof val === 'string' ? { ok: true, v: val } : { ok: false };
    return { ok: false };
  }

  // 合并：出厂默认铺底（新版本新增字段自动补齐）+ 快照覆盖（仅接受类型相符的值）
  function mergeDefaults(def, saved) {
    var out = {};
    var k;
    for (k in def) if (Object.prototype.hasOwnProperty.call(def, k) && !isDangerousKey(k)) out[k] = deepClone(def[k]);
    if (!saved || typeof saved !== 'object') return out;
    for (k in saved) {
      if (!Object.prototype.hasOwnProperty.call(saved, k) || isDangerousKey(k)) continue;
      var r = coerceByType(def[k], saved[k]);
      if (r.ok) out[k] = r.v;
    }
    return out;
  }

  /* ---------------- 当前参数：自动保存 / 启动还原 ---------------- */
  // 只持久化「参数」，剥掉运行期临时对象（它们不可序列化或不该跨会话）
  var SKIP = { customImage: 1 };
  function cleanCfg(cfg) {
    var out = {};
    for (var k in cfg) {
      if (!Object.prototype.hasOwnProperty.call(cfg, k)) continue;
      if (SKIP[k]) continue;
      out[k] = cfg[k];
    }
    return out;
  }
  function saveCfg(cfg) { lsSet(K_CFG, JSON.stringify(cleanCfg(cfg))); }
  function loadCfg() {
    var raw = lsGet(K_CFG);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function clearCfg() { lsDel(K_CFG); }

  /* ---------------- 默认纸张（旧）/ 上次纸张（新） ----------------
   * 本版起不再有「设为默认纸张」的设定：启动就自动套用「用户上次选的纸张」。
   * 兼容处理：首次启动清掉旧版的「默认纸张」记录；若旧记录还在、而「上次纸张」还没写过，
   * 就把它迁移过来（老用户升级后保持原样，不会因为这次改动突然换纸）。 */
  function migrateDefPaper() {
    var old = lsGet(K_DEFPAPER);
    try {
      if (old && !lsGet(K_LASTPAPER)) {
        var o = JSON.parse(old);
        if (o && o.id) lsSet(K_LASTPAPER, String(o.id));
      }
    } catch (e) { }
    if (old) lsDel(K_DEFPAPER);   // 旧 key 用完即弃，避免以后又被迁移一次
  }
  function getLastPaper() { return lsGet(K_LASTPAPER) || ''; }
  function setLastPaper(id) { if (id) lsSet(K_LASTPAPER, String(id)); }
  function clearLastPaper() { lsDel(K_LASTPAPER); }

  /* ---------------- 方案表 ---------------- */
  function emptySlots() {
    var a = [];
    for (var i = 0; i < SLOTS; i++) a.push(null);
    return a;
  }
  function loadPresets() {
    var raw = lsGet(K_PRESET);
    var o = null;
    try { o = raw ? JSON.parse(raw) : null; } catch (e) { o = null; }
    var slots = (o && Array.isArray(o.slots)) ? o.slots.slice(0, SLOTS) : [];
    while (slots.length < SLOTS) slots.push(null);
    var def = (o && o.def !== undefined && o.def !== null && isFinite(+o.def)) ? Math.floor(+o.def) : -1;
    if (def < 0 || def >= SLOTS || !slots[def]) def = -1;
    return { slots: slots, def: def };
  }
  function savePresets(store) {
    var slots = (store.slots || []).slice(0, SLOTS);
    while (slots.length < SLOTS) slots.push(null);
    return lsSet(K_PRESET, JSON.stringify({ slots: slots, def: store.def }));
  }
  function getDefPreset() { var s = loadPresets(); return s.def >= 0 ? s.slots[s.def] : null; }
  function clearPresets() { lsDel(K_PRESET); }

  /* ---------------- 整包导入 / 导出 ----------------
   * 导出：一个 JSON，含方案表 + 默认方案指向（纸张改为「记住上次选择」，不再导出）。
   * 导入：校验后整体覆盖（调用方先确认）。返回 {ok, presets} 或 {error}。 */
  // 只导出方案表（纸张默认改为「记住上次选择」，不再作为可导出设定）
  function exportPack() {
    return {
      app: 'handwriting-generator',
      kind: 'preset-pack',
      version: 1,
      exportedAt: new Date().toISOString(),
      presets: loadPresets()
    };
  }
  // 只接受本程序导出的结构；宽松兼容「只有 slots 数组」的手写文件。
  // 返回 {ok, presets} 或 {error}；写入 localStorage 失败时如实返回 error（不再假成功）。
  function importPack(obj) {
    if (!obj || typeof obj !== 'object') return { error: '文件内容不是有效的方案包' };
    var src = obj.presets || obj;
    if (!src || !Array.isArray(src.slots)) return { error: '方案包里没有找到方案列表（slots）' };
    var slots = src.slots.slice(0, SLOTS);
    while (slots.length < SLOTS) slots.push(null);
    // 每个方案：至少要有 cfg 对象；名字裁长度、缺省补上
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      if (!s || typeof s !== 'object' || isPlainObj(s.cfg) === false) { slots[i] = null; continue; }
      var nm = (typeof s.name === 'string' && s.name.trim()) ? s.name.trim() : ('方案 ' + (i + 1));
      if (nm.length > 60) nm = nm.slice(0, 60);
      slots[i] = { name: nm, cfg: s.cfg, savedAt: (typeof s.savedAt === 'string') ? s.savedAt : '' };
    }
    var def = (src.def !== undefined && src.def !== null && isFinite(+src.def)) ? Math.floor(+src.def) : -1;
    if (def < 0 || def >= SLOTS || !slots[def]) def = -1;
    if (!savePresets({ slots: slots, def: def })) return { error: '写入本地存储失败（空间可能已满）' };
    return { ok: true, presets: { slots: slots, def: def } };
  }

  HW.store = {
    SLOTS: SLOTS,
    defaults: function () { return deepClone((HW.catalog && HW.catalog.DEFAULTS) || {}); },
    mergeDefaults: mergeDefaults,
    clone: deepClone,

    saveCfg: saveCfg, loadCfg: loadCfg, clearCfg: clearCfg,

    migrateDefPaper: migrateDefPaper,
    getLastPaper: getLastPaper, setLastPaper: setLastPaper, clearLastPaper: clearLastPaper,

    loadPresets: loadPresets, savePresets: savePresets,
    getDefPreset: getDefPreset, clearPresets: clearPresets,
    emptySlots: emptySlots,

    exportPack: exportPack, importPack: importPack
  };
})(window);
