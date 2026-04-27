/**
 * 複数 LP を localStorage で管理（サーバーなし・同一オリジンのみ）
 * @global NoCodePages
 */
(function (global) {
  "use strict";

  var REGISTRY_KEY = "lp_pages_registry_v1";
  var REGISTRY_LEGACY_KEY = "nocodeTool_pages_registry_v1";
  var LEGACY_DOC_KEY = "nocodeTool_lp_document_v2";

  (function migrateRegistryFromLegacyKey() {
    try {
      var cur = localStorage.getItem(REGISTRY_KEY);
      var old = localStorage.getItem(REGISTRY_LEGACY_KEY);
      if (!old || cur) return;
      localStorage.setItem(REGISTRY_KEY, old);
    } catch (e) {}
  })();

  function schemaVersion() {
    return typeof global.BLOCK_DOCUMENT_SCHEMA_VERSION === "number"
      ? global.BLOCK_DOCUMENT_SCHEMA_VERSION
      : 2;
  }

  function createBlankDocument() {
    return {
      schemaVersion: schemaVersion(),
      canvas: {
        widthPx: 1200,
        floorHeightPx: 480,
        backgroundColor: "#fffbf6",
        backgroundImageSrc: "",
        backgroundImageFit: "cover",
      },
      blocks: [],
    };
  }

  function makeId() {
    return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
  }

  function readRegistryRaw() {
    try {
      var raw = localStorage.getItem(REGISTRY_KEY);
      if (!raw) return { pages: [] };
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.pages)) return { pages: [] };
      return data;
    } catch (e) {
      return { pages: [] };
    }
  }

  function writeRegistry(data) {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(data));
  }

  function listPages() {
    return readRegistryRaw().pages.slice().sort(function (a, b) {
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function getPage(id) {
    if (!id) return null;
    var pages = readRegistryRaw().pages;
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].id === id) return pages[i];
    }
    return null;
  }

  function savePage(id, doc, meta) {
    if (!id || !doc) return null;
    var reg = readRegistryRaw();
    var idx = -1;
    for (var i = 0; i < reg.pages.length; i++) {
      if (reg.pages[i].id === id) {
        idx = i;
        break;
      }
    }
    var title =
      meta && meta.title
        ? String(meta.title)
        : idx >= 0
          ? reg.pages[idx].title
          : "無題のLP";
    var entry = {
      id: id,
      title: title,
      updatedAt: Date.now(),
      document: doc,
    };
    if (idx >= 0) reg.pages[idx] = entry;
    else reg.pages.push(entry);
    writeRegistry(reg);
    return entry;
  }

  function createPage(title) {
    var id = makeId();
    var doc = createBlankDocument();
    var reg = readRegistryRaw();
    reg.pages.push({
      id: id,
      title: title && String(title).trim() ? String(title).trim() : "新しいLP",
      updatedAt: Date.now(),
      document: doc,
    });
    writeRegistry(reg);
    return getPage(id);
  }

  function deletePage(id) {
    if (!id) return false;
    var reg = readRegistryRaw();
    var next = reg.pages.filter(function (p) {
      return p.id !== id;
    });
    if (next.length === reg.pages.length) return false;
    reg.pages = next;
    writeRegistry(reg);
    return true;
  }

  /**
   * タイトルのみ更新（document はそのまま）
   */
  function updatePageTitle(id, newTitle) {
    if (!id) return false;
    var reg = readRegistryRaw();
    var idx = -1;
    for (var i = 0; i < reg.pages.length; i++) {
      if (reg.pages[i].id === id) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return false;
    var t = newTitle != null ? String(newTitle).trim() : "";
    if (!t) t = "無題のLP";
    reg.pages[idx].title = t;
    reg.pages[idx].updatedAt = Date.now();
    writeRegistry(reg);
    return true;
  }

  /**
   * 旧単一キー保存を 1 件のページとして取り込む（初回のみ）
   */
  function migrateLegacyIfNeeded() {
    var reg = readRegistryRaw();
    if (reg.pages.length > 0) return false;
    var raw;
    try {
      raw = localStorage.getItem(LEGACY_DOC_KEY);
    } catch (e) {
      return false;
    }
    if (!raw) return false;
    var doc;
    try {
      doc = JSON.parse(raw);
    } catch (e) {
      return false;
    }
    if (!doc || typeof doc.schemaVersion !== "number") return false;
    var id = "migrated_" + Date.now().toString(36);
    reg.pages.push({
      id: id,
      title: "保存済みの作業（移行）",
      updatedAt: Date.now(),
      document: doc,
    });
    writeRegistry(reg);
    return true;
  }

  global.NoCodePages = {
    REGISTRY_KEY: REGISTRY_KEY,
    REGISTRY_LEGACY_KEY: REGISTRY_LEGACY_KEY,
    LEGACY_DOC_KEY: LEGACY_DOC_KEY,
    createBlankDocument: createBlankDocument,
    listPages: listPages,
    getPage: getPage,
    savePage: savePage,
    createPage: createPage,
    deletePage: deletePage,
    updatePageTitle: updatePageTitle,
    migrateLegacyIfNeeded: migrateLegacyIfNeeded,
  };
})(typeof window !== "undefined" ? window : this);
