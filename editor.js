import { createInitialEditorState, editorLimits } from "./state.js";
import {
  applyCanvasWorkWidthStyle,
  clampCanvasHeightValue,
  clampCanvasWidthValue,
} from "./renderer.js";

(function () {
  "use strict";

  /* ブロック JSON のキー・型は block-document-schema.js の固定仕様に合わせること */

  const DRAG_THRESHOLD = 4;

  const canvas = document.getElementById("canvas");
  const propsEmpty = document.getElementById("props-empty");
  const propsForm = document.getElementById("props-form");
  const layerList = document.getElementById("layer-list");
  const layersEmpty = document.getElementById("layers-empty");
  const layerDeleteSelectedBtn = document.getElementById("layer-delete-selected");
  const layerDuplicateSelectedBtn = document.getElementById("layer-duplicate-selected");
  const canvasWidthInput = document.getElementById("canvas-width-input");
  const canvasHeightInput = document.getElementById("canvas-height-input");
  const canvasBgColorInput = document.getElementById("canvas-bg-color-input");
  const canvasBgColorHexInput = document.getElementById("canvas-bg-color-hex-input");
  const canvasBgImageUrlInput = document.getElementById("canvas-bg-image-url");
  const canvasBgImageFileInput = document.getElementById("canvas-bg-image-file");
  const canvasBgImageClearBtn = document.getElementById("canvas-bg-image-clear");
  const canvasBgFitSelect = document.getElementById("canvas-bg-fit-select");
  const persistStatusEl = document.getElementById("persist-status");
  const persistSaveNowBtn = document.getElementById("persist-save-now");
  const persistLoadBtn = document.getElementById("persist-load");
  const persistDownloadBtn = document.getElementById("persist-download-json");
  const persistBrowseJsonBtn = document.getElementById("persist-browse-json");
  const persistFileImportInput = document.getElementById("persist-file-import");
  const persistClearLocalBtn = document.getElementById("persist-clear-local");
  const persistNewDocumentBtn = document.getElementById("persist-new-document");

  const {
    CANVAS_WIDTH_MIN,
    CANVAS_WIDTH_MAX,
    CANVAS_HEIGHT_MIN,
    CANVAS_HEIGHT_MAX,
    CANVAS_PADDING_BOTTOM,
    CONTAINER_RESIZE_MIN_W,
    CONTAINER_RESIZE_MIN_H,
    BLOCK_RESIZE_MIN_TEXT_W,
    BLOCK_RESIZE_MIN_TEXT_H,
    BLOCK_RESIZE_MIN_IMG_W,
    BLOCK_RESIZE_MIN_IMG_H,
    BLOCK_RESIZE_MIN_BTN_W,
    BLOCK_RESIZE_MIN_BTN_H,
    CONTACT_FORM_MIN_W,
    CONTACT_FORM_MIN_H,
    CLIPBOARD_BLOCK_KIND,
    PASTE_POSITION_OFFSET,
    LOCAL_STORAGE_DOC_KEY,
    SNAP_GUIDE_THRESHOLD_PX,
    VIEWPORT_DESKTOP,
    VIEWPORT_RESPONSIVE,
    RESPONSIVE_DEFAULT_CANVAS_WIDTH_PX,
  } = editorLimits;

  /** localStorage に書く LP ドキュメントの論理バージョン（schemaVersion とは別） */
  const PERSIST_DATA_VERSION = 1;

  const LEGACY_CANVAS_STORAGE_KEYS_IN_ORDER = [
    "savedTemplate",
    "nocodeTool_lp_document_v4",
    "nocodeTool_lp_document_v3",
  ];

  const LEGACY_KEYS_TO_PURGE = [
    "savedTemplate",
    "nocodeTool_lp_document_v3",
    "nocodeTool_lp_document_v4",
    "nocodeTool_pages_registry_v1",
  ];

  /** `?page=` が無いときも「今すぐ保存」で管理画面・lp.html に載せるための紐づけページ ID */
  const PUBLISH_PAGE_LINK_KEY = "nocode_editor_publish_page_link_v1";

  const initialState = createInitialEditorState();

  let idSeq = initialState.idSeq;
  /** 管理画面から開いたときのページ ID（保存時に NoCodePages にも書き込む） */
  let currentPageId = initialState.currentPageId;
  let internalClipboard = initialState.internalClipboard;
  let canvasWorkWidthPx = initialState.canvasWorkWidthPx;
  let canvasFloorHeightPx = initialState.canvasFloorHeightPx;
  let canvasBgColor = initialState.canvasBgColor;
  let canvasBgImageSrc = initialState.canvasBgImageSrc;
  let canvasBgFit = initialState.canvasBgFit;
  let selectedBlocks = initialState.selectedBlocks;
  let dragState = initialState.dragState;
  let hoverMeasureRaf = initialState.hoverMeasureRaf;
  let pendingHoverBlock = initialState.pendingHoverBlock;
  let layerDragSourceBlock = initialState.layerDragSourceBlock;
  let selectionReferenceBlockId = null;
  /** レイヤーパネル: 開いているコンテナID（renderLayers 再描画後も保持） */
  const layerOpenContainerIds = new Set();
  /** 保存 JSON の activeTemplateKey と同期（テーマ表示・シリアライズ用） */
  let editorActiveTemplateKey = null;

  /** 保存単位: desktop / responsive それぞれ { canvas, blocks } */
  let viewportsCache = {
    desktop: null,
    responsive: null,
  };
  let editingViewport = VIEWPORT_DESKTOP;

  function deepCloneJson(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function isLikelySavedCanvasDocument(doc) {
    return doc && typeof doc === "object" && typeof doc.schemaVersion === "number";
  }

  /** 単一キーが空のとき、列挙順で最初に見つかった旧キーの JSON を lp_data_v1 に移し version を付与する */
  function migrateLegacyCanvasKeysIntoUnifiedStorageIfEmpty() {
    try {
      if (localStorage.getItem(LOCAL_STORAGE_DOC_KEY)) return;
    } catch (err) {
      return;
    }
    for (let i = 0; i < LEGACY_CANVAS_STORAGE_KEYS_IN_ORDER.length; i++) {
      let raw;
      try {
        raw = localStorage.getItem(LEGACY_CANVAS_STORAGE_KEYS_IN_ORDER[i]);
      } catch (err) {
        continue;
      }
      if (!raw || typeof raw !== "string") continue;
      let doc;
      try {
        doc = JSON.parse(raw);
      } catch (err) {
        continue;
      }
      if (!isLikelySavedCanvasDocument(doc)) continue;
      const merged = Object.assign({}, doc, { version: PERSIST_DATA_VERSION });
      try {
        localStorage.setItem(LOCAL_STORAGE_DOC_KEY, JSON.stringify(merged));
      } catch (err) {
        return;
      }
      return;
    }
  }

  function purgeLegacyPersistenceKeysListed() {
    for (let j = 0; j < LEGACY_KEYS_TO_PURGE.length; j++) {
      try {
        localStorage.removeItem(LEGACY_KEYS_TO_PURGE[j]);
      } catch (err) {}
    }
  }

  /** ページ読み込み時に一度: 移行 → 旧キー削除（pages-storage のレジストリ移行より後でよい） */
  function initUnifiedLpLocalStorageOnce() {
    migrateLegacyCanvasKeysIntoUnifiedStorageIfEmpty();
    purgeLegacyPersistenceKeysListed();
  }

  function normalizeViewportSlice(raw) {
    if (!raw || typeof raw !== "object") {
      return { canvas: {}, blocks: [] };
    }
    return {
      canvas: raw.canvas && typeof raw.canvas === "object" ? raw.canvas : {},
      blocks: Array.isArray(raw.blocks) ? raw.blocks.slice() : [],
    };
  }

  function viewportSliceHasNoBlocks(vp) {
    const b = vp && vp.blocks;
    return !Array.isArray(b) || b.length === 0;
  }

  /** 保存 JSON（単一 canvas または dualViewport）にブロックが1つも無いか */
  function persistedDocumentHasNoBlocks(doc) {
    if (!doc || typeof doc !== "object") return true;
    if (
      doc.layoutMode === "dualViewport" &&
      doc.viewports &&
      doc.viewports.desktop &&
      doc.viewports.responsive
    ) {
      const d = doc.viewports.desktop.blocks;
      const r = doc.viewports.responsive.blocks;
      const dl = Array.isArray(d) ? d.length : 0;
      const rl = Array.isArray(r) ? r.length : 0;
      return dl === 0 && rl === 0;
    }
    const b = doc.blocks;
    return !Array.isArray(b) || b.length === 0;
  }

  /** 白紙なのに activeTemplateKey だけ残るとリロード後も同じテンプレ名が付く。JSON を直す。 */
  function stripActiveTemplateKeyFromDocIfNoBlocks(doc) {
    if (!doc || typeof doc !== "object") return false;
    if (!persistedDocumentHasNoBlocks(doc)) return false;
    if (doc.activeTemplateKey == null || doc.activeTemplateKey === "") return false;
    doc.activeTemplateKey = null;
    return true;
  }

  function hydrateViewportsFromRootDoc(doc) {
    if (
      doc.layoutMode === "dualViewport" &&
      doc.viewports &&
      doc.viewports.desktop &&
      doc.viewports.responsive
    ) {
      viewportsCache.desktop = normalizeViewportSlice(doc.viewports.desktop);
      viewportsCache.responsive = normalizeViewportSlice(doc.viewports.responsive);
      editingViewport =
        doc.editingViewport === VIEWPORT_RESPONSIVE ? VIEWPORT_RESPONSIVE : VIEWPORT_DESKTOP;
      return;
    }
    const slice = normalizeViewportSlice({ canvas: doc.canvas, blocks: doc.blocks });
    viewportsCache.desktop = deepCloneJson(slice);
    viewportsCache.responsive = deepCloneJson(slice);
    const desktopW =
      typeof slice.canvas.widthPx === "number" && !isNaN(slice.canvas.widthPx)
        ? slice.canvas.widthPx
        : 1200;
    const rw = Math.min(RESPONSIVE_DEFAULT_CANVAS_WIDTH_PX, Math.max(CANVAS_WIDTH_MIN, desktopW));
    viewportsCache.responsive.canvas = Object.assign({}, viewportsCache.responsive.canvas, {
      widthPx: clampCanvasWidthValue(rw, rw, CANVAS_WIDTH_MIN, CANVAS_WIDTH_MAX),
    });
    editingViewport = VIEWPORT_DESKTOP;
  }

  function effectiveContactFormMinW() {
    const cap = Math.floor(canvasWorkWidthPx - 24);
    if (!isFinite(cap) || cap < 1) {
      return CONTACT_FORM_MIN_W;
    }
    return Math.min(CONTACT_FORM_MIN_W, Math.max(200, cap));
  }

  /** 美容サロン JSON ヒーロー画像（templates/salon.*.json）— JSON 変更なしで body にクラスを付与 */
  const SALON_HERO_IMG_FINGERPRINT = "photo-1560066984";
  /** カフェテンプレ・ヒーロー（cafe.*.json と一致） */
  const CAFE_HERO_IMG_FINGERPRINT = "photo-1495474472287";
  /** サプリメント販売LP・ヒーロー（supplement.*.json と一致） */
  const SUPPLEMENT_HERO_IMG_FINGERPRINT = "photo-1587854692152";
  const ACTIVE_TEMPLATE_STORAGE_KEY = "nocode_editor_active_template_key";
  /** サプリメント販売LPが localStorage 復元で毎回出る問題のワンタイム解除（一度だけ実行） */
  const SUPPLEMENT_STICKY_PURGE_FLAG = "nocode_editor_supplement_sticky_purge_v1";

  const TEMPLATE_JSON_MAP = {
    beautySalon: { desktop: "templates/salon.desktop.json", mobile: "templates/salon.mobile.json" },
    cafe: { desktop: "templates/cafe.desktop.json", mobile: "templates/cafe.mobile.json" },
    productSalesStory: {
      desktop: "templates/supplement.desktop.json",
      mobile: "templates/supplement.mobile.json",
    },
    corporate: { desktop: "templates/corporate.desktop.json", mobile: "templates/corporate.mobile.json" },
    portfolio: { desktop: "templates/portfolio.desktop.json", mobile: "templates/portfolio.mobile.json" },
  };
  const TEMPLATE_LABEL_MAP = {
    beautySalon: "美容サロン",
    cafe: "カフェ",
    productSalesStory: "サプリメント販売LP",
    corporate: "コーポレートLP",
    portfolio: "ポートフォリオLP",
  };

  function removeNocodeTemplateBodyClasses() {
    document.body.classList.forEach(function (c) {
      if (c.indexOf("nocode-tpl--") === 0) {
        document.body.classList.remove(c);
      }
    });
  }

  function applyFingerprintTemplateClasses() {
    var hasSalonHero = !!canvas.querySelector(
      '.canvas-block__img[src*="' + SALON_HERO_IMG_FINGERPRINT + '"]'
    );
    document.body.classList.toggle("nocode-tpl--beautySalon", hasSalonHero);
  }

  /**
   * スマホ編集ビュー: buildBlockFromEntry が img / ラッパーに付ける element.style の height（例: 480px）が残ると、
   * CSS より優先されラッパー下に空きが出る。インラインを削除してアスペクトに追従させる（PC ビューでは再マウントで復元）。
   */
  function stripSalonHeroImageInlineHeightsForResponsiveEdit() {
    if (editingViewport !== VIEWPORT_RESPONSIVE) return;
    /* 公開プレビューで PC のみ表示するときはインラインを残す（スマホ用レイアウトのときは除去） */
    if (
      document.body.classList.contains("nocode-published-mode") &&
      !document.body.classList.contains("nocode-edit-view-responsive")
    ) {
      return;
    }
    const wrap = canvas.querySelector(
      ':scope > .canvas-block--container:first-child > .canvas-block__nest > .canvas-block[data-type="image"]'
    );
    if (!wrap) return;
    const img = wrap.querySelector(".canvas-block__img");
    if (!img) return;
    const src = img.getAttribute("src") || "";
    if (
      src.indexOf(SALON_HERO_IMG_FINGERPRINT) === -1 &&
      src.indexOf(CAFE_HERO_IMG_FINGERPRINT) === -1 &&
      src.indexOf(SUPPLEMENT_HERO_IMG_FINGERPRINT) === -1
    ) {
      return;
    }
    img.style.removeProperty("height");
    wrap.style.removeProperty("height");
    syncImageObjectFit(img);
  }

  function setActiveTemplateKeyFromMenu(templateKey) {
    removeNocodeTemplateBodyClasses();
    const valid =
      templateKey && typeof templateKey === "string" && TEMPLATE_JSON_MAP[templateKey]
        ? templateKey
        : null;
    editorActiveTemplateKey = valid;
    if (valid && valid !== "beautySalon") {
      document.body.classList.add("nocode-tpl--" + valid);
    }
    try {
      if (valid) {
        localStorage.setItem(ACTIVE_TEMPLATE_STORAGE_KEY, valid);
      } else {
        localStorage.removeItem(ACTIVE_TEMPLATE_STORAGE_KEY);
      }
    } catch (err) {}
    applyFingerprintTemplateClasses();
  }

  function primarySelected() {
    return selectedBlocks.length > 0 ? selectedBlocks[selectedBlocks.length - 1] : null;
  }

  function getSelectionReferenceBlock() {
    if (selectionReferenceBlockId) {
      const byId = selectedBlocks.find(function (b) {
        return b && b.id === selectionReferenceBlockId;
      });
      if (byId) return byId;
    }
    if (selectedBlocks.length === 0) return null;
    return selectedBlocks.reduce(function (best, cur) {
      if (!best) return cur;
      const bestArea = (best.offsetWidth || 0) * (best.offsetHeight || 0);
      const curArea = (cur.offsetWidth || 0) * (cur.offsetHeight || 0);
      return curArea > bestArea ? cur : best;
    }, null);
  }

  function setSelectionReferenceBlock(block) {
    if (!block || selectedBlocks.indexOf(block) < 0) {
      selectionReferenceBlockId = null;
      return;
    }
    selectionReferenceBlockId = block.id || null;
  }

  function isBlockSelected(block) {
    return selectedBlocks.indexOf(block) !== -1;
  }

  function nextId() {
    idSeq += 1;
    return "blk-" + idSeq;
  }

  function domIndexInCanvas(el) {
    return Array.prototype.indexOf.call(canvas.children, el);
  }

  function domIndexInParent(el, parent) {
    return Array.prototype.indexOf.call(parent.children, el);
  }

  /** 同一親（キャンバス or コンテナの nest）直下のブロックを z 順（小さい＝奥）で並べる */
  function siblingsStackSorted(parentEl) {
    if (!parentEl) return [];
    const nodes = Array.from(parentEl.querySelectorAll(":scope > .canvas-block"));
    if (
      nodes.length &&
      nodes.some(function (b) {
        return !b.style.zIndex || String(b.style.zIndex).trim() === "";
      })
    ) {
      const byDom = nodes.slice().sort(function (a, b) {
        return domIndexInParent(a, parentEl) - domIndexInParent(b, parentEl);
      });
      byDom.forEach(function (el, idx) {
        if (!el.style.zIndex || String(el.style.zIndex).trim() === "") {
          el.style.zIndex = String(idx + 1);
        }
      });
    }
    return nodes.sort(function (a, b) {
      const za = parseInt(a.style.zIndex, 10) || 0;
      const zb = parseInt(b.style.zIndex, 10) || 0;
      if (za !== zb) return za - zb;
      return domIndexInParent(a, parentEl) - domIndexInParent(b, parentEl);
    });
  }

  function blocksStackSorted() {
    return siblingsStackSorted(canvas);
  }

  function applyZFromBackToFront(arr) {
    arr.forEach(function (el, idx) {
      el.style.zIndex = String(idx + 1);
    });
  }

  function nextZIndexInParent(parentEl) {
    const nodes = Array.from(parentEl.querySelectorAll(":scope > .canvas-block"));
    let m = 0;
    nodes.forEach(function (el) {
      const z = parseInt(el.style.zIndex, 10);
      if (!isNaN(z)) m = Math.max(m, z);
    });
    return m + 1;
  }

  function bringLayerForward(block) {
    const parent = block.parentElement;
    if (!parent) return;
    const backToFront = siblingsStackSorted(parent);
    const i = backToFront.indexOf(block);
    if (i < 0 || i >= backToFront.length - 1) return;
    const next = backToFront[i + 1];
    backToFront[i + 1] = block;
    backToFront[i] = next;
    applyZFromBackToFront(backToFront);
    renderLayers();
  }

  function sendLayerBackward(block) {
    const parent = block.parentElement;
    if (!parent) return;
    const backToFront = siblingsStackSorted(parent);
    const i = backToFront.indexOf(block);
    if (i <= 0) return;
    const prev = backToFront[i - 1];
    backToFront[i - 1] = block;
    backToFront[i] = prev;
    applyZFromBackToFront(backToFront);
    renderLayers();
  }

  function attachLayerMetaToSerialized(el, obj) {
    if (el.dataset.layerTitle && String(el.dataset.layerTitle).trim()) {
      obj.layerTitle = String(el.dataset.layerTitle).trim();
    }
    if (el.dataset.layerHidden === "1") {
      obj.layerHidden = true;
    }
    return obj;
  }

  function applyLayerHiddenVisual(wrap) {
    if (!wrap || !wrap.classList || !wrap.classList.contains("canvas-block")) return;
    if (wrap.dataset.layerHidden === "1") {
      wrap.style.visibility = "hidden";
      wrap.classList.add("canvas-block--layer-hidden");
    } else {
      wrap.style.visibility = "";
      wrap.classList.remove("canvas-block--layer-hidden");
    }
  }

  function finalizeBlockLayerMeta(node, entry) {
    if (!node || !entry) return;
    if (entry.layerTitle != null && String(entry.layerTitle).trim()) {
      node.dataset.layerTitle = String(entry.layerTitle).trim();
    } else {
      delete node.dataset.layerTitle;
    }
    if (entry.layerHidden === true || entry.layerHidden === "true" || entry.layerHidden === 1) {
      node.dataset.layerHidden = "1";
    } else {
      delete node.dataset.layerHidden;
    }
    applyLayerHiddenVisual(node);
  }

  /** 同一親内での z 並べ替えのみ（undo なし）。DOM 上の兄弟関係は変えない。 */
  function reorderBlockRelativeToCore(srcBlock, dstBlock) {
    const parent = srcBlock.parentElement;
    if (!parent || !dstBlock || dstBlock.parentElement !== parent) return false;
    const backToFront = siblingsStackSorted(parent);
    const ff = backToFront.slice().reverse();
    const from = ff.indexOf(srcBlock);
    const to = ff.indexOf(dstBlock);
    if (from < 0 || to < 0 || from === to) return false;
    const next = ff.slice();
    next.splice(from, 1);
    next.splice(to, 0, srcBlock);
    applyZFromBackToFront(next.slice().reverse());
    return true;
  }

  function reorderBlockRelativeTo(srcBlock, dstBlock) {
    if (!reorderBlockRelativeToCore(srcBlock, dstBlock)) return;
    pushUndoSnapshot();
    renderLayers();
    scheduleAutoSaveToLocalStorage();
  }

  /** ancestor が el の祖先（自分自身は含まない）なら true */
  function isDomAncestorOf(ancestor, el) {
    if (!ancestor || !el) return false;
    let n = el.parentElement;
    while (n) {
      if (n === ancestor) return true;
      n = n.parentElement;
    }
    return false;
  }

  /**
   * レイヤー一覧のドロップで親をまたぐ移動。
   * - コンテナ行へドロップ: 内側へ入れる（最前面側に追加）
   * - Shift+コンテナ行: コンテナの「前」に兄弟として置く（同階層）
   * - コンテナ以外へ: ドロップ先と同じ親の子にし、ドロップ先と同じ重なり順位置へ
   */
  function tryReparentLayerBlockByDrop(srcBlock, dstBlock, dragEvent) {
    if (!srcBlock || !dstBlock || srcBlock === dstBlock) return false;
    if (!canvas.contains(srcBlock) || !canvas.contains(dstBlock)) return false;
    if (isDomAncestorOf(srcBlock, dstBlock)) return false;

    const shiftKey = !!(dragEvent && dragEvent.shiftKey);
    const nest =
      dstBlock.dataset.type === "container"
        ? dstBlock.querySelector(":scope > .canvas-block__nest")
        : null;

    if (nest && !shiftKey) {
      pushUndoSnapshot();
      nest.appendChild(srcBlock);
      const order = siblingsStackSorted(nest);
      applyZFromBackToFront(order);
      reapplyLayoutPositionsFromDataset();
      setCanvasHeight();
      renderLayers();
      scheduleAutoSaveToLocalStorage();
      return true;
    }

    const parent = dstBlock.parentElement;
    if (!parent || (parent !== canvas && !parent.classList.contains("canvas-block__nest"))) {
      return false;
    }
    pushUndoSnapshot();
    parent.insertBefore(srcBlock, dstBlock);
    if (!reorderBlockRelativeToCore(srcBlock, dstBlock)) {
      applyZFromBackToFront(siblingsStackSorted(parent));
    }
    reapplyLayoutPositionsFromDataset();
    setCanvasHeight();
    renderLayers();
    scheduleAutoSaveToLocalStorage();
    return true;
  }

  function bumpAllCanvasBlockIds() {
    canvas.querySelectorAll(".canvas-block").forEach(function (b) {
      bumpIdSeqFromId(b.id);
    });
  }

  /** @returns {HTMLElement|null} */
  function duplicateBlockInPlace(block, offsetIdx) {
    const nudge = offsetIdx || 0;
    const d = 24 + nudge * 12;
    if (!block || !canvas.contains(block)) return null;
    const entry = serializeBlockElement(block);
    if (!entry) return null;
    const copy = JSON.parse(JSON.stringify(entry));
    assignFreshIdsToBlockEntry(copy);
    offsetBlockEntryRootPosition(copy, d, d);
    const parent = block.parentElement;
    if (!parent) return null;
    const ref = block.nextSibling;
    const node = buildBlockFromEntry(copy);
    if (!node) return null;
    finalizeBlockLayerMeta(node, copy);
    if (ref) parent.insertBefore(node, ref);
    else parent.appendChild(node);
    finalizeMountedNode(node, copy);
    node.style.zIndex = String(nextZIndexInParent(parent));
    return node;
  }

  function duplicateBlock(block) {
    pushUndoSnapshot();
    const node = duplicateBlockInPlace(block, 0);
    if (!node) return;
    bumpAllCanvasBlockIds();
    selectBlock(node);
    setCanvasHeight();
    scheduleAutoSaveToLocalStorage();
  }

  function duplicateSelectedBlocks() {
    const list = selectedBlocks.slice().filter(function (b) {
      return canvas.contains(b);
    });
    if (list.length === 0) return;
    pushUndoSnapshot();
    const newNodes = [];
    list.forEach(function (block, idx) {
      const node = duplicateBlockInPlace(block, idx);
      if (node) newNodes.push(node);
    });
    bumpAllCanvasBlockIds();
    if (newNodes.length === 0) return;
    setCanvasHeight();
    if (newNodes.length === 1) {
      selectBlock(newNodes[0]);
    } else {
      selectedBlocks.forEach(function (b) {
        b.classList.remove("is-selected");
      });
      selectedBlocks = newNodes.slice();
      newNodes.forEach(function (n) {
        n.classList.add("is-selected");
      });
      refreshSelectionUi();
    }
    scheduleAutoSaveToLocalStorage();
  }

  function updateLayerToolbarButtons() {
    const empty = selectedBlocks.length === 0;
    if (layerDeleteSelectedBtn) layerDeleteSelectedBtn.disabled = empty;
    if (layerDuplicateSelectedBtn) layerDuplicateSelectedBtn.disabled = empty;
  }

  function layerTypeLabel(type) {
    if (type === "text") return "テキスト";
    if (type === "image") return "画像";
    if (type === "button") return "ボタン";
    if (type === "contact") return "フォーム";
    if (type === "container") return "コンテナ";
    return type || "ブロック";
  }

  function blockSummary(block) {
    const t = block.dataset.type;
    if (t === "text") {
      const inner = block.querySelector(".canvas-block__text");
      const s = (inner && inner.textContent) || "";
      const trim = s.trim();
      if (!trim) return "（空のテキスト）";
      return trim.length > 32 ? trim.slice(0, 32) + "…" : trim;
    }
    if (t === "button") {
      const btn = block.querySelector(".canvas-block__btn");
      return (btn && btn.textContent) || "ボタン";
    }
    if (t === "contact") {
      const title = block.querySelector(".canvas-block__contact-title");
      const s = (title && title.textContent) || "";
      const trim = s.trim();
      if (!trim) return "フォーム";
      return trim.length > 32 ? trim.slice(0, 32) + "…" : trim;
    }
    if (t === "image") return "画像ブロック";
    if (t === "container") {
      const nest = block.querySelector(".canvas-block__nest");
      const n = nest ? nest.querySelectorAll(":scope > .canvas-block").length : 0;
      return "内側 " + n + " 個";
    }
    return block.id || "";
  }

  function renderLayers() {
    const backToFront = blocksStackSorted();
    if (backToFront.length === 0) {
      layersEmpty.hidden = false;
      layerList.hidden = true;
      layerList.innerHTML = "";
      return;
    }
    layersEmpty.hidden = true;
    layerList.hidden = false;
    layerList.innerHTML = "";

    function clearLayerDropHighlight() {
      layerList.querySelectorAll(".layer-item.is-drop-target").forEach(function (n) {
        n.classList.remove("is-drop-target");
      });
    }

    function appendLayerBranch(ul, blocksBackToFront, nested) {
      blocksBackToFront.forEach(function (block, idx) {
        const nBlk = blocksBackToFront.length;
        const isFront = idx === nBlk - 1;
        const isBack = idx === 0;

        let childBlocks = [];
        let hasBranch = false;
        if (block.dataset.type === "container") {
          const nest = block.querySelector(".canvas-block__nest");
          childBlocks = nest ? siblingsStackSorted(nest) : [];
          hasBranch = childBlocks.length > 0;
        }

        const li = document.createElement("li");
        li.className = "layer-item layer-item--tree";
        if (nested) li.classList.add("layer-item--nested");
        if (isBlockSelected(block)) li.classList.add("is-selected");
        if (isFront) li.classList.add("is-front");
        if (isBack) li.classList.add("is-back");
        if (block.dataset.layerHidden === "1") li.classList.add("layer-item--hidden");

        const row = document.createElement("div");
        row.className = "layer-item__row";

        let toggleOrSpacer;
        if (hasBranch) {
          toggleOrSpacer = document.createElement("button");
          toggleOrSpacer.type = "button";
          toggleOrSpacer.className = "layer-item__toggle";
          toggleOrSpacer.setAttribute("aria-expanded", "false");
          toggleOrSpacer.title = "内側のレイヤーを表示／隠す";
          toggleOrSpacer.textContent = "▶";
        } else {
          toggleOrSpacer = document.createElement("span");
          toggleOrSpacer.className = "layer-item__toggle-spacer";
          toggleOrSpacer.setAttribute("aria-hidden", "true");
        }

        const dragHandle = document.createElement("span");
        dragHandle.className = "layer-item__drag-handle";
        dragHandle.setAttribute("role", "button");
        dragHandle.tabIndex = 0;
        dragHandle.setAttribute("aria-grabbed", "false");
        dragHandle.title =
          "ドラッグして並べ替え。別の階層へ移動可。コンテナ行へドロップで内側へ／Shift+ドロップでコンテナの前に兄弟として置く";
        dragHandle.textContent = "⠿";
        dragHandle.addEventListener("mousedown", function (e) {
          e.stopPropagation();
        });
        dragHandle.addEventListener("click", function (e) {
          e.stopPropagation();
        });
        dragHandle.addEventListener("pointerdown", function (e) {
          e.stopPropagation();
        });
        dragHandle.draggable = true;
        dragHandle.addEventListener("dragstart", function (e) {
          layerDragSourceBlock = block;
          dragHandle.setAttribute("aria-grabbed", "true");
          try {
            e.dataTransfer.setData("text/plain", block.id || "");
            e.dataTransfer.effectAllowed = "move";
          } catch (err) {}
          li.classList.add("is-dragging-source");
        });
        dragHandle.addEventListener("dragend", function () {
          dragHandle.setAttribute("aria-grabbed", "false");
          layerDragSourceBlock = null;
          clearLayerDropHighlight();
          layerList.querySelectorAll(".layer-item.is-dragging-source").forEach(function (n) {
            n.classList.remove("is-dragging-source");
          });
        });

        const badge = document.createElement("span");
        badge.className = "layer-item__badge";
        badge.textContent = String(idx + 1);
        if (nested) {
          badge.title = isFront
            ? "このフォルダ内で最前面（一覧では下）"
            : isBack
              ? "このフォルダ内で最背面（一覧では上）"
              : "この階層では上ほど奥・下ほど手前";
        } else {
          if (isFront) badge.title = "キャンバス上で最前面（一覧では下）";
          else if (isBack) badge.title = "キャンバス上で最背面（一覧では上）";
          else badge.title = "上ほど奥、下ほど手前です";
        }

        const visLabel = document.createElement("label");
        visLabel.className = "layer-item__vis-label";
        const visCb = document.createElement("input");
        visCb.type = "checkbox";
        visCb.className = "layer-item__vis-cb";
        visCb.checked = block.dataset.layerHidden !== "1";
        visCb.title = "キャンバス上での表示／非表示";
        visCb.addEventListener("click", function (e) {
          e.stopPropagation();
        });
        visCb.addEventListener("change", function () {
          if (!visCb.checked) block.dataset.layerHidden = "1";
          else delete block.dataset.layerHidden;
          applyLayerHiddenVisual(block);
          renderLayers();
          scheduleAutoSaveToLocalStorage();
        });
        visLabel.appendChild(visCb);

        const body = document.createElement("div");
        body.className = "layer-item__body";
        const headLine = document.createElement("div");
        headLine.className = "layer-item__head";
        const typeTag = document.createElement("span");
        typeTag.className = "layer-item__type-tag";
        typeTag.textContent = layerTypeLabel(block.dataset.type);

        const titleInp = document.createElement("input");
        titleInp.type = "text";
        titleInp.className = "layer-item__title-input";
        titleInp.setAttribute("aria-label", "レイヤー名");
        titleInp.placeholder = blockSummary(block);
        titleInp.title = blockSummary(block);
        titleInp.value = block.dataset.layerTitle ? String(block.dataset.layerTitle) : "";
        titleInp.addEventListener("mousedown", function (e) {
          e.stopPropagation();
        });
        titleInp.addEventListener("click", function (e) {
          e.stopPropagation();
        });
        titleInp.addEventListener("keydown", function (e) {
          e.stopPropagation();
        });
        titleInp.addEventListener("input", function () {
          const raw = titleInp.value;
          const v = raw.trim();
          if (v) block.dataset.layerTitle = raw;
          else delete block.dataset.layerTitle;
          scheduleAutoSaveToLocalStorage();
        });
        titleInp.addEventListener("blur", function () {
          const v = titleInp.value.trim();
          if (v) block.dataset.layerTitle = v;
          else delete block.dataset.layerTitle;
          scheduleAutoSaveToLocalStorage();
        });

        headLine.appendChild(typeTag);
        headLine.appendChild(titleInp);
        body.appendChild(headLine);

        const zBtns = document.createElement("div");
        zBtns.className = "layer-item__z-btns";

        const btnTowardFront = document.createElement("button");
        btnTowardFront.type = "button";
        btnTowardFront.className = "btn layer-item__z-btn";
        btnTowardFront.textContent = "↓";
        btnTowardFront.disabled = isFront;
        btnTowardFront.title = nested ? "この階層でひとつ手前へ（一覧で下へ）" : "ひとつ手前（一覧では下へ）";
        btnTowardFront.addEventListener("click", function (e) {
          e.stopPropagation();
          bringLayerForward(block);
        });

        const btnTowardBack = document.createElement("button");
        btnTowardBack.type = "button";
        btnTowardBack.className = "btn layer-item__z-btn";
        btnTowardBack.textContent = "↑";
        btnTowardBack.disabled = isBack;
        btnTowardBack.title = nested ? "この階層でひとつ奥へ（一覧で上へ）" : "ひとつ奥（一覧では上へ）";
        btnTowardBack.addEventListener("click", function (e) {
          e.stopPropagation();
          sendLayerBackward(block);
        });

        zBtns.appendChild(btnTowardFront);
        zBtns.appendChild(btnTowardBack);

        row.appendChild(toggleOrSpacer);
        row.appendChild(dragHandle);
        row.appendChild(badge);
        row.appendChild(visLabel);
        row.appendChild(body);
        row.appendChild(zBtns);
        li.appendChild(row);

        let branchWrap = null;
        if (hasBranch) {
          branchWrap = document.createElement("div");
          branchWrap.className = "layer-item__branch";
          branchWrap.hidden = true;
          const subUl = document.createElement("ul");
          subUl.className = "layer-list layer-list--branch";
          appendLayerBranch(subUl, childBlocks, true);
          branchWrap.appendChild(subUl);
          li.appendChild(branchWrap);

          function setBranchOpen(open) {
            branchWrap.hidden = !open;
            toggleOrSpacer.setAttribute("aria-expanded", String(open));
            toggleOrSpacer.textContent = open ? "▼" : "▶";
            if (block.id) {
              if (open) layerOpenContainerIds.add(block.id);
              else layerOpenContainerIds.delete(block.id);
            }
          }

          toggleOrSpacer.addEventListener("click", function (e) {
            e.stopPropagation();
            setBranchOpen(branchWrap.hidden);
          });

          const hasSelectedDescendant = selectedBlocks.some(function (s) {
            return s && s !== block && block.contains(s);
          });
          const shouldOpen = hasSelectedDescendant || (block.id && layerOpenContainerIds.has(block.id));
          setBranchOpen(!!shouldOpen);
        }

        li.addEventListener("dragover", function (e) {
          const src = layerDragSourceBlock;
          if (!src || src === block) return;
          if (isDomAncestorOf(src, block)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        });
        li.addEventListener("dragenter", function (e) {
          const src = layerDragSourceBlock;
          if (!src || src === block) return;
          if (isDomAncestorOf(src, block)) return;
          e.preventDefault();
          li.classList.add("is-drop-target");
        });
        li.addEventListener("dragleave", function (e) {
          if (!li.contains(e.relatedTarget)) li.classList.remove("is-drop-target");
        });
        li.addEventListener("drop", function (e) {
          e.preventDefault();
          e.stopPropagation();
          const src = layerDragSourceBlock;
          clearLayerDropHighlight();
          if (!src || src === block) return;
          if (isDomAncestorOf(src, block)) return;
          if (src.parentElement === block.parentElement) {
            reorderBlockRelativeTo(src, block);
            return;
          }
          tryReparentLayerBlockByDrop(src, block, e);
        });

        li.addEventListener("click", function (e) {
          e.stopPropagation();
          selectBlock(block, { additive: !!(e.ctrlKey || e.metaKey) });
        });

        ul.appendChild(li);
      });
    }

    appendLayerBranch(layerList, backToFront, false);
    const firstSelectedLayer = layerList.querySelector(".layer-item.is-selected");
    if (firstSelectedLayer && typeof firstSelectedLayer.scrollIntoView === "function") {
      firstSelectedLayer.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  function clampCanvasHeight(v) {
    return clampCanvasHeightValue(v, canvasFloorHeightPx, CANVAS_HEIGHT_MIN, CANVAS_HEIGHT_MAX);
  }

  function clampCanvasWidth(v) {
    return clampCanvasWidthValue(v, canvasWorkWidthPx, CANVAS_WIDTH_MIN, CANVAS_WIDTH_MAX);
  }

  function applyCanvasWorkWidth() {
    applyCanvasWorkWidthStyle(canvasWorkWidthPx);
  }

  function reclampTopLevelBlocksToCanvas() {
    if (
      document.body.classList.contains("nocode-tpl--beautySalon") ||
      document.body.classList.contains("nocode-tpl--cafe") ||
      document.body.classList.contains("nocode-tpl--productSalesStory")
    ) {
      if (document.body.classList.contains("nocode-edit-view-responsive")) {
        return;
      }
      if (
        document.body.classList.contains("nocode-published-mode") &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(max-width: 768px)").matches
      ) {
        return;
      }
    }
    canvas.querySelectorAll(":scope > .canvas-block").forEach(function (b) {
      placeBlock(b, b.offsetLeft, b.offsetTop);
    });
  }

  function onCanvasWidthInput() {
    if (!canvasWidthInput) return;
    canvasWorkWidthPx = clampCanvasWidth(canvasWidthInput.value);
    canvasWidthInput.value = String(canvasWorkWidthPx);
    applyCanvasWorkWidth();
    requestAnimationFrame(function () {
      reclampTopLevelBlocksToCanvas();
      setCanvasHeight();
    });
  }

  function syncCanvasSizeInputs() {
    if (canvasWidthInput) {
      canvasWidthInput.value = String(canvasWorkWidthPx);
    }
    if (canvasHeightInput) {
      const renderedMin = parseInt(canvas.style.minHeight, 10);
      const effectiveHeight = !isNaN(renderedMin) && renderedMin > 0
        ? Math.max(canvasFloorHeightPx, renderedMin)
        : canvasFloorHeightPx;
      canvasHeightInput.value = String(effectiveHeight);
    }
  }

  function setCanvasHeight() {
    let contentBottom = canvasFloorHeightPx;
    canvas.querySelectorAll(":scope > .canvas-block").forEach(function (el) {
      const bottom = el.offsetTop + el.offsetHeight;
      if (bottom + CANVAS_PADDING_BOTTOM > contentBottom) {
        contentBottom = bottom + CANVAS_PADDING_BOTTOM;
      }
    });
    canvas.style.minHeight = contentBottom + "px";
    syncCanvasSizeInputs();
    scheduleAutoSaveToLocalStorage();
  }

  /**
   * スマホ編集ビュー用: レイアウト（テンプレ適用・画像ロード・viewport 切替）が一通り落ち着いたあとに
   * もう一度だけ高さを再計算して、縦スクロールバー発生を防ぐ。
   * PC ビュー（nocode-edit-view-responsive が付かない状態）には影響させない。
   */
  function recalcCanvasHeightForResponsiveView() {
    if (!document.body.classList.contains("nocode-edit-view-responsive")) return;
    requestAnimationFrame(function () {
      setCanvasHeight();
      requestAnimationFrame(function () {
        setCanvasHeight();
      });
    });
  }

  function updatePersistStatus(message) {
    if (persistStatusEl) {
      persistStatusEl.textContent = message || "";
    }
  }

  function clearPublishPageLink() {
    try {
      localStorage.removeItem(PUBLISH_PAGE_LINK_KEY);
    } catch (err) {}
  }

  /**
   * ページ管理（lp_pages_registry_v1）へキャンバスを同期。
   * currentPageId が無い場合は、保存済みの紐づけ ID または新規ページを作成する。
   * @returns {boolean} レジストリへ書けたか（NoCodePages 未読込時は false）
   */
  function syncCanvasDocumentToPageRegistry(doc) {
    if (!doc || !window.NoCodePages || typeof window.NoCodePages.savePage !== "function") {
      return false;
    }
    let targetId = currentPageId;
    if (!targetId) {
      try {
        targetId = localStorage.getItem(PUBLISH_PAGE_LINK_KEY);
      } catch (err) {
        targetId = null;
      }
    }
    if (targetId && window.NoCodePages.getPage && !window.NoCodePages.getPage(targetId)) {
      if (currentPageId === targetId) currentPageId = null;
      clearPublishPageLink();
      targetId = null;
    }
    if (targetId && window.NoCodePages.getPage && window.NoCodePages.getPage(targetId)) {
      try {
        window.NoCodePages.savePage(targetId, doc, {});
        currentPageId = targetId;
        try {
          localStorage.setItem(PUBLISH_PAGE_LINK_KEY, targetId);
        } catch (err2) {}
        syncPageQueryInLocation(targetId);
        return true;
      } catch (err) {
        console.error(err);
        return false;
      }
    }
    if (typeof window.NoCodePages.createPage !== "function") return false;
    try {
      const created = window.NoCodePages.createPage("マイ公開ページ");
      if (!created || !created.id) return false;
      targetId = created.id;
      window.NoCodePages.savePage(targetId, doc, {});
      currentPageId = targetId;
      try {
        localStorage.setItem(PUBLISH_PAGE_LINK_KEY, targetId);
      } catch (err3) {}
      syncPageQueryInLocation(targetId);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  function syncPageQueryInLocation(pageId) {
    if (!pageId || document.body.classList.contains("nocode-published-mode")) return;
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get("page") === pageId) return;
      u.searchParams.set("page", pageId);
      history.replaceState({}, "", u.pathname + u.search + u.hash);
    } catch (err) {}
  }

  function saveDocumentToLocalStorage(opt) {
    opt = opt || {};
    if (document.body.classList.contains("nocode-published-mode")) {
      return false;
    }
    let doc;
    try {
      doc = serializeCanvasDocument();
    } catch (err) {
      console.error(err);
      updatePersistStatus("保存に失敗しました（シリアライズ）。");
      return false;
    }
    console.log(
      "保存データ:",
      doc && doc.viewports && doc.viewports.desktop ? doc.viewports.desktop.blocks : []
    );
    const raw = JSON.stringify(doc);
    try {
      localStorage.setItem(LOCAL_STORAGE_DOC_KEY, raw);
    } catch (err) {
      console.error(err);
      updatePersistStatus("保存に失敗しました（容量不足の可能性）。");
      return false;
    }
    let registryOk = false;
    try {
      registryOk = syncCanvasDocumentToPageRegistry(doc);
    } catch (err) {
      console.error(err);
    }
    if (!opt.quiet) {
      updatePersistStatus(
        registryOk ? "保存しました（ページ管理・公開ページに反映）" : "ブラウザに保存しました"
      );
    }
    return true;
  }

  function scheduleAutoSaveToLocalStorage() {
    // 自動保存は行わない（「今すぐ保存」ボタンのみで保存）
  }

  /**
   * 以前の保存に activeTemplateKey: productSalesStory が残っていると、リロードのたびにサプリメントLPが復元される。
   * 一度だけ白紙に差し替えて localStorage を上書きする（手動「今すぐ保存」以外の自動復元用の例外）。
   */
  function migrateProductSalesStoryStickyPersist(doc) {
    if (!doc || typeof doc !== "object") {
      return { doc: doc, purged: false };
    }
    let already;
    try {
      already = localStorage.getItem(SUPPLEMENT_STICKY_PURGE_FLAG);
    } catch (err) {
      already = "1";
    }
    if (already) {
      return { doc: doc, purged: false };
    }
    if (doc.activeTemplateKey !== "productSalesStory") {
      return { doc: doc, purged: false };
    }
    try {
      localStorage.setItem(SUPPLEMENT_STICKY_PURGE_FLAG, "1");
      localStorage.removeItem(ACTIVE_TEMPLATE_STORAGE_KEY);
    } catch (err) {}
    return { doc: createBlankCanvasDocument(), purged: true };
  }

  function readRawPersistedDocumentFromLocalStorage() {
    let raw;
    try {
      raw = localStorage.getItem(LOCAL_STORAGE_DOC_KEY);
    } catch (err) {
      return { raw: null };
    }
    if (raw && typeof raw === "string") {
      console.log("[NoCodePersist] using key:", LOCAL_STORAGE_DOC_KEY, "bytes:", raw.length);
      return { raw: raw };
    }
    return { raw: null };
  }

  /** lp_data_v1 にドキュメントらしい JSON があれば true（version は tryLoad 側で検証） */
  function hasSavedDocumentInLocalStorage() {
    const got = readRawPersistedDocumentFromLocalStorage();
    const raw = got && got.raw;
    if (!raw || typeof raw !== "string") return false;
    try {
      const doc = JSON.parse(raw);
      return isLikelySavedCanvasDocument(doc);
    } catch (err) {
      return false;
    }
  }

  /**
   * 起動時: localStorage に有効なドキュメントがあれば適用
   * @returns {boolean} 復元したか
   */
  function tryLoadPersistedDocumentOnStartup() {
    const { raw } = readRawPersistedDocumentFromLocalStorage();
    if (!raw || typeof raw !== "string") return false;
    let doc;
    try {
      doc = JSON.parse(raw);
    } catch (err) {
      return false;
    }
    console.log("使用データ:", doc);
    console.log(
      "読み込みblocks:",
      doc && doc.viewports && doc.viewports.desktop ? doc.viewports.desktop.blocks || [] : []
    );
    if (!doc || typeof doc.schemaVersion !== "number") return false;
    if (doc.version !== PERSIST_DATA_VERSION) {
      console.warn("古いデータのため破棄");
      try {
        localStorage.removeItem(LOCAL_STORAGE_DOC_KEY);
      } catch (err) {}
      return false;
    }
    const mig = migrateProductSalesStoryStickyPersist(doc);
    doc = mig.doc;
    const rep = repairDualViewportDocIfOrphanBlocks(doc);
    doc = rep.doc;
    const strippedTemplateKey = stripActiveTemplateKeyFromDocIfNoBlocks(doc);
    if (mig.purged || rep.repaired || strippedTemplateKey) {
      try {
        doc.version = PERSIST_DATA_VERSION;
        localStorage.setItem(LOCAL_STORAGE_DOC_KEY, JSON.stringify(doc));
      } catch (err) {
        console.error(err);
      }
    }
    const ok = applyCanvasDocument(doc);
    if (ok) {
      clearUndoHistory();
      console.log("[NoCodePersist] applied canvas: persisted JSON (schemaVersion=" + doc.schemaVersion + ")");
      var msg = "前回の作業を復元しました";
      if (mig.purged) {
        msg =
          "保存データにサプリメント販売LPが含まれていたため、白紙に切り替えました。続きから作る場合はテンプレートを選び、「今すぐ保存」で保存してください。";
      } else if (rep.repaired) {
        msg =
          "保存データの PC／スマホ間でブロック数が食い違っていたため修正しました。「今すぐ保存」で上書き保存してください。";
      } else if (strippedTemplateKey) {
        msg =
          "白紙なのにテンプレート名だけ残っていたため表示を直しました。「今すぐ保存」で保存を確定してください。";
      }
      updatePersistStatus(msg);
    }
    return !!ok;
  }

  function confirmReplaceCanvas() {
    return window.confirm(
      "現在のキャンバス内容は失われます（未保存の変更は取り消せません）。よろしいですか？"
    );
  }

  function loadDocumentFromLocalStorageManual() {
    if (canvas.querySelector(":scope > .canvas-block") && !confirmReplaceCanvas()) return;
    const { raw } = readRawPersistedDocumentFromLocalStorage();
    if (!raw) {
      alert("このブラウザに保存されたデータがありません。");
      return;
    }
    let doc;
    try {
      doc = JSON.parse(raw);
    } catch (err) {
      alert("保存データが壊れています。");
      return;
    }
    console.log("使用データ:", doc);
    if (doc.version !== PERSIST_DATA_VERSION) {
      console.warn("古いデータのため破棄");
      try {
        localStorage.removeItem(LOCAL_STORAGE_DOC_KEY);
      } catch (err) {}
      alert("保存データの形式が古いため読み込めませんでした。既定テンプレートからやり直してください。");
      return;
    }
    const rep = repairDualViewportDocIfOrphanBlocks(doc);
    doc = rep.doc;
    const strippedTemplateKey = stripActiveTemplateKeyFromDocIfNoBlocks(doc);
    if (applyCanvasDocument(doc)) {
      clearUndoHistory();
      console.log("[NoCodePersist] manual load applied persisted document");
      if (rep.repaired || strippedTemplateKey) {
        try {
          doc.version = PERSIST_DATA_VERSION;
          localStorage.setItem(LOCAL_STORAGE_DOC_KEY, JSON.stringify(doc));
        } catch (err) {
          console.error(err);
        }
      }
      updatePersistStatus(
        rep.repaired
          ? "ブラウザから読み込みました（PC／スマホ間のブロック不整合を修正しました）。"
          : strippedTemplateKey
            ? "ブラウザから読み込みました（白紙に合わせてテンプレート表示を消しました）。"
            : "ブラウザから読み込みました"
      );
    } else {
      alert("ドキュメントを適用できませんでした（バージョン不一致の可能性）。");
    }
  }

  function downloadLpDocumentJsonFile() {
    let doc;
    try {
      doc = serializeCanvasDocument();
    } catch (err) {
      alert("出力に失敗しました。");
      return;
    }
    const raw = JSON.stringify(doc, null, 2);
    const blob = new Blob([raw], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "lp-document.json";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    updatePersistStatus("JSONをダウンロードしました");
  }

  function applyDocumentFromJsonText(text) {
    let doc;
    try {
      doc = JSON.parse(text);
    } catch (err) {
      alert("JSONの形式が正しくありません。");
      return false;
    }
    if (!doc || typeof doc.schemaVersion !== "number") {
      alert("ドキュメントの形式が正しくありません。");
      return false;
    }
    const repFile = repairDualViewportDocIfOrphanBlocks(doc);
    doc = repFile.doc;
    stripActiveTemplateKeyFromDocIfNoBlocks(doc);
    if (applyCanvasDocument(doc)) {
      clearUndoHistory();
      updatePersistStatus(
        repFile.repaired
          ? "JSONファイルから読み込みました（PC／スマホ間のブロック不整合を修正しました）。ブラウザに残すには「今すぐ保存」を押してください。"
          : "JSONファイルから読み込みました。ブラウザに残すには「今すぐ保存」を押してください。"
      );
      return true;
    }
    alert("ドキュメントを適用できませんでした。");
    return false;
  }

  function clearPersistedLocalDocument() {
    if (!window.confirm("このブラウザに保存したLPデータを削除します。よろしいですか？")) return;
    try {
      localStorage.removeItem(LOCAL_STORAGE_DOC_KEY);
      for (let i = 0; i < LEGACY_CANVAS_STORAGE_KEYS_IN_ORDER.length; i++) {
        localStorage.removeItem(LEGACY_CANVAS_STORAGE_KEYS_IN_ORDER[i]);
      }
    } catch (err) {
      alert("削除に失敗しました。");
      return;
    }
    Object.keys(TEMPLATE_JSON_MAP).forEach(function (key) {
      invalidateTemplateCache(key);
    });
    try {
      localStorage.removeItem(ACTIVE_TEMPLATE_STORAGE_KEY);
    } catch (err) {}
    loadTemplate(DEFAULT_TEMPLATE_KEY, { silent: true }).then(function (ok) {
      if (!ok) {
        applyCanvasDocument(createBlankCanvasDocument());
      }
      try {
        saveDocumentToLocalStorage({ quiet: true });
      } catch (e) {}
      updatePersistStatus(
        "保存を削除しました。既定テンプレートを表示しています。美容サロンは一覧から選び直してください。"
      );
    });
  }

  function onCanvasHeightInput() {
    if (!canvasHeightInput) return;
    canvasFloorHeightPx = clampCanvasHeight(canvasHeightInput.value);
    canvasHeightInput.value = String(canvasFloorHeightPx);
    setCanvasHeight();
  }

  function isEditingTarget(target) {
    if (!target || !target.closest) return false;
    const ce = target.closest("[contenteditable='true']");
    if (ce && canvas.contains(ce)) return true;
    const formCtrl = target.closest("input, textarea, select, button");
    return !!(formCtrl && canvas.contains(formCtrl));
  }

  function syncPropsFromDom(block) {
    if (selectedBlocks.length !== 1 || selectedBlocks[0] !== block) return;
    const type = block.dataset.type;
    if (type === "text") {
      const inner = block.querySelector(".canvas-block__text");
      const ta = propsForm.querySelector("textarea");
      if (ta && inner) ta.value = readTextBlockPanelValue(inner);
      const ffSel = propsForm.querySelector("#prop-text-font-family");
      if (ffSel && inner) {
        ffSel.value = normalizeFontFamily(inner.dataset.fontFamily || inner.style.fontFamily);
      }
    } else if (type === "button") {
      const btn = block.querySelector(".canvas-block__btn");
      const inp = propsForm.querySelector('input[type="text"]');
      if (inp && btn) inp.value = btn.textContent;
    } else if (type === "contact") {
      const title = block.querySelector(".canvas-block__contact-title");
      const btn = block.querySelector(".canvas-block__btn");
      const form = block.querySelector(".canvas-block__contact-form");
      const ti = propsForm.querySelector("#prop-contact-title");
      const si = propsForm.querySelector("#prop-contact-submit");
      if (ti && title) ti.value = title.textContent;
      if (si && btn) si.value = btn.textContent;
      if (form) {
        const g = readContactGapsPctFromForm(form);
        const gapIds = {
          titleBody: "prop-contact-gap-title-body",
          fields: "prop-contact-gap-fields",
          mainButton: "prop-contact-gap-main-button",
          labelField: "prop-contact-gap-label-field",
        };
        Object.keys(gapIds).forEach(function (k) {
          const inp = propsForm.querySelector("#" + gapIds[k]);
          if (inp) inp.value = String(g[k]);
        });
        const fbg = propsForm.querySelector("#prop-contact-form-bg");
        if (fbg && form) fbg.value = readContactFormBackgroundResolved(form);
        if (form) {
          syncCssLengthControls("prop-contact-form-br", form, "borderRadius", readContactFormBorderRadiusPx(form));
        }
      }
      syncContactHeadingPropsInputs(block);
    } else if (type === "container") {
      const nest = block.querySelector(".canvas-block__nest");
      if (nest) {
        const stNest = readContainerStyleFromNest(nest);
        syncCssLengthControls("prop-container-br", nest, "borderRadius", stNest.borderRadiusPx);
      }
    }
  }

  function syncContactHeadingPropsInputs(block) {
    if (selectedBlocks.length !== 1 || primarySelected() !== block) return;
    if (block.dataset.type !== "contact") return;
    const title = block.querySelector(".canvas-block__contact-title");
    const labs = block.querySelectorAll(".canvas-block__contact-row-label");
    if (!title) return;
    const t = readContactTitleStyleForPanel(title);
    syncCssLengthControls("prop-contact-h-title-fs", title, "fontSize", t.fontSizePx);
    const fc = propsForm.querySelector("#prop-contact-h-title-color");
    const fa = propsForm.querySelector("#prop-contact-h-title-align");
    if (fc) syncFieldColorPair(fc, t.color);
    if (fa) fa.value = normalizeTextAlign(t.textAlign);
    for (let i = 0; i < 3; i++) {
      const c = labs[i] ? readContactFieldLabelStyleForPanel(labs[i]) : CONTACT_HEADING_LABEL_DEFAULT;
      if (labs[i]) {
        syncCssLengthControls("prop-contact-h-row-" + i + "-fs", labs[i], "fontSize", c.fontSizePx);
      }
      const fc2 = propsForm.querySelector("#prop-contact-h-row-" + i + "-color");
      const fa2 = propsForm.querySelector("#prop-contact-h-row-" + i + "-align");
      if (fc2) syncFieldColorPair(fc2, c.color);
      if (fa2) fa2.value = normalizeTextAlign(c.textAlign);
    }
  }

  function attachPlainPaste(el) {
    el.addEventListener("paste", function (e) {
      e.preventDefault();
      const t = e.clipboardData.getData("text/plain");
      document.execCommand("insertText", false, t);
    });
  }

  /** テキストブロック用: script/iframe 等を除いた HTML 断片（template でパース） */
  function sanitizeRichTextHtml(html) {
    if (html == null) return "";
    const tpl = document.createElement("template");
    tpl.innerHTML = String(html);
    tpl.content.querySelectorAll("script, iframe, object, embed").forEach(function (n) {
      n.remove();
    });
    return tpl.innerHTML;
  }

  function canvasTextBlockHasInnerMarkup(inner) {
    return !!(inner && inner.querySelector("*"));
  }

  function readTextBlockPanelValue(inner) {
    if (!inner) return "";
    return canvasTextBlockHasInnerMarkup(inner) ? inner.innerHTML : inner.textContent;
  }

  function applyTextBlockPanelValue(inner, v) {
    const s = v == null ? "" : String(v);
    if (/^\s*</.test(s) || /<[a-zA-Z!/?]/.test(s)) {
      inner.innerHTML = sanitizeRichTextHtml(s);
    } else {
      inner.textContent = s;
    }
  }

  function attachCanvasTextPaste(el) {
    el.addEventListener("paste", function (e) {
      e.preventDefault();
      const clip = e.clipboardData;
      if (!clip) return;
      const html = clip.getData("text/html");
      const plain = clip.getData("text/plain");
      if (html && /\S/.test(html)) {
        const cleaned = sanitizeRichTextHtml(html);
        if (cleaned) {
          document.execCommand("insertHTML", false, cleaned);
          return;
        }
      }
      if (plain != null) {
        document.execCommand("insertText", false, plain);
      }
    });
  }

  function startTextEdit(inner, block) {
    if (inner.isContentEditable) return;
    inner.contentEditable = "true";
    inner.classList.add("is-editing");
    block.classList.add("block-editing");
    selectBlock(block);

    function done() {
      inner.contentEditable = "false";
      inner.classList.remove("is-editing");
      block.classList.remove("block-editing");
      inner.removeEventListener("blur", onBlur);
      inner.removeEventListener("keydown", onKey);
      syncPropsFromDom(block);
      setCanvasHeight();
      renderLayers();
    }

    function onBlur() {
      done();
    }

    function onKey(ev) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        inner.blur();
      }
    }

    inner.addEventListener("blur", onBlur);
    inner.addEventListener("keydown", onKey);
    inner.focus();
  }

  function startButtonEdit(btn, block) {
    if (btn.isContentEditable) return;
    btn.contentEditable = "true";
    btn.classList.add("is-editing");
    block.classList.add("block-editing");
    btn.style.pointerEvents = "auto";
    selectBlock(block);

    function done() {
      btn.contentEditable = "false";
      btn.classList.remove("is-editing");
      block.classList.remove("block-editing");
      btn.style.pointerEvents = "";
      btn.removeEventListener("blur", onBlur);
      btn.removeEventListener("keydown", onKey);
      syncPropsFromDom(block);
      setCanvasHeight();
      renderLayers();
    }

    function onBlur() {
      done();
    }

    function onKey(ev) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        btn.blur();
      }
    }

    btn.addEventListener("blur", onBlur);
    btn.addEventListener("keydown", onKey);
    btn.focus();
  }

  function setupInlineEdit(block) {
    const type = block.dataset.type;
    if (type === "text") {
      block.addEventListener("dblclick", function (e) {
        const inner = e.target.closest(".canvas-block__text");
        if (!inner || !block.contains(inner)) return;
        e.stopPropagation();
        e.preventDefault();
        startTextEdit(inner, block);
      });
    } else if (type === "button") {
      block.addEventListener("dblclick", function (e) {
        const btn = block.querySelector(".canvas-block__btn");
        if (!btn) return;
        const r = btn.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        ) {
          return;
        }
        e.stopPropagation();
        e.preventDefault();
        startButtonEdit(btn, block);
      });
    } else if (type === "contact") {
      block.addEventListener("dblclick", function (e) {
        const titleEl = e.target.closest && e.target.closest(".canvas-block__contact-title");
        if (titleEl && block.contains(titleEl)) {
          e.stopPropagation();
          e.preventDefault();
          startTextEdit(titleEl, block);
          return;
        }
        const btn = block.querySelector(".canvas-block__btn");
        if (!btn) return;
        const r = btn.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        ) {
          return;
        }
        e.stopPropagation();
        e.preventDefault();
        startButtonEdit(btn, block);
      });
    }
  }

  function deselect() {
    selectedBlocks.forEach(function (b) {
      b.classList.remove("is-selected");
    });
    selectedBlocks = [];
    selectionReferenceBlockId = null;
    propsEmpty.hidden = false;
    propsForm.hidden = true;
    propsForm.innerHTML = "";
    updateLayerToolbarButtons();
    renderLayers();
  }

  function refreshSelectionUi() {
    if (selectedBlocks.length === 0) {
      propsEmpty.hidden = false;
      propsForm.hidden = true;
      propsForm.innerHTML = "";
    } else if (selectedBlocks.length === 1) {
      propsEmpty.hidden = true;
      propsForm.hidden = false;
      renderProps(selectedBlocks[0]);
    } else {
      propsEmpty.hidden = true;
      propsForm.hidden = false;
      renderMultiSelectProps();
    }
    updateLayerToolbarButtons();
    renderLayers();
  }

  function renderMultiSelectProps() {
    propsForm.innerHTML = "";
    const intro = document.createElement("p");
    intro.className = "props-multiselect-hint";
    const ref = getSelectionReferenceBlock();
    const refLabel = ref && ref.dataset && ref.dataset.type ? ref.dataset.type : "未設定";
    intro.textContent =
      selectedBlocks.length +
      " 個を選択中（Ctrl / ⌘ + クリック、Ctrl / ⌘ + A で複数選択。基準: " +
      refLabel +
      "）";
    propsForm.appendChild(intro);

    const refField = document.createElement("div");
    refField.className = "field";
    const refLabelEl = document.createElement("label");
    refLabelEl.textContent = "整列の基準要素";
    refLabelEl.setAttribute("for", "prop-multi-ref");
    const refSelect = document.createElement("select");
    refSelect.id = "prop-multi-ref";

    const autoOpt = document.createElement("option");
    autoOpt.value = "__auto__";
    autoOpt.textContent = "自動（大きい要素）";
    refSelect.appendChild(autoOpt);

    selectedBlocks.forEach(function (b) {
      const opt = document.createElement("option");
      opt.value = b.id || "";
      const t = b.dataset && b.dataset.type ? b.dataset.type : "block";
      opt.textContent = t + " / " + (b.id || "(no-id)");
      refSelect.appendChild(opt);
    });

    if (selectionReferenceBlockId && selectedBlocks.some(function (b) { return b.id === selectionReferenceBlockId; })) {
      refSelect.value = selectionReferenceBlockId;
    } else {
      refSelect.value = "__auto__";
    }

    refSelect.addEventListener("change", function () {
      if (refSelect.value === "__auto__") {
        selectionReferenceBlockId = null;
      } else {
        const target = selectedBlocks.find(function (b) {
          return b.id === refSelect.value;
        });
        setSelectionReferenceBlock(target || null);
      }
      refreshSelectionUi();
    });
    refField.appendChild(refLabelEl);
    refField.appendChild(refSelect);
    propsForm.appendChild(refField);

    const alignField = document.createElement("div");
    alignField.className = "field";
    const alignTitle = document.createElement("p");
    alignTitle.className = "props-multiselect-hint";
    alignTitle.style.margin = "0 0 8px";
    alignTitle.textContent = "基準要素に合わせて整列";
    alignField.appendChild(alignTitle);

    const alignRow = document.createElement("div");
    alignRow.className = "props-align-actions__btns";
    function mkAlignBtn(label, mode) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn";
      btn.textContent = label;
      btn.addEventListener("click", function () {
        alignSelectedToReference(mode);
      });
      return btn;
    }
    alignRow.appendChild(mkAlignBtn("左寄せ", "left"));
    alignRow.appendChild(mkAlignBtn("中央寄せ", "hcenter"));
    alignRow.appendChild(mkAlignBtn("右寄せ", "right"));
    alignRow.appendChild(mkAlignBtn("上寄せ", "top"));
    alignRow.appendChild(mkAlignBtn("縦中央", "vcenter"));
    alignRow.appendChild(mkAlignBtn("下寄せ", "bottom"));
    alignField.appendChild(alignRow);
    propsForm.appendChild(alignField);

    const row = document.createElement("div");
    row.className = "field props-delete-field";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-danger btn-block";
    btn.textContent = "選択したブロックをすべて削除";
    btn.addEventListener("click", function () {
      deleteSelectedBlocks();
    });
    row.appendChild(btn);
    propsForm.appendChild(row);
  }

  function deleteSelectedBlocks() {
    const copy = selectedBlocks.slice();
    if (copy.length === 0) return;
    pushUndoSnapshot();
    selectedBlocks = [];
    selectionReferenceBlockId = null;
    copy.forEach(function (b) {
      b.classList.remove("is-selected");
      if (canvas.contains(b)) b.remove();
    });
    setCanvasHeight();
    refreshSelectionUi();
  }

  function deleteBlock(block) {
    if (!block || !canvas.contains(block)) return;
    pushUndoSnapshot();
    const i = selectedBlocks.indexOf(block);
    if (i >= 0) selectedBlocks.splice(i, 1);
    if (selectionReferenceBlockId && block.id === selectionReferenceBlockId) {
      selectionReferenceBlockId = null;
    }
    block.classList.remove("is-selected");
    block.remove();
    setCanvasHeight();
    refreshSelectionUi();
  }

  function selectBlock(el, opts) {
    opts = opts || {};
    if (document.body.classList.contains("nocode-published-mode")) return;
    if (!el || !canvas.contains(el)) return;

    if (!opts.additive && selectedBlocks.length === 1 && selectedBlocks[0] === el) {
      renderLayers();
      return;
    }

    if (!opts.additive && selectedBlocks.length > 1 && selectedBlocks.indexOf(el) >= 0) {
      setSelectionReferenceBlock(el);
      refreshSelectionUi();
      return;
    }

    if (opts.additive) {
      const j = selectedBlocks.indexOf(el);
      if (j >= 0) {
        selectedBlocks.splice(j, 1);
        el.classList.remove("is-selected");
        if (selectionReferenceBlockId && selectionReferenceBlockId === el.id) {
          selectionReferenceBlockId = null;
        }
      } else {
        selectedBlocks.push(el);
        el.classList.add("is-selected");
        setSelectionReferenceBlock(el);
      }
    } else {
      selectedBlocks.forEach(function (b) {
        if (b !== el) b.classList.remove("is-selected");
      });
      selectedBlocks = selectedBlocks.filter(function (b) {
        return b === el;
      });
      if (selectedBlocks.indexOf(el) < 0) {
        selectedBlocks.push(el);
        el.classList.add("is-selected");
      }
      setSelectionReferenceBlock(el);
    }

    refreshSelectionUi();
  }

  function selectAllBlocksByShortcut() {
    const all = Array.from(canvas.querySelectorAll(".canvas-block"));
    if (all.length === 0) return false;
    selectedBlocks.forEach(function (b) {
      b.classList.remove("is-selected");
    });
    selectedBlocks = all.slice();
    selectedBlocks.forEach(function (b) {
      b.classList.add("is-selected");
    });
    setSelectionReferenceBlock(selectedBlocks[selectedBlocks.length - 1]);
    refreshSelectionUi();
    return true;
  }

  function readButtonPadding(btn) {
    let y = 10;
    let x = 20;
    const p = btn.style.padding;
    if (p) {
      const pts = p.trim().split(/\s+/);
      if (pts.length === 1) {
        const v = parseInt(pts[0], 10);
        if (!isNaN(v)) {
          y = v;
          x = v;
        }
      } else if (pts.length >= 2) {
        const py = parseInt(pts[0], 10);
        const px = parseInt(pts[1], 10);
        if (!isNaN(py)) y = py;
        if (!isNaN(px)) x = px;
      }
    }
    return { y: y, x: x };
  }

  function setButtonPadding(btn, py, px) {
    btn.style.padding = Math.max(0, py) + "px " + Math.max(0, px) + "px";
  }

  function readButtonBorderWidth(btn) {
    const inline = parseFloat(btn.style.borderTopWidth);
    if (!isNaN(inline)) {
      return Math.round(inline);
    }
    const w = parseFloat(getComputedStyle(btn).borderTopWidth);
    return isNaN(w) ? 0 : Math.round(w);
  }

  function readButtonBorderColorHex(btn) {
    const raw = btn.style.borderTopColor;
    if (raw && raw !== "transparent" && raw !== "rgba(0, 0, 0, 0)") {
      const h = rgbToHex(raw);
      if (h && h !== "#000000") return h;
    }
    const w = readButtonBorderWidth(btn);
    if (w > 0) {
      const h = rgbToHex(getComputedStyle(btn).borderTopColor);
      if (h && h !== "#000000") return h;
    }
    return "#1e293b";
  }

  function applyButtonBorderSides(btn, widthPx, colorHexOptional) {
    const w = Math.max(0, widthPx);
    const sides = ["Top", "Right", "Bottom", "Left"];
    let col = "transparent";
    if (w > 0) {
      col =
        colorHexOptional ||
        readButtonBorderColorHex(btn);
      if (!col || col === "#000000") col = "#1e293b";
    }
    sides.forEach(function (side) {
      btn.style["border" + side + "Width"] = w + "px";
      btn.style["border" + side + "Style"] = "solid";
      btn.style["border" + side + "Color"] = col;
    });
  }

  function setButtonBorderColorsOnly(btn, colorHex) {
    ["Top", "Right", "Bottom", "Left"].forEach(function (side) {
      btn.style["border" + side + "Color"] = colorHex;
    });
  }

  function readButtonBorderRadius(btn) {
    const r = parseInt(btn.style.borderRadius, 10);
    return isNaN(r) ? 6 : r;
  }

  function readButtonWidthPx(btn) {
    const w = parseInt(btn.style.width, 10);
    return isNaN(w) || w <= 0 ? 0 : w;
  }

  function readButtonHeightPx(btn) {
    const h = parseInt(btn.style.height, 10);
    return isNaN(h) || h <= 0 ? 0 : h;
  }

  function syncImageObjectFit(img) {
    const w = parseInt(img.style.width, 10);
    const h = parseInt(img.style.height, 10);
    if (!isNaN(w) && w > 0 && !isNaN(h) && h > 0) {
      img.style.objectFit = "cover";
    } else {
      img.style.objectFit = "";
    }
  }

  function applyFileToImageBlock(block, file) {
    if (
      !block ||
      block.dataset.type !== "image" ||
      !file ||
      String(file.type || "").indexOf("image/") !== 0
    ) {
      return;
    }
    const img = block.querySelector(".canvas-block__img");
    if (!img) return;
    const reader = new FileReader();
    reader.onload = function () {
      img.onload = function () {
        syncImageObjectFit(img);
        setCanvasHeight();
        if (selectedBlocks.length === 1 && selectedBlocks[0] === block) {
          syncBlockResizePropInputs(block);
        }
        const urlInp = propsForm.querySelector("#prop-img-url");
        if (urlInp && selectedBlocks.indexOf(block) !== -1) {
          urlInp.value = img.getAttribute("src") || "";
        }
        renderLayers();
      };
      img.src = reader.result;
      setCanvasHeight();
    };
    reader.readAsDataURL(file);
  }

  function firstImageFileFromDataTransfer(dt) {
    if (!dt || !dt.files || !dt.files.length) return null;
    for (let i = 0; i < dt.files.length; i++) {
      if (String(dt.files[i].type || "").indexOf("image/") === 0) return dt.files[i];
    }
    return null;
  }

  function normalizeTextAlign(raw) {
    if (raw === "center" || raw === "right" || raw === "left") return raw;
    return "left";
  }

  /** テキスト style.fontFamily 用: sans-serif | serif | cursive のいずれか */
  function normalizeFontFamily(raw) {
    if (raw == null || raw === "") return "sans-serif";
    const s = String(raw).trim().toLowerCase();
    if (s === "sans-serif" || s === "serif" || s === "cursive") return s;
    if (s.indexOf("sans-serif") !== -1) return "sans-serif";
    if (s.indexOf("cursive") !== -1) return "cursive";
    if (s.indexOf("serif") !== -1) return "serif";
    return "sans-serif";
  }

  function applyTextFontFamilyToInner(inner, family) {
    const ff = normalizeFontFamily(family);
    inner.style.fontFamily = ff;
    inner.dataset.fontFamily = ff;
  }

  /** style.lineHeight: 数値は行の倍率（1.5 など）、未指定なら適用しない */
  function applyStyleLineHeight(el, st) {
    if (!el || !st || st.lineHeight == null || st.lineHeight === "") return;
    const lh = st.lineHeight;
    el.style.lineHeight = typeof lh === "number" ? String(lh) : String(lh);
  }

  function readStyleLineHeightFromEl(el) {
    const lh = el && el.style && el.style.lineHeight;
    if (!lh || lh === "normal" || lh === "") return undefined;
    const n = parseFloat(lh);
    return isNaN(n) ? undefined : n;
  }

  /** renderProps のたびに innerHTML を空にするため、開いていたセクションをラベルで覚えて復元する */
  function capturePropsAccordionOpenState() {
    const map = Object.create(null);
    if (!propsForm) return map;
    propsForm.querySelectorAll("details.props-accordion").forEach(function (det) {
      const sum = det.querySelector(":scope > .props-accordion__summary");
      if (!sum) return;
      const key = String(sum.textContent || "").trim();
      if (key && det.open) map[key] = true;
    });
    return map;
  }

  function restorePropsAccordionOpenState(map) {
    if (!map || !propsForm) return;
    const keys = Object.keys(map);
    if (keys.length === 0) return;
    propsForm.querySelectorAll("details.props-accordion").forEach(function (det) {
      const sum = det.querySelector(":scope > .props-accordion__summary");
      if (!sum) return;
      const key = String(sum.textContent || "").trim();
      if (key && map[key]) det.open = true;
    });
  }

  function appendPropsAccordion(parent, summaryLabel, initiallyOpen, buildBodyFn) {
    const det = document.createElement("details");
    det.className = "props-accordion";
    if (initiallyOpen) {
      det.open = true;
    }
    const sum = document.createElement("summary");
    sum.className = "props-accordion__summary";
    sum.textContent = summaryLabel;
    const panel = document.createElement("div");
    panel.className = "props-accordion__panel";
    buildBodyFn(panel);
    det.appendChild(sum);
    det.appendChild(panel);
    parent.appendChild(det);
  }

  function appendPropsDeleteField(blockEl) {
    const delWrap = document.createElement("div");
    delWrap.className = "field props-delete-field";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-danger btn-block";
    delBtn.textContent = "このブロックを削除";
    delBtn.addEventListener("click", function () {
      deleteBlock(blockEl);
    });
    delWrap.appendChild(delBtn);
    propsForm.appendChild(delWrap);
  }

  function renderProps(el) {
    const accOpenState = capturePropsAccordionOpenState();
    const type = el.dataset.type;
    propsForm.innerHTML = "";

    const commonPos = document.createElement("div");
    commonPos.className = "field-row";
    commonPos.innerHTML =
      '<div class="field"><label for="prop-x">X (px)</label><input type="number" id="prop-x" /></div>' +
      '<div class="field"><label for="prop-y">Y (px)</label><input type="number" id="prop-y" /></div>';
    propsForm.appendChild(commonPos);
    const inputX = commonPos.querySelector("#prop-x");
    const inputY = commonPos.querySelector("#prop-y");
    inputX.value = parseInt(el.style.left, 10) || 0;
    inputY.value = parseInt(el.style.top, 10) || 0;
    inputX.addEventListener("input", function () {
      el.style.left = inputX.value + "px";
      setCanvasHeight();
    });
    inputY.addEventListener("input", function () {
      el.style.top = inputY.value + "px";
      setCanvasHeight();
    });

    const inNest =
      el.parentElement && el.parentElement.classList.contains("canvas-block__nest");
    const alignWrap = document.createElement("div");
    alignWrap.className = "field props-align-actions";
    const alignLab = document.createElement("span");
    alignLab.className = "props-align-actions__label";
    alignLab.textContent = inNest ? "親（コンテナ）内で中央へ" : "キャンバス内で中央へ";
    const alignBtns = document.createElement("div");
    alignBtns.className = "props-align-actions__btns";
    const btnAlignH = document.createElement("button");
    btnAlignH.type = "button";
    btnAlignH.className = "btn";
    btnAlignH.textContent = "水平";
    btnAlignH.title = inNest ? "コンテナ幅の中央（左右）" : "キャンバス幅の中央（左右）";
    btnAlignH.addEventListener("click", function () {
      pushUndoSnapshot();
      centerBlockHorizontal(el);
    });
    const btnAlignV = document.createElement("button");
    btnAlignV.type = "button";
    btnAlignV.className = "btn";
    btnAlignV.textContent = "垂直";
    btnAlignV.title = inNest ? "コンテナ高さの中央（上下）" : "キャンバス高さの中央（上下）";
    btnAlignV.addEventListener("click", function () {
      pushUndoSnapshot();
      centerBlockVertical(el);
    });
    const btnAlignHV = document.createElement("button");
    btnAlignHV.type = "button";
    btnAlignHV.className = "btn btn-primary";
    btnAlignHV.textContent = "縦横";
    btnAlignHV.title = inNest ? "コンテナ内で水平・垂直ともに中央" : "水平・垂直ともに中央";
    btnAlignHV.addEventListener("click", function () {
      pushUndoSnapshot();
      centerBlockHorizontal(el);
      centerBlockVertical(el);
    });
    alignBtns.appendChild(btnAlignH);
    alignBtns.appendChild(btnAlignV);
    alignBtns.appendChild(btnAlignHV);
    alignWrap.appendChild(alignLab);
    alignWrap.appendChild(alignBtns);
    propsForm.appendChild(alignWrap);

    const hPosWrap = document.createElement("div");
    hPosWrap.className = "field props-align-actions";
    const hPosLab = document.createElement("span");
    hPosLab.className = "props-align-actions__label";
    hPosLab.textContent = inNest ? "横位置（親の幅に対して）" : "横位置（キャンバス幅に対して）";
    const hPosBtns = document.createElement("div");
    hPosBtns.className = "props-align-actions__btns";
    function mkHPosBtn(label, mode) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn";
      b.textContent = label;
      b.addEventListener("click", function () {
        pushUndoSnapshot();
        alignBlockCanvasHorizontal(el, mode);
      });
      return b;
    }
    hPosBtns.appendChild(mkHPosBtn("左", "left"));
    hPosBtns.appendChild(mkHPosBtn("中央", "center"));
    hPosBtns.appendChild(mkHPosBtn("右", "right"));
    hPosWrap.appendChild(hPosLab);
    hPosWrap.appendChild(hPosBtns);
    propsForm.appendChild(hPosWrap);

    if (type === "text") {
      const inner = el.querySelector(".canvas-block__text");
      addField(propsForm, "テキスト", "textarea", readTextBlockPanelValue(inner), function (v) {
        applyTextBlockPanelValue(inner, v);
        setCanvasHeight();
        renderLayers();
      });
      appendPropsAccordion(propsForm, "文字の見た目（サイズ・色・太さ）", false, function (body) {
        const tw = parseInt(inner.style.width, 10);
        const th = parseInt(inner.style.height, 10);
        addDimensionField(body, "枠の幅", inner, "width", {
          id: "prop-text-w",
          min: 0,
          max: 2000,
          zeroClears: true,
          fallbackPx: !isNaN(tw) && tw > 0 ? tw : Math.round(el.offsetWidth),
          onAfter: function () {
            if (inner.style.width) inner.style.boxSizing = "border-box";
            setCanvasHeight();
            renderLayers();
          },
        });
        addDimensionField(body, "枠の高さ", inner, "height", {
          id: "prop-text-h",
          min: 0,
          max: 4000,
          zeroClears: true,
          fallbackPx: !isNaN(th) && th > 0 ? th : Math.round(el.offsetHeight),
          onAfter: function () {
            if (inner.style.height) inner.style.boxSizing = "border-box";
            setCanvasHeight();
            renderLayers();
          },
        });
        addDimensionField(body, "文字サイズ", inner, "fontSize", {
          id: "prop-text-fs",
          min: 1,
          max: 500,
          zeroClears: false,
          fallbackPx:
            (function () {
              const raw = inner.style.fontSize;
              if (raw) {
                const p = parseCssNumericUnit(raw, NaN, "px");
                if (!isNaN(p.n) && p.n > 0) return p.n;
              }
              return Math.round(parseFloat(getComputedStyle(inner).fontSize)) || 16;
            })(),
          onAfter: function () {
            setCanvasHeight();
            renderLayers();
          },
        });
        addField(body, "文字色", "color", rgbToHex(inner.style.color) || "#3c2355", function (v) {
          inner.style.color = v;
        });
        addField(body, "太さ", "select", inner.style.fontWeight || "400", function (v) {
          inner.style.fontWeight = v;
        }, [
          { value: "400", label: "通常" },
          { value: "600", label: "やや太い" },
          { value: "700", label: "太字" },
        ]);
        addField(
          body,
          "フォント",
          "select",
          normalizeFontFamily(inner.dataset.fontFamily || inner.style.fontFamily),
          function (v) {
            applyTextFontFamilyToInner(inner, v);
            setCanvasHeight();
            renderLayers();
          },
          [
            { value: "sans-serif", label: "ゴシック（sans-serif）" },
            { value: "serif", label: "明朝（serif）" },
            { value: "cursive", label: "装飾系（cursive）" },
          ],
          { id: "prop-text-font-family" }
        );
        addField(body, "枠内の位置（横）", "select", normalizeTextAlign(inner.style.textAlign), function (v) {
          inner.style.textAlign = normalizeTextAlign(v);
          setCanvasHeight();
        }, [
          { value: "left", label: "左揃え" },
          { value: "center", label: "中央" },
          { value: "right", label: "右揃え" },
        ]);
      });
    } else if (type === "image") {
      const img = el.querySelector(".canvas-block__img");
      appendPropsAccordion(propsForm, "画像（URL・ファイル）", false, function (body) {
        addField(
          body,
          "画像URL",
          "url",
          img.getAttribute("src") || "",
          function (v) {
            img.src = v || defaultImagePlaceholderSrc();
            img.onload = function () {
              syncImageObjectFit(img);
              setCanvasHeight();
            };
            syncImageObjectFit(img);
            setCanvasHeight();
          },
          undefined,
          { id: "prop-img-url" }
        );
        const fileWrap = document.createElement("div");
        fileWrap.className = "field";
        const fl = document.createElement("label");
        fl.textContent = "ローカル画像";
        const fi = document.createElement("input");
        fi.type = "file";
        fi.accept = "image/*";
        fi.addEventListener("change", function () {
          const file = fi.files && fi.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = function () {
            img.onload = function () {
              syncImageObjectFit(img);
              setCanvasHeight();
            };
            img.src = reader.result;
            setCanvasHeight();
          };
          reader.readAsDataURL(file);
        });
        fileWrap.appendChild(fl);
        fileWrap.appendChild(fi);
        body.appendChild(fileWrap);
      });
      appendPropsAccordion(propsForm, "表示サイズ（幅・高さ）", false, function (body) {
        const hp = parseInt(img.style.height, 10);
        const brNow = img.style.borderRadius && String(img.style.borderRadius).indexOf("%") >= 0
          ? parseInt(img.style.borderRadius, 10)
          : 0;
        addDimensionField(body, "幅", img, "width", {
          id: "prop-img-w",
          min: 0,
          max: 2000,
          zeroAsAuto: true,
          fallbackPx: img.width || parseInt(img.style.width, 10) || Math.round(img.offsetWidth) || 240,
          onAfter: function () {
            syncImageObjectFit(img);
            el.style.boxSizing = "border-box";
            el.style.width = img.offsetWidth ? img.offsetWidth + "px" : "";
            setCanvasHeight();
          },
        });
        addDimensionField(body, "高さ", img, "height", {
          id: "prop-img-h",
          min: 0,
          max: 4000,
          zeroClears: true,
          fallbackPx: !isNaN(hp) && hp > 0 ? hp : Math.round(img.offsetHeight),
          onAfter: function () {
            syncImageObjectFit(img);
            if (img.style.height) {
              el.style.height = img.offsetHeight + "px";
            } else {
              el.style.height = "";
            }
            setCanvasHeight();
          },
        });
        addField(body, "角丸 (%)", "number", brNow, function (v) {
          const n = Math.max(0, Math.min(100, parseInt(v, 10) || 0));
          img.style.borderRadius = n + "%";
          setCanvasHeight();
        }, undefined, { min: 0, max: 100, id: "prop-img-br-pct" });
      });
    } else if (type === "button" || type === "contact") {
      const btn = el.querySelector(".canvas-block__btn");
      const titleEl = type === "contact" ? el.querySelector(".canvas-block__contact-title") : null;
      const pad = readButtonPadding(btn);
      const bw = readButtonBorderWidth(btn);
      const br = readButtonBorderRadius(btn);
      const wPxBtn = readButtonWidthPx(btn) || Math.round(btn.offsetWidth);
      const hPxBtn = readButtonHeightPx(btn) || Math.round(btn.offsetHeight);

      if (type === "contact" && titleEl && btn) {
        addField(
          propsForm,
          "フォームの見出し",
          "text",
          titleEl.textContent,
          function (v) {
            titleEl.textContent = v;
            setCanvasHeight();
            renderLayers();
          },
          undefined,
          { id: "prop-contact-title" }
        );
        addField(
          propsForm,
          "送信ボタンの文言",
          "text",
          btn.textContent,
          function (v) {
            btn.textContent = v;
            setCanvasHeight();
            renderLayers();
          },
          undefined,
          { id: "prop-contact-submit" }
        );
        appendPropsAccordion(propsForm, "見出しの文字（色・位置・サイズ）", false, function (body) {
          const hint = document.createElement("p");
          hint.className = "contact-props-hint";
          hint.textContent =
            "フォーム上部の見出しと、各項目ラベル（お名前・メールなど）を個別に設定できます。";
          body.appendChild(hint);
          const titleEl = el.querySelector(".canvas-block__contact-title");
          const rowLabs = el.querySelectorAll(".canvas-block__contact-row-label");
          const alignOpts = [
            { value: "left", label: "左揃え" },
            { value: "center", label: "中央" },
            { value: "right", label: "右揃え" },
          ];
          const tCur = titleEl ? readContactTitleStyleForPanel(titleEl) : CONTACT_HEADING_TITLE_DEFAULT;
          if (titleEl) {
            addDimensionField(body, "【フォーム見出し】文字サイズ", titleEl, "fontSize", {
              id: "prop-contact-h-title-fs",
              min: 1,
              max: 120,
              zeroClears: false,
              fallbackPx: tCur.fontSizePx,
              onAfter: function () {
                setCanvasHeight();
              },
            });
          }
          addField(
            body,
            "【フォーム見出し】文字色",
            "color",
            tCur.color,
            function (v) {
              if (titleEl) titleEl.style.color = v;
              setCanvasHeight();
            },
            undefined,
            { id: "prop-contact-h-title-color" }
          );
          addField(
            body,
            "【フォーム見出し】横位置",
            "select",
            normalizeTextAlign(tCur.textAlign),
            function (v) {
              if (titleEl) titleEl.style.textAlign = v;
              setCanvasHeight();
            },
            alignOpts,
            { id: "prop-contact-h-title-align" }
          );
          const rowNames = ["項目1（お名前）", "項目2（メール）", "項目3（お問い合わせ内容）"];
          for (let i = 0; i < 3; i++) {
            (function (idx) {
              const labEl = rowLabs[idx];
              const c = labEl ? readContactFieldLabelStyleForPanel(labEl) : CONTACT_HEADING_LABEL_DEFAULT;
              if (labEl) {
                addDimensionField(body, "【" + rowNames[idx] + "】文字サイズ", labEl, "fontSize", {
                  id: "prop-contact-h-row-" + idx + "-fs",
                  min: 1,
                  max: 80,
                  zeroClears: false,
                  fallbackPx: c.fontSizePx,
                  onAfter: function () {
                    setCanvasHeight();
                  },
                });
              }
              addField(
                body,
                "【" + rowNames[idx] + "】文字色",
                "color",
                c.color,
                function (v) {
                  if (rowLabs[idx]) rowLabs[idx].style.color = v;
                  setCanvasHeight();
                },
                undefined,
                { id: "prop-contact-h-row-" + idx + "-color" }
              );
              addField(
                body,
                "【" + rowNames[idx] + "】横位置",
                "select",
                normalizeTextAlign(c.textAlign),
                function (v) {
                  if (rowLabs[idx]) rowLabs[idx].style.textAlign = v;
                  setCanvasHeight();
                },
                alignOpts,
                { id: "prop-contact-h-row-" + idx + "-align" }
              );
            })(i);
          }
        });
        appendPropsAccordion(propsForm, "余白（フォーム高さに対する％）", false, function (body) {
          const form = el.querySelector(".canvas-block__contact-form");
          const hint = document.createElement("p");
          hint.className = "contact-props-hint";
          hint.textContent =
            "各％はフォーム枠の内側の高さを基準にした行方向の間隔です。キャンバスでフォームを大きくすると、すべての余白が同じ比率で広がります。";
          body.appendChild(hint);
          const g0 = form ? readContactGapsPctFromForm(form) : normalizeContactGapsPct(null);
          const gapDefs = [
            ["見出し〜入力エリアの間", "titleBody", "prop-contact-gap-title-body"],
            ["入力項目どうしの間", "fields", "prop-contact-gap-fields"],
            ["最後の項目〜送信ボタンの間", "mainButton", "prop-contact-gap-main-button"],
            ["ラベル〜グレー枠の間（各行）", "labelField", "prop-contact-gap-label-field"],
          ];
          gapDefs.forEach(function (def) {
            const label = def[0];
            const key = def[1];
            const fid = def[2];
            addField(
              body,
              label + " (%)",
              "number",
              g0[key],
              function (v) {
                if (!form) return;
                const o = readContactGapsPctFromForm(form);
                o[key] = v;
                applyContactGapsToForm(form, o);
                setCanvasHeight();
              },
              undefined,
              { min: 0, max: 25, step: 0.1, id: fid }
            );
          });
        });
        appendPropsAccordion(propsForm, "項目（プレビュー）の高さ", false, function (body) {
          const hint = document.createElement("p");
          hint.className = "contact-props-hint";
          hint.textContent =
            "グレーの入力枠の最小の高さです。フォームを縦に広げると、項目ごとの比率に応じて枠も一緒に伸びます。";
          body.appendChild(hint);
          const fakes = el.querySelectorAll(".canvas-block__contact-fake");
          const labs = ["項目1（お名前）", "項目2（メール）", "項目3（内容）"];
          for (let i = 0; i < 3; i++) {
            (function (idx) {
              const fake = fakes[idx];
              const cur =
                fake &&
                (parseInt(fake.style.minHeight, 10) ||
                  parseInt(fake.style.height, 10) ||
                  Math.round(fake.getBoundingClientRect().height) ||
                  [10, 10, 36][idx]);
              addField(
                body,
                labs[idx] + " (px)",
                "number",
                cur,
                function (v) {
                  const f = el.querySelectorAll(".canvas-block__contact-fake")[idx];
                  if (f) applyContactFakeMinHeightPx(f, v);
                  setCanvasHeight();
                },
                undefined,
                { min: 4, max: 400, id: "prop-contact-fake-h-" + idx }
              );
            })(i);
          }
        });
      } else if (type === "button") {
        addField(propsForm, "ラベル", "text", btn.textContent, function (v) {
          btn.textContent = v;
          setCanvasHeight();
          renderLayers();
        });
      }
      if (type === "contact") {
        appendPropsAccordion(propsForm, "連携先（公開時の遷移）", false, function (body) {
          const hint = document.createElement("p");
          hint.className = "contact-props-hint";
          hint.textContent =
            "このフォームの送信先（LINE・メールなど）は、今後 API またはサイト設定から連携できる想定です。現状は保存のみです。";
          body.appendChild(hint);
          addField(
            body,
            "連携タイプ",
            "select",
            el.dataset.contactMode || "none",
            function (v) {
              el.dataset.contactMode = v;
              setCanvasHeight();
            },
            [
              { value: "none", label: "未設定" },
              { value: "email", label: "メール（mailto）" },
              { value: "line", label: "LINE" },
              { value: "url", label: "任意の URL" },
            ]
          );
          addField(body, "連携の内容", "text", el.dataset.contactValue || "", function (v) {
            el.dataset.contactValue = v;
            setCanvasHeight();
          });
        });
      }
      appendPropsAccordion(propsForm, "スタイル（サイズ・余白・色・枠）", false, function (body) {
        if (type === "button") {
          addField(
            body,
            "ボタン位置（アウトライン内）",
            "select",
            normalizeTextAlign(el.style.textAlign),
            function (v) {
              el.style.textAlign = normalizeTextAlign(v);
              setCanvasHeight();
            },
            [
              { value: "left", label: "左寄せ" },
              { value: "center", label: "中央寄せ" },
              { value: "right", label: "右寄せ" },
            ],
            { id: "prop-btn-block-align" }
          );
        }
        if (type === "contact") {
          const pNote = document.createElement("p");
          pNote.className = "contact-props-hint";
          pNote.textContent =
            "フォーム枠（外枠）の大きさは、キャンバス上のブロック右下のハンドルでのみ変更できます。";
          body.appendChild(pNote);
          const formEl = el.querySelector(".canvas-block__contact-form");
          addField(
            body,
            "フォーム枠の背景色",
            "color",
            formEl ? readContactFormBackgroundResolved(formEl) : "#ffffff",
            function (v) {
              if (formEl) formEl.style.backgroundColor = v;
              setCanvasHeight();
            },
            undefined,
            { id: "prop-contact-form-bg" }
          );
          if (formEl) {
            addDimensionField(body, "フォーム枠の角丸", formEl, "borderRadius", {
              id: "prop-contact-form-br",
              min: 0,
              max: 200,
              zeroClears: true,
              fallbackPx: readContactFormBorderRadiusPx(formEl),
              onAfter: function () {
                setCanvasHeight();
              },
            });
          }
        }
        addDimensionField(body, type === "contact" ? "送信ボタン 横幅" : "横幅", btn, "width", {
          id: "prop-btn-w",
          min: 0,
          max: 1200,
          zeroClears: true,
          fallbackPx:
            type === "contact"
              ? readButtonWidthPx(btn) || Math.round(btn.offsetWidth)
              : wPxBtn || Math.round(btn.offsetWidth),
          onAfter: function () {
            if (type === "contact") {
              if (!btn.style.width) {
                btn.style.width = "100%";
              }
              btn.style.boxSizing = "border-box";
              btn.style.maxWidth = "100%";
            }
            setCanvasHeight();
          },
        });
        addDimensionField(body, type === "contact" ? "送信ボタン 高さ" : "高さ", btn, "height", {
          id: "prop-btn-h",
          min: 0,
          max: 800,
          zeroClears: true,
          fallbackPx:
            type === "contact"
              ? readButtonHeightPx(btn) || Math.round(btn.offsetHeight)
              : hPxBtn || Math.round(btn.offsetHeight),
          onAfter: function () {
            setCanvasHeight();
          },
        });
        addDimensionField(body, "文字サイズ", btn, "fontSize", {
          id: "prop-btn-fs",
          min: 1,
          max: 200,
          zeroClears: false,
          fallbackPx:
            (function () {
              const raw = btn.style.fontSize;
              if (raw) {
                const p = parseCssNumericUnit(raw, NaN, "px");
                if (!isNaN(p.n) && p.n > 0) return p.n;
              }
              return Math.round(parseFloat(getComputedStyle(btn).fontSize)) || 14;
            })(),
          onAfter: function () {
            setCanvasHeight();
          },
        });
        const padRow = document.createElement("div");
        padRow.className = "field-row";
        body.appendChild(padRow);
        addField(
          padRow,
          "余白 横 (px)",
          "number",
          pad.x,
          function (v) {
            const py = readButtonPadding(btn).y;
            setButtonPadding(btn, py, Math.max(0, v));
            setCanvasHeight();
          },
          undefined,
          { min: 0, max: 80 }
        );
        addField(
          padRow,
          "余白 縦 (px)",
          "number",
          pad.y,
          function (v) {
            const px = readButtonPadding(btn).x;
            setButtonPadding(btn, Math.max(0, v), px);
            setCanvasHeight();
          },
          undefined,
          { min: 0, max: 80 }
        );
        addDimensionField(body, "角丸", btn, "borderRadius", {
          id: "prop-btn-br",
          min: 0,
          max: 200,
          zeroClears: true,
          fallbackPx: br,
          onAfter: function () {
            setCanvasHeight();
          },
        });
        addField(
          body,
          "枠の太さ (px)",
          "number",
          bw,
          function (v) {
            applyButtonBorderSides(btn, v);
            setCanvasHeight();
          },
          undefined,
          { min: 0, max: 16 }
        );
        addField(body, "枠の色", "color", readButtonBorderColorHex(btn), function (v) {
          const w = readButtonBorderWidth(btn);
          if (w > 0) {
            applyButtonBorderSides(btn, w, v);
          } else {
            setButtonBorderColorsOnly(btn, v);
          }
          setCanvasHeight();
        });
        addField(body, "文字色", "color", rgbToHex(btn.style.color) || "#ffffff", function (v) {
          btn.style.color = v;
        });
        if (type === "button") {
          addField(
            body,
            "ラベル位置（アウトライン内）",
            "select",
            normalizeTextAlign(btn.style.textAlign),
            function (v) {
              btn.style.textAlign = normalizeTextAlign(v);
              setCanvasHeight();
            },
            [
              { value: "left", label: "左寄せ" },
              { value: "center", label: "中央寄せ" },
              { value: "right", label: "右寄せ" },
            ],
            { id: "prop-btn-text-align" }
          );
        }
        const btnTrWrap = document.createElement("div");
        btnTrWrap.className = "field field--checkbox";
        const btnTrLab = document.createElement("label");
        btnTrLab.className = "field-checkbox-label";
        const btnTrCb = document.createElement("input");
        btnTrCb.type = "checkbox";
        btnTrCb.checked = isButtonBgTransparent(btn);
        btnTrLab.appendChild(btnTrCb);
        btnTrLab.appendChild(document.createTextNode(" 背景を透過"));
        btnTrWrap.appendChild(btnTrLab);
        btnTrCb.addEventListener("change", function () {
          const hexEl = document.getElementById("prop-btn-bg-solid");
          const solid = hexEl && hexEl.value ? hexEl.value : readButtonSolidBgForPicker(btn);
          setButtonBgTransparent(btn, btnTrCb.checked, solid);
          setCanvasHeight();
        });
        body.appendChild(btnTrWrap);
        addField(
          body,
          "背景色（透過OFF時）",
          "color",
          readButtonSolidBgForPicker(btn),
          function (v) {
            btn.dataset.bgColorSolid = v;
            if (!isButtonBgTransparent(btn)) {
              btn.style.backgroundColor = v;
            }
            setCanvasHeight();
          },
          undefined,
          { id: "prop-btn-bg-solid" }
        );
        addField(body, "背景画像 URL", "url", readButtonBgImageSrc(btn), function (v) {
          applyButtonBackgroundImage(btn, (v || "").trim(), readButtonBgImageFit(btn));
          setCanvasHeight();
        });
        const btnBgFileWrap = document.createElement("div");
        btnBgFileWrap.className = "field";
        const btnBgFl = document.createElement("label");
        btnBgFl.textContent = "背景画像（ファイル）";
        const btnBgFi = document.createElement("input");
        btnBgFi.type = "file";
        btnBgFi.accept = "image/*";
        btnBgFi.addEventListener("change", function () {
          const file = btnBgFi.files && btnBgFi.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = function () {
            applyButtonBackgroundImage(btn, reader.result, readButtonBgImageFit(btn));
            setCanvasHeight();
          };
          reader.readAsDataURL(file);
        });
        btnBgFileWrap.appendChild(btnBgFl);
        btnBgFileWrap.appendChild(btnBgFi);
        body.appendChild(btnBgFileWrap);
        addField(
          body,
          "背景画像の表示",
          "select",
          readButtonBgImageFit(btn),
          function (v) {
            const src = readButtonBgImageSrc(btn);
            if (src) {
              applyButtonBackgroundImage(btn, src, v);
            } else {
              btn.dataset.bgImageFit = normalizeBgFit(v);
            }
            setCanvasHeight();
          },
          [
            { value: "cover", label: "領域を覆う（cover）" },
            { value: "contain", label: "全体を表示（contain）" },
            { value: "repeat", label: "タイル（繰り返し）" },
          ]
        );
      });
    } else if (type === "container") {
      const nest = el.querySelector(".canvas-block__nest");
      if (nest) {
        const st = readContainerStyleFromNest(nest);
        appendPropsAccordion(propsForm, "コンテナ（内側の領域）", false, function (body) {
          addDimensionField(body, "最小幅", nest, "minWidth", {
            id: "prop-container-minw",
            min: 0,
            max: 1200,
            zeroClears: true,
            fallbackPx: st.minWidthPx || Math.round(nest.offsetWidth),
            onAfter: function () {
              setCanvasHeight();
            },
          });
          addDimensionField(body, "最小高さ", nest, "minHeight", {
            id: "prop-container-minh",
            min: 0,
            max: 4000,
            zeroClears: true,
            fallbackPx: st.minHeightPx || Math.round(nest.offsetHeight),
            onAfter: function () {
              setCanvasHeight();
            },
          });
          addDimensionField(body, "幅", nest, "width", {
            id: "prop-container-nest-w",
            min: 0,
            max: 2000,
            zeroClears: true,
            fallbackPx: st.widthPx > 0 ? st.widthPx : Math.round(nest.offsetWidth),
            onAfter: function () {
              setCanvasHeight();
            },
          });
          addDimensionField(body, "高さ", nest, "height", {
            id: "prop-container-nest-h",
            min: 0,
            max: 4000,
            zeroClears: true,
            fallbackPx: st.heightPx > 0 ? st.heightPx : Math.round(nest.offsetHeight),
            onAfter: function () {
              setCanvasHeight();
            },
          });
          addDimensionField(body, "内側の余白", nest, "padding", {
            id: "prop-container-pad",
            min: 0,
            max: 80,
            zeroClears: true,
            fallbackPx: st.paddingPx,
            onAfter: function () {
              setCanvasHeight();
            },
          });
          addField(body, "背景色", "color", st.backgroundColor || "#ffffff", function (v) {
            const alphaInput = body.querySelector("#prop-container-bg-alpha");
            const alphaVal = alphaInput ? parseInt(alphaInput.value, 10) : st.backgroundAlphaPct;
            applyContainerBackgroundWithAlpha(nest, v, alphaVal);
            setCanvasHeight();
          });
          addField(
            body,
            "背景の透明度 (%)",
            "number",
            st.backgroundAlphaPct,
            function (v) {
              const colorInput = body.querySelector('input[type="color"]');
              const currentColor = colorInput ? colorInput.value : st.backgroundColor || "#ffffff";
              applyContainerBackgroundWithAlpha(nest, currentColor, v);
              setCanvasHeight();
            },
            undefined,
            { min: 0, max: 100, id: "prop-container-bg-alpha" }
          );
          addDimensionField(body, "角丸", nest, "borderRadius", {
            id: "prop-container-br",
            min: 0,
            max: 200,
            zeroClears: true,
            fallbackPx: st.borderRadiusPx,
            onAfter: function () {
              setCanvasHeight();
            },
          });
        });
      }
    }

    appendPropsDeleteField(el);
    restorePropsAccordionOpenState(accOpenState);
  }

  function addField(container, label, kind, initial, onChange, selectOptions, numberOpts) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const lab = document.createElement("label");
    lab.textContent = label;

    if (kind === "color") {
      wrap.classList.add("field--colorPair");
      let initHex = "#000000";
      if (initial != null && String(initial).trim() !== "") {
        const str = String(initial).trim();
        if (str.charAt(0) === "#") {
          initHex = normalizeHexColor(str) || "#000000";
        } else {
          initHex = normalizeHexColor(rgbToHex(str)) || "#000000";
        }
      }
      const row = document.createElement("div");
      row.className = "field__color-row";
      const inputColor = document.createElement("input");
      inputColor.type = "color";
      inputColor.value = initHex;
      const inputHex = document.createElement("input");
      inputHex.type = "text";
      inputHex.className = "field__color-hex";
      inputHex.spellcheck = false;
      inputHex.autocomplete = "off";
      inputHex.placeholder = "#RRGGBB";
      inputHex.title = "16進カラー（#RGB または #RRGGBB。先頭の#は省略可能）";
      inputHex.value = initHex;
      if (numberOpts && numberOpts.id) {
        inputHex.id = numberOpts.id;
        lab.htmlFor = numberOpts.id;
      }
      inputColor.addEventListener("input", function () {
        const v = inputColor.value;
        inputHex.value = v;
        onChange(v);
      });
      inputHex.addEventListener("input", function () {
        const n = normalizeHexColor(inputHex.value);
        if (n) {
          inputColor.value = n;
          onChange(n);
        }
      });
      inputHex.addEventListener("blur", function () {
        const n = normalizeHexColor(inputHex.value);
        if (n) inputHex.value = n;
      });
      row.appendChild(inputColor);
      row.appendChild(inputHex);
      wrap.appendChild(lab);
      wrap.appendChild(row);
      container.appendChild(wrap);
      return;
    }

    let input;
    if (kind === "textarea") {
      input = document.createElement("textarea");
      input.value = initial;
    } else if (kind === "select") {
      input = document.createElement("select");
      (selectOptions || []).forEach(function (opt) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        input.appendChild(o);
      });
      input.value = initial;
      if (numberOpts && numberOpts.id) input.id = numberOpts.id;
    } else {
      input = document.createElement("input");
      input.type = kind === "number" ? "number" : kind === "url" ? "url" : "text";
      if (kind === "number") {
        if (numberOpts && numberOpts.min !== undefined) {
          input.min = String(numberOpts.min);
        } else {
          input.min = "1";
        }
        if (numberOpts && numberOpts.max !== undefined) {
          input.max = String(numberOpts.max);
        }
        input.step = numberOpts && numberOpts.step !== undefined ? String(numberOpts.step) : "1";
        input.value = initial;
        if (numberOpts && numberOpts.id) input.id = numberOpts.id;
      } else {
        input.value = initial;
        if (numberOpts && numberOpts.id) input.id = numberOpts.id;
      }
    }
    function fire() {
      if (kind === "number") {
        const raw = parseInt(input.value, 10);
        onChange(isNaN(raw) ? 0 : raw);
      } else onChange(input.value);
    }
    if (kind === "select") {
      input.addEventListener("change", fire);
    } else {
      input.addEventListener("input", fire);
      if (kind === "textarea") input.addEventListener("change", fire);
    }
    wrap.appendChild(lab);
    wrap.appendChild(input);
    container.appendChild(wrap);
  }

  /** プロパティ: px / em / rem / % を数値＋単位で編集 */
  function parseCssNumericUnit(cssVal, fallbackNum, fallbackUnit) {
    const s = cssVal == null ? "" : String(cssVal).trim();
    if (!s || s === "auto") {
      return { n: fallbackNum, unit: fallbackUnit || "px" };
    }
    const m = s.match(/^(-?\d*\.?\d+)\s*(px|em|rem|%)?$/i);
    if (!m) {
      return { n: fallbackNum, unit: fallbackUnit || "px" };
    }
    return { n: parseFloat(m[1]), unit: (m[2] || "px").toLowerCase() };
  }

  function formatDimensionCss(n, unit) {
    if (n == null || isNaN(n)) return "";
    const u = unit || "px";
    if (u === "px") {
      return Math.round(n) + "px";
    }
    const r = Math.round(n * 10000) / 10000;
    return r + u;
  }

  /**
   * @param {HTMLElement} container
   * @param {string} label
   * @param {HTMLElement} element
   * @param {string} cssProperty - style のプロパティ名（fontSize, width など）
   * @param {{ id?: string, min?: number, max?: number, step?: number, zeroClears?: boolean, zeroAsAuto?: boolean, fallbackPx?: number, onAfter?: function() }} opts
   */
  function addDimensionField(container, label, element, cssProperty, opts) {
    opts = opts || {};
    const idBase = opts.id || "dim-" + cssProperty + "-" + Math.random().toString(36).slice(2, 9);
    const min = opts.min !== undefined ? opts.min : 0;
    const max = opts.max !== undefined ? opts.max : 10000;
    const zeroClears = !!opts.zeroClears;
    const zeroAsAuto = !!opts.zeroAsAuto;
    const wrap = document.createElement("div");
    wrap.className = "field field--dimension";
    const lab = document.createElement("label");
    lab.setAttribute("for", idBase + "-val");
    lab.textContent = label;
    const row = document.createElement("div");
    row.className = "field-dimension";
    const num = document.createElement("input");
    num.type = "number";
    num.id = idBase + "-val";
    num.className = "field-dimension__num";
    const sel = document.createElement("select");
    sel.id = idBase + "-unit";
    sel.className = "field-dimension__unit";
    sel.setAttribute("aria-label", label + " の単位");
    ["px", "em", "rem", "%"].forEach(function (u) {
      const o = document.createElement("option");
      o.value = u;
      o.textContent = u;
      sel.appendChild(o);
    });
    function fallbackNum() {
      if (opts.fallbackPx != null && !isNaN(opts.fallbackPx)) {
        return opts.fallbackPx;
      }
      return 0;
    }
    function readPair() {
      const raw = element.style[cssProperty];
      return parseCssNumericUnit(raw, fallbackNum(), "px");
    }
    function applyFromInputs() {
      let v = parseFloat(num.value, 10);
      const u = sel.value;
      if (zeroAsAuto && (isNaN(v) || v === 0) && u === "px") {
        element.style[cssProperty] = "";
        if (opts.onAfter) opts.onAfter();
        else {
          setCanvasHeight();
          renderLayers();
        }
        return;
      }
      if (zeroClears && (isNaN(v) || v === 0)) {
        element.style[cssProperty] = "";
        if (opts.onAfter) opts.onAfter();
        else {
          setCanvasHeight();
          renderLayers();
        }
        return;
      }
      if (isNaN(v)) return;
      v = u === "px" ? Math.round(v) : v;
      element.style[cssProperty] = formatDimensionCss(v, u);
      if (opts.onAfter) opts.onAfter();
      else {
        setCanvasHeight();
        renderLayers();
      }
    }
    const p0 = readPair();
    num.value = String(p0.n);
    sel.value = ["px", "em", "rem", "%"].indexOf(p0.unit) >= 0 ? p0.unit : "px";
    num.min = String(min);
    num.max = String(max);
    num.step = sel.value === "px" ? (opts.step != null ? String(opts.step) : "1") : "0.01";
    num.addEventListener("input", applyFromInputs);
    sel.addEventListener("change", function () {
      num.step = sel.value === "px" ? (opts.step != null ? String(opts.step) : "1") : "0.01";
      applyFromInputs();
    });
    row.appendChild(num);
    row.appendChild(sel);
    wrap.appendChild(lab);
    wrap.appendChild(row);
    container.appendChild(wrap);
  }

  function syncCssLengthControls(idBase, element, cssProperty, fallbackPx) {
    const num = propsForm.querySelector("#" + idBase + "-val");
    const unit = propsForm.querySelector("#" + idBase + "-unit");
    if (!num || !unit || !element) return;
    const fb = fallbackPx != null && !isNaN(fallbackPx) ? fallbackPx : 0;
    const p = parseCssNumericUnit(element.style[cssProperty], fb, "px");
    num.value = String(p.n);
    unit.value = ["px", "em", "rem", "%"].indexOf(p.unit) >= 0 ? p.unit : "px";
    num.step = unit.value === "px" ? "1" : "0.01";
  }

  function rgbToHex(rgb) {
    if (!rgb || rgb.startsWith("#")) return rgb || "#000000";
    const m = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return "#000000";
    return (
      "#" +
      [m[1], m[2], m[3]]
        .map(function (x) {
          return ("0" + parseInt(x, 10).toString(16)).slice(-2);
        })
        .join("")
    );
  }

  function hexToRgb(hex) {
    if (!hex || typeof hex !== "string") return null;
    const v = hex.trim();
    if (!v.startsWith("#")) return null;
    if (v.length === 4) {
      const r = parseInt(v[1] + v[1], 16);
      const g = parseInt(v[2] + v[2], 16);
      const b = parseInt(v[3] + v[3], 16);
      if ([r, g, b].some(function (x) { return isNaN(x); })) return null;
      return { r: r, g: g, b: b };
    }
    if (v.length === 7) {
      const r = parseInt(v.slice(1, 3), 16);
      const g = parseInt(v.slice(3, 5), 16);
      const b = parseInt(v.slice(5, 7), 16);
      if ([r, g, b].some(function (x) { return isNaN(x); })) return null;
      return { r: r, g: g, b: b };
    }
    return null;
  }

  /** #RGB / #RRGGBB（先頭の # 省略可）を #rrggbb に正規化 */
  function normalizeHexColor(str) {
    if (str == null || typeof str !== "string") return null;
    let s = str.trim();
    if (s === "") return null;
    if (!s.startsWith("#")) s = "#" + s;
    const rgb = hexToRgb(s);
    if (!rgb) return null;
    return (
      "#" +
      [rgb.r, rgb.g, rgb.b]
        .map(function (x) {
          return ("0" + x.toString(16)).slice(-2);
        })
        .join("")
    );
  }

  function syncFieldColorPair(hexTextInput, cssOrHex) {
    if (!hexTextInput || !hexTextInput.classList || !hexTextInput.classList.contains("field__color-hex")) {
      return;
    }
    let n = null;
    if (cssOrHex != null && String(cssOrHex).trim().charAt(0) === "#") {
      n = normalizeHexColor(String(cssOrHex));
    }
    if (!n) n = normalizeHexColor(rgbToHex(cssOrHex));
    if (!n) return;
    hexTextInput.value = n;
    const row = hexTextInput.closest(".field--colorPair");
    const pick = row && row.querySelector('input[type="color"]');
    if (pick) pick.value = n;
  }

  function applyContainerBackgroundWithAlpha(nest, colorHex, alphaPct) {
    const c = colorHex && String(colorHex).trim() ? String(colorHex).trim() : "";
    if (!c) {
      nest.style.backgroundColor = "";
      return;
    }
    const a = Math.max(0, Math.min(100, parseInt(alphaPct, 10)));
    if (isNaN(a) || a >= 100) {
      nest.style.backgroundColor = c;
      return;
    }
    const rgb = hexToRgb(c);
    if (!rgb) {
      nest.style.backgroundColor = c;
      return;
    }
    nest.style.backgroundColor = "rgba(" + rgb.r + ", " + rgb.g + ", " + rgb.b + ", " + a / 100 + ")";
  }

  function readContainerStyleFromNest(nest) {
    const mw = parseInt(nest.style.minWidth, 10);
    const mh = parseInt(nest.style.minHeight, 10);
    const ww = parseInt(nest.style.width, 10);
    const hh = parseInt(nest.style.height, 10);
    let paddingPx = 0;
    const p = nest.style.padding;
    if (p) {
      const pts = p.trim().split(/\s+/);
      const v = parseInt(pts[0], 10);
      if (!isNaN(v)) paddingPx = v;
    }
    const bg = nest.style.backgroundColor;
    let backgroundAlphaPct = 100;
    if (bg && String(bg).indexOf("rgba(") === 0) {
      const m = String(bg).match(/^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*([0-9.]+)\s*\)$/);
      if (m) {
        const a = parseFloat(m[1]);
        if (!isNaN(a)) backgroundAlphaPct = Math.max(0, Math.min(100, Math.round(a * 100)));
      }
    }
    let borderRadiusPx = 0;
    const brs = nest.style.borderRadius;
    if (brs) {
      const m = String(brs).match(/^([\d.]+)px$/);
      if (m) borderRadiusPx = Math.round(parseFloat(m[1]));
    } else {
      borderRadiusPx = Math.round(parseFloat(getComputedStyle(nest).borderTopLeftRadius)) || 0;
    }
    return {
      minWidth: nest.style.minWidth || "",
      minHeight: nest.style.minHeight || "",
      width: nest.style.width || "",
      height: nest.style.height || "",
      padding: nest.style.padding || "",
      borderRadius: nest.style.borderRadius || "",
      minWidthPx: !isNaN(mw) && mw > 0 ? mw : 0,
      minHeightPx: !isNaN(mh) && mh > 0 ? mh : 0,
      widthPx: !isNaN(ww) && ww > 0 ? ww : 0,
      heightPx: !isNaN(hh) && hh > 0 ? hh : 0,
      paddingPx: paddingPx,
      backgroundColor: bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)" ? rgbToHex(bg) : "",
      backgroundAlphaPct: backgroundAlphaPct,
      borderRadiusPx: borderRadiusPx,
    };
  }

  function applyContainerStyleToNest(nest, st) {
    st = st || {};
    const mw = parseInt(st.minWidthPx, 10);
    const mh = parseInt(st.minHeightPx, 10);
    const pad = parseInt(st.paddingPx, 10);
    const ww = parseInt(st.widthPx, 10);
    const hh = parseInt(st.heightPx, 10);
    if (typeof st.minWidth === "string" && st.minWidth.trim()) {
      nest.style.minWidth = st.minWidth;
    } else {
      nest.style.minWidth = !isNaN(mw) && mw > 0 ? mw + "px" : "";
    }
    if (typeof st.minHeight === "string" && st.minHeight.trim()) {
      nest.style.minHeight = st.minHeight;
    } else {
      nest.style.minHeight = !isNaN(mh) && mh > 0 ? mh + "px" : "";
    }
    if (typeof st.padding === "string" && st.padding.trim()) {
      nest.style.padding = st.padding;
    } else {
      nest.style.padding = !isNaN(pad) && pad >= 0 ? pad + "px" : "";
    }
    if (typeof st.width === "string" && st.width.trim()) {
      nest.style.width = st.width;
    } else {
      nest.style.width = !isNaN(ww) && ww > 0 ? ww + "px" : "";
    }
    if (typeof st.height === "string" && st.height.trim()) {
      nest.style.height = st.height;
    } else {
      nest.style.height = !isNaN(hh) && hh > 0 ? hh + "px" : "";
    }
    applyContainerBackgroundWithAlpha(
      nest,
      st.backgroundColor && String(st.backgroundColor).trim() ? st.backgroundColor : "",
      Object.prototype.hasOwnProperty.call(st, "backgroundAlphaPct") ? st.backgroundAlphaPct : 100
    );
    if (typeof st.borderRadius === "string" && st.borderRadius.trim()) {
      nest.style.borderRadius = st.borderRadius;
    } else {
      let borderR = 6;
      if (Object.prototype.hasOwnProperty.call(st, "borderRadiusPx")) {
        const br = parseInt(st.borderRadiusPx, 10);
        borderR = !isNaN(br) && br >= 0 ? br : 0;
      }
      nest.style.borderRadius = borderR + "px";
    }
  }

  function bumpIdSeqFromId(idStr) {
    const m = typeof idStr === "string" && idStr.match(/^blk-(\d+)$/);
    if (m) idSeq = Math.max(idSeq, parseInt(m[1], 10));
  }

  function defaultImagePlaceholderSrc() {
    return (
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140"><rect fill="#e5e7eb" width="100%" height="100%"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#6b7280" font-size="12">ドラッグで画像を挿入できます</text></svg>'
      )
    );
  }

  function cssBackgroundImageUrl(src) {
    if (!src) return "none";
    return 'url("' + String(src).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '")';
  }

  function normalizeBgFit(v) {
    if (v === "contain" || v === "repeat") return v;
    return "cover";
  }

  function applyCanvasBackground() {
    canvas.style.backgroundColor = canvasBgColor;
    if (canvasBgImageSrc) {
      canvas.style.backgroundImage = cssBackgroundImageUrl(canvasBgImageSrc);
      canvas.style.backgroundPosition = "center center";
      const fit = normalizeBgFit(canvasBgFit);
      if (fit === "repeat") {
        canvas.style.backgroundRepeat = "repeat";
        canvas.style.backgroundSize = "auto";
      } else {
        canvas.style.backgroundRepeat = "no-repeat";
        canvas.style.backgroundSize = fit === "contain" ? "contain" : "cover";
      }
    } else {
      canvas.style.backgroundImage = "none";
      canvas.style.backgroundSize = "";
      canvas.style.backgroundPosition = "";
      canvas.style.backgroundRepeat = "";
    }
  }

  function clearCanvasBackgroundImage() {
    canvasBgImageSrc = "";
    if (canvasBgImageUrlInput) canvasBgImageUrlInput.value = "";
    if (canvasBgImageFileInput) canvasBgImageFileInput.value = "";
    applyCanvasBackground();
  }

  function readCanvasBackgroundFromInputs() {
    if (canvasBgColorHexInput) {
      const fromHex = normalizeHexColor(canvasBgColorHexInput.value);
      if (fromHex) {
        canvasBgColor = fromHex;
        if (canvasBgColorInput) canvasBgColorInput.value = fromHex;
        if (canvasBgColorHexInput.value !== fromHex) canvasBgColorHexInput.value = fromHex;
      } else if (canvasBgColorInput) {
        canvasBgColor = canvasBgColorInput.value || "#fffbf6";
        if (canvasBgColorHexInput) canvasBgColorHexInput.value = canvasBgColor;
      }
    } else if (canvasBgColorInput) {
      canvasBgColor = canvasBgColorInput.value || "#fffbf6";
    }
    if (canvasBgImageUrlInput) {
      canvasBgImageSrc = (canvasBgImageUrlInput.value || "").trim();
    }
    if (canvasBgFitSelect) {
      canvasBgFit = normalizeBgFit(canvasBgFitSelect.value);
    }
    applyCanvasBackground();
  }

  function syncCanvasBackgroundInputs() {
    const h = rgbToHex(canvasBgColor) || (canvasBgColor && String(canvasBgColor).trim()) || "#fffbf6";
    const norm = normalizeHexColor(h) || h;
    if (canvasBgColorInput) {
      canvasBgColorInput.value = norm;
    }
    if (canvasBgColorHexInput) {
      canvasBgColorHexInput.value = norm;
    }
    if (canvasBgImageUrlInput) {
      canvasBgImageUrlInput.value = canvasBgImageSrc || "";
    }
    if (canvasBgFitSelect) {
      canvasBgFitSelect.value = normalizeBgFit(canvasBgFit);
    }
  }

  function onCanvasBackgroundInput() {
    readCanvasBackgroundFromInputs();
  }

  function isButtonBgTransparent(btn) {
    return btn.dataset.bgTransparent === "1";
  }

  function readButtonSolidBgForPicker(btn) {
    const s = btn.dataset.bgColorSolid;
    if (s && /^#[0-9A-Fa-f]{6}$/i.test(s)) return s;
    if (!isButtonBgTransparent(btn)) {
      const h = rgbToHex(btn.style.backgroundColor);
      if (h && h !== "#000000") return h;
    }
    return "#7e57a4";
  }

  function setButtonBgTransparent(btn, on, solidHex) {
    if (on) {
      if (!isButtonBgTransparent(btn)) {
        const cur = rgbToHex(btn.style.backgroundColor);
        if (cur) btn.dataset.bgColorSolid = cur;
      }
      btn.dataset.bgTransparent = "1";
      btn.style.backgroundColor = "transparent";
    } else {
      btn.dataset.bgTransparent = "";
      const c = solidHex || btn.dataset.bgColorSolid || "#7e57a4";
      btn.dataset.bgColorSolid = c;
      btn.style.backgroundColor = c;
    }
  }

  function readButtonBgImageSrc(btn) {
    return btn.dataset.bgImageSrc || "";
  }

  function readButtonBgImageFit(btn) {
    return normalizeBgFit(btn.dataset.bgImageFit || "cover");
  }

  function applyButtonBackgroundImage(btn, src, fitOpt) {
    btn.dataset.bgImageSrc = src ? String(src) : "";
    const fit = normalizeBgFit(fitOpt != null ? fitOpt : btn.dataset.bgImageFit || "cover");
    btn.dataset.bgImageFit = fit;
    if (src) {
      btn.style.backgroundImage = cssBackgroundImageUrl(src);
      btn.style.backgroundPosition = "center center";
      if (fit === "repeat") {
        btn.style.backgroundRepeat = "repeat";
        btn.style.backgroundSize = "auto";
      } else {
        btn.style.backgroundRepeat = "no-repeat";
        btn.style.backgroundSize = fit === "contain" ? "contain" : "cover";
      }
    } else {
      btn.style.backgroundImage = "none";
      btn.style.backgroundSize = "";
      btn.style.backgroundPosition = "";
      btn.style.backgroundRepeat = "";
      btn.dataset.bgImageFit = "cover";
    }
  }

  function serializeBlockElement(el) {
    const z = parseInt(el.style.zIndex, 10) || 1;
    const x = parseInt(el.style.left, 10) || 0;
    const y = parseInt(el.style.top, 10) || 0;
    const id = el.id || "";
    const type = el.dataset.type;
    if (type === "text") {
      const inner = el.querySelector(".canvas-block__text");
      const boxW = parseInt(inner && inner.style.width, 10);
      const boxH = parseInt(inner && inner.style.height, 10);
      const st = {
        color: rgbToHex(inner && inner.style.color) || "#3c2355",
        fontWeight: (inner && inner.style.fontWeight) || "400",
        fontFamily: normalizeFontFamily(
          (inner && inner.dataset && inner.dataset.fontFamily) || (inner && inner.style.fontFamily)
        ),
        textAlign: normalizeTextAlign(inner && inner.style.textAlign),
      };
      if (inner && inner.style.fontSize) {
        st.fontSize = inner.style.fontSize;
      } else {
        st.fontSizePx =
          inner && Math.round(parseFloat(getComputedStyle(inner).fontSize))
            ? Math.round(parseFloat(getComputedStyle(inner).fontSize))
            : 16;
      }
      if (inner && inner.style.width) {
        st.width = inner.style.width;
      } else {
        st.widthPx = !isNaN(boxW) && boxW > 0 ? boxW : 0;
      }
      if (inner && inner.style.height) {
        st.height = inner.style.height;
      } else {
        st.heightPx = !isNaN(boxH) && boxH > 0 ? boxH : 0;
      }
      const lh = readStyleLineHeightFromEl(inner);
      if (lh !== undefined) st.lineHeight = lh;
      if (inner && inner.style.letterSpacing) st.letterSpacing = inner.style.letterSpacing;
      if (inner && inner.style.textTransform && inner.style.textTransform !== "none") {
        st.textTransform = inner.style.textTransform;
      }
      let textOut = "";
      if (inner) {
        if (canvasTextBlockHasInnerMarkup(inner)) {
          st.textFormat = "html";
          textOut = inner.innerHTML;
        } else {
          textOut = inner.textContent;
        }
      }
      return attachLayerMetaToSerialized(el, {
        id: id,
        type: "text",
        x: x,
        y: y,
        zIndex: z,
        text: textOut,
        style: st,
      });
    }
    if (type === "image") {
      const img = el.querySelector(".canvas-block__img");
      const w = parseInt(img && img.style.width, 10);
      const h = parseInt(img && img.style.height, 10);
      const brRaw = img && img.style.borderRadius ? String(img.style.borderRadius) : "";
      const brPct = brRaw.indexOf("%") >= 0 ? parseFloat(brRaw) : NaN;
      const out = {
        id: id,
        type: "image",
        x: x,
        y: y,
        zIndex: z,
        src: img ? img.getAttribute("src") || "" : "",
        style: !isNaN(brPct) && brPct >= 0 ? { borderRadiusPct: Math.min(100, Math.max(0, brPct)) } : undefined,
      };
      if (img && img.style.width) {
        out.width = img.style.width;
      } else {
        out.widthPx = !isNaN(w) && w > 0 ? w : 240;
      }
      if (img && img.style.height) {
        out.height = img.style.height;
      } else {
        out.heightPx = !isNaN(h) && h > 0 ? h : 0;
      }
      return attachLayerMetaToSerialized(el, out);
    }
    if (type === "button") {
      const btn = el.querySelector(".canvas-block__btn");
      const pad = btn ? readButtonPadding(btn) : { y: 10, x: 20 };
      const bw = btn ? readButtonBorderWidth(btn) : 0;
      const wPx = btn ? readButtonWidthPx(btn) : 0;
      const hPx = btn ? readButtonHeightPx(btn) : 0;
      return attachLayerMetaToSerialized(el, {
        id: id,
        type: "button",
        x: x,
        y: y,
        zIndex: z,
        label: btn ? btn.textContent : "",
        style: (function () {
          const s = {
            color: rgbToHex(btn && btn.style.color) || "#ffffff",
            backgroundColor: btn && isButtonBgTransparent(btn)
              ? "transparent"
              : rgbToHex(btn.style.backgroundColor) || "#7e57a4",
            backgroundColorSolid:
              (btn && btn.dataset.bgColorSolid) ||
              (btn && !isButtonBgTransparent(btn)
                ? rgbToHex(btn.style.backgroundColor)
                : "") ||
              "#7e57a4",
            paddingVerticalPx: pad.y,
            paddingHorizontalPx: pad.x,
            borderWidthPx: bw,
            borderColor: btn ? readButtonBorderColorHex(btn) : "#1e293b",
            backgroundImageSrc: btn ? readButtonBgImageSrc(btn) : "",
            backgroundImageFit: btn ? readButtonBgImageFit(btn) : "cover",
            fontWeight: (btn && btn.style.fontWeight) || "600",
            fontFamily: normalizeFontFamily(btn && btn.style.fontFamily),
            blockAlign: normalizeTextAlign(el.style.textAlign),
          };
          if (btn && btn.style.fontSize) {
            s.fontSize = btn.style.fontSize;
          } else {
            s.fontSizePx =
              btn && Math.round(parseFloat(getComputedStyle(btn).fontSize))
                ? Math.round(parseFloat(getComputedStyle(btn).fontSize))
                : 14;
          }
          if (btn && btn.style.width) {
            s.width = btn.style.width;
          } else {
            s.widthPx = wPx;
          }
          if (btn && btn.style.height) {
            s.height = btn.style.height;
          } else {
            s.heightPx = hPx;
          }
          if (btn && btn.style.borderRadius) {
            s.borderRadius = btn.style.borderRadius;
          } else {
            s.borderRadiusPx = btn ? readButtonBorderRadius(btn) : 6;
          }
          const blh = readStyleLineHeightFromEl(btn);
          if (blh !== undefined) s.lineHeight = blh;
          return s;
        })(),
      });
    }
    if (type === "contact") {
      const form = el.querySelector(".canvas-block__contact-form");
      const title = el.querySelector(".canvas-block__contact-title");
      const btn = el.querySelector(".canvas-block__btn");
      const pad = btn ? readButtonPadding(btn) : { y: 10, x: 20 };
      const bw = btn ? readButtonBorderWidth(btn) : 0;
      let formW = 0;
      let formH = 0;
      if (form) {
        const sw = parseInt(form.style.width, 10);
        const sh = parseInt(form.style.height, 10);
        formW = !isNaN(sw) && sw > 0 ? sw : form.offsetWidth;
        formH = !isNaN(sh) && sh > 0 ? sh : form.offsetHeight;
      }
      const cm = el.dataset.contactMode || "none";
      const cv = el.dataset.contactValue || "";
      const cgap = form ? readContactGapsPctFromForm(form) : normalizeContactGapsPct(null);
      const headStyle = readContactHeadingStyleFromDomForSerialize(el);
      return attachLayerMetaToSerialized(el, {
        id: id,
        type: "contact",
        x: x,
        y: y,
        zIndex: z,
        label: title ? title.textContent : "",
        submitLabel: btn ? btn.textContent : "送信",
        contact: {
          mode: cm === "email" || cm === "line" || cm === "url" || cm === "none" ? cm : "none",
          value: String(cv),
        },
        style: (function () {
          const st = {
            color: rgbToHex(btn && btn.style.color) || "#ffffff",
            backgroundColor: btn && isButtonBgTransparent(btn)
              ? "transparent"
              : rgbToHex(btn.style.backgroundColor) || "#7e57a4",
            backgroundColorSolid:
              (btn && btn.dataset.bgColorSolid) ||
              (btn && !isButtonBgTransparent(btn)
                ? rgbToHex(btn.style.backgroundColor)
                : "") ||
              "#7e57a4",
            fieldHeightsPx: readContactFieldHeightsPx(el),
            contactGapTitleBodyPct: cgap.titleBody,
            contactGapFieldsPct: cgap.fields,
            contactGapMainButtonPct: cgap.mainButton,
            contactGapLabelFieldPct: cgap.labelField,
            contactTitleColor: headStyle.contactTitleColor,
            contactTitleTextAlign: headStyle.contactTitleTextAlign,
            contactFieldLabelColors: headStyle.contactFieldLabelColors,
            contactFieldLabelTextAligns: headStyle.contactFieldLabelTextAligns,
            contactFormBackgroundColor: form ? readContactFormBackgroundResolved(form) : "#ffffff",
            paddingVerticalPx: pad.y,
            paddingHorizontalPx: pad.x,
            borderWidthPx: bw,
            borderColor: btn ? readButtonBorderColorHex(btn) : "#1e293b",
            backgroundImageSrc: btn ? readButtonBgImageSrc(btn) : "",
            backgroundImageFit: btn ? readButtonBgImageFit(btn) : "cover",
          };
          if (headStyle.contactTitleFontSize) {
            st.contactTitleFontSize = headStyle.contactTitleFontSize;
          } else {
            st.contactTitleFontSizePx = headStyle.contactTitleFontSizePx;
          }
          if (Array.isArray(headStyle.contactFieldLabelFontSizes)) {
            st.contactFieldLabelFontSizes = headStyle.contactFieldLabelFontSizes;
          }
          st.contactFieldLabelFontSizePx = headStyle.contactFieldLabelFontSizePx;
          if (btn && btn.style.fontSize) {
            st.fontSize = btn.style.fontSize;
          } else {
            st.fontSizePx =
              btn && Math.round(parseFloat(getComputedStyle(btn).fontSize))
                ? Math.round(parseFloat(getComputedStyle(btn).fontSize))
                : 14;
          }
          if (form && form.style.width) {
            st.formWidth = form.style.width;
          } else {
            st.widthPx = formW;
          }
          if (form && form.style.height) {
            st.formHeight = form.style.height;
          } else {
            st.heightPx = formH;
          }
          if (form && form.style.borderRadius) {
            st.contactFormBorderRadius = form.style.borderRadius;
          } else {
            st.contactFormBorderRadiusPx = form ? readContactFormBorderRadiusPx(form) : 8;
          }
          if (btn && btn.style.width) {
            st.submitWidth = btn.style.width;
          } else {
            st.submitWidthPx = readButtonWidthPx(btn);
          }
          if (btn && btn.style.height) {
            st.submitHeight = btn.style.height;
          } else {
            st.submitHeightPx = readButtonHeightPx(btn);
          }
          if (btn && btn.style.borderRadius) {
            st.borderRadius = btn.style.borderRadius;
          } else {
            st.borderRadiusPx = btn ? readButtonBorderRadius(btn) : 6;
          }
          return st;
        })(),
      });
    }
    if (type === "container") {
      const nest = el.querySelector(".canvas-block__nest");
      const kids = nest
        ? Array.from(nest.querySelectorAll(":scope > .canvas-block"))
            .map(serializeBlockElement)
            .filter(Boolean)
        : [];
      kids.sort(function (a, b) {
        return (parseInt(a.zIndex, 10) || 0) - (parseInt(b.zIndex, 10) || 0);
      });
      return attachLayerMetaToSerialized(el, {
        id: id,
        type: "container",
        x: x,
        y: y,
        zIndex: z,
        style: nest ? readContainerStyleFromNest(nest) : {},
        children: kids,
      });
    }
    return null;
  }

  function serializeCurrentViewportSlice() {
    const byState = blocksStackSorted()
      .map(serializeBlockElement)
      .filter(Boolean);
    const byDom = Array.from(canvas.querySelectorAll(":scope > .canvas-block"))
      .map(serializeBlockElement)
      .filter(Boolean);
    // state 側が空でも DOM 側に残っているケースを拾う
    const blocks = byState.length > 0 ? byState : byDom;
    console.log("保存するblocks:", blocks);
    if (!blocks.length) {
      console.warn("[NoCodePersist] blocks が空のまま保存されます。キャンバス要素取得結果を確認してください。");
    }
    return {
      canvas: {
        widthPx: canvasWorkWidthPx,
        floorHeightPx: canvasFloorHeightPx,
        backgroundColor: canvasBgColor,
        backgroundImageSrc: canvasBgImageSrc,
        backgroundImageFit: normalizeBgFit(canvasBgFit),
      },
      blocks: blocks,
    };
  }

  function commitCurrentViewportToCache() {
    viewportsCache[editingViewport] = serializeCurrentViewportSlice();
  }

  /**
   * 以前は保存時にアクティブ側の blocks を非アクティブ側へ複製していたが、
   * テンプレは PC / スマホで別 JSON となり、編集内容もビューごとに独立させる。
   * 複製は行わない（commitCurrentViewportToCache のみが各スライスを更新する）。
   */
  function syncInactiveViewportBlocksFromActiveForSave() {}

  /**
   * 読み込み用: 片方のビューだけブロックが残る壊れた保存を直す。
   * PC が空・スマホのみブロック → スマホを空に（白紙に合わせる）。
   * スマホが空・PC のみブロック → スマホに PC と同じブロックを複製。
   */
  function repairDualViewportDocIfOrphanBlocks(doc) {
    if (!doc || doc.layoutMode !== "dualViewport" || !doc.viewports) {
      return { doc: doc, repaired: false };
    }
    const d = doc.viewports.desktop && doc.viewports.desktop.blocks;
    const r = doc.viewports.responsive && doc.viewports.responsive.blocks;
    const dl = Array.isArray(d) ? d.length : 0;
    const rl = Array.isArray(r) ? r.length : 0;
    if (dl === 0 && rl === 0) {
      return { doc: doc, repaired: false };
    }
    if (dl > 0 && rl > 0) {
      return { doc: doc, repaired: false };
    }
    const out = JSON.parse(JSON.stringify(doc));
    if (dl === 0 && rl > 0) {
      out.viewports.responsive = normalizeViewportSlice({
        canvas: out.viewports.responsive.canvas,
        blocks: [],
      });
      return { doc: out, repaired: true };
    }
    if (rl === 0 && dl > 0) {
      out.viewports.responsive = normalizeViewportSlice({
        canvas: out.viewports.responsive.canvas,
        blocks: deepCloneJson(d),
      });
      return { doc: out, repaired: true };
    }
    return { doc: doc, repaired: false };
  }

  function serializeCanvasDocument() {
    commitCurrentViewportToCache();
    syncInactiveViewportBlocksFromActiveForSave();
    if (
      viewportSliceHasNoBlocks(viewportsCache.desktop) &&
      viewportSliceHasNoBlocks(viewportsCache.responsive)
    ) {
      setActiveTemplateKeyFromMenu(null);
    }
    const ver =
      typeof window.BLOCK_DOCUMENT_SCHEMA_VERSION === "number"
        ? window.BLOCK_DOCUMENT_SCHEMA_VERSION
        : 2;
    return {
      version: PERSIST_DATA_VERSION,
      schemaVersion: ver,
      layoutMode: "dualViewport",
      editingViewport: editingViewport,
      activeTemplateKey: editorActiveTemplateKey ? editorActiveTemplateKey : null,
      viewports: {
        desktop: deepCloneJson(viewportsCache.desktop),
        responsive: deepCloneJson(viewportsCache.responsive),
      },
    };
  }

  var undoHistoryStack = [];
  var UNDO_HISTORY_MAX = 50;
  var undoHistorySuspended = false;

  function clearUndoHistory() {
    undoHistoryStack.length = 0;
  }

  function pushUndoSnapshot() {
    if (undoHistorySuspended) return;
    if (document.body.classList.contains("nocode-published-mode")) return;
    try {
      var snap = serializeCanvasDocument();
      var j = JSON.stringify(snap);
      if (undoHistoryStack.length > 0 && undoHistoryStack[undoHistoryStack.length - 1] === j) return;
      undoHistoryStack.push(j);
      if (undoHistoryStack.length > UNDO_HISTORY_MAX) undoHistoryStack.shift();
    } catch (err) {}
  }

  function performUndo() {
    if (document.body.classList.contains("nocode-published-mode")) return;
    if (undoHistoryStack.length === 0) return;
    var popped = undoHistoryStack.pop();
    if (!popped) return;
    try {
      var doc = JSON.parse(popped);
      undoHistorySuspended = true;
      if (!applyCanvasDocument(doc)) {
        undoHistoryStack.push(popped);
        return;
      }
      renderLayers();
      stripSalonHeroImageInlineHeightsForResponsiveEdit();
      applyFingerprintTemplateClasses();
      updatePersistStatus("直前の状態に戻しました（Ctrl+Z）");
      scheduleAutoSaveToLocalStorage();
    } catch (err) {
      undoHistoryStack.push(popped);
    } finally {
      undoHistorySuspended = false;
    }
  }

  function syncBlockResizePropInputs(wrap) {
    if (selectedBlocks.length !== 1 || primarySelected() !== wrap) return;
    const t = wrap.dataset.type;
    if (t === "text") {
      const inner = wrap.querySelector(".canvas-block__text");
      if (inner) {
        syncCssLengthControls("prop-text-w", inner, "width", Math.round(wrap.offsetWidth));
        syncCssLengthControls("prop-text-h", inner, "height", Math.round(wrap.offsetHeight));
      }
    } else if (t === "image") {
      const img = wrap.querySelector(".canvas-block__img");
      if (img) {
        syncCssLengthControls("prop-img-w", img, "width", Math.round(img.offsetWidth));
        syncCssLengthControls("prop-img-h", img, "height", Math.round(img.offsetHeight));
      }
    } else if (t === "contact") {
      const btn = wrap.querySelector(".canvas-block__btn");
      if (btn) {
        syncCssLengthControls("prop-btn-w", btn, "width", readButtonWidthPx(btn) || Math.round(btn.offsetWidth));
        syncCssLengthControls("prop-btn-h", btn, "height", readButtonHeightPx(btn) || Math.round(btn.offsetHeight));
      }
    } else if (t === "button") {
      const btn = wrap.querySelector(".canvas-block__btn");
      if (btn) {
        syncCssLengthControls("prop-btn-w", btn, "width", readButtonWidthPx(btn) || Math.round(btn.offsetWidth));
        syncCssLengthControls("prop-btn-h", btn, "height", readButtonHeightPx(btn) || Math.round(btn.offsetHeight));
      }
    }
  }

  function attachBlockResizeHandle(wrap) {
    if (wrap.querySelector(":scope > .canvas-block__resize-handle")) return;
    const handle = document.createElement("span");
    handle.className = "canvas-block__resize-handle";
    handle.title = "ドラッグしてサイズ変更";
    handle.setAttribute("aria-hidden", "true");
    wrap.appendChild(handle);

    handle.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      pushUndoSnapshot();
      const type = wrap.dataset.type;
      const startX = e.clientX;
      const startY = e.clientY;
      const resizePid = e.pointerId;
      let startW;
      let startH;
      let applySize;

      if (type === "text") {
        const inner = wrap.querySelector(".canvas-block__text");
        if (!inner) return;
        startW = wrap.offsetWidth;
        startH = wrap.offsetHeight;
        applySize = function (w, h) {
          inner.style.width = w + "px";
          inner.style.height = h + "px";
          inner.style.boxSizing = "border-box";
          setCanvasHeight();
          syncBlockResizePropInputs(wrap);
        };
      } else if (type === "image") {
        const img = wrap.querySelector(".canvas-block__img");
        if (!img) return;
        startW = img.offsetWidth;
        startH = img.offsetHeight;
        applySize = function (w, h) {
          img.style.width = w + "px";
          img.style.height = h + "px";
          wrap.style.boxSizing = "border-box";
          wrap.style.width = w + "px";
          wrap.style.height = h + "px";
          syncImageObjectFit(img);
          setCanvasHeight();
          syncBlockResizePropInputs(wrap);
        };
      } else if (type === "contact") {
        const form = wrap.querySelector(".canvas-block__contact-form");
        if (!form) return;
        startW = form.offsetWidth;
        startH = form.offsetHeight;
        form.style.minWidth = effectiveContactFormMinW() + "px";
        form.style.minHeight = CONTACT_FORM_MIN_H + "px";
        applySize = function (w, h) {
          form.style.width = Math.max(effectiveContactFormMinW(), w) + "px";
          form.style.height = Math.max(CONTACT_FORM_MIN_H, h) + "px";
          form.style.boxSizing = "border-box";
          setCanvasHeight();
          syncBlockResizePropInputs(wrap);
        };
      } else if (type === "button") {
        const btn = wrap.querySelector(".canvas-block__btn");
        if (!btn) return;
        startW = btn.offsetWidth;
        startH = btn.offsetHeight;
        applySize = function (w, h) {
          btn.style.width = w + "px";
          btn.style.height = h + "px";
          btn.style.boxSizing = "border-box";
          setCanvasHeight();
          syncBlockResizePropInputs(wrap);
        };
      } else {
        return;
      }

      canvas.classList.add("is-dragging");

      function onMove(ev) {
        if (ev.pointerId !== resizePid) return;
        const dw = ev.clientX - startX;
        const dh = ev.clientY - startY;
        let mw;
        let mh;
        if (type === "text") {
          mw = BLOCK_RESIZE_MIN_TEXT_W;
          mh = BLOCK_RESIZE_MIN_TEXT_H;
        } else if (type === "image") {
          mw = BLOCK_RESIZE_MIN_IMG_W;
          mh = BLOCK_RESIZE_MIN_IMG_H;
        } else if (type === "contact") {
          mw = effectiveContactFormMinW();
          mh = CONTACT_FORM_MIN_H;
        } else {
          mw = BLOCK_RESIZE_MIN_BTN_W;
          mh = BLOCK_RESIZE_MIN_BTN_H;
        }
        const w = Math.max(mw, Math.round(startW + dw));
        const h = Math.max(mh, Math.round(startH + dh));
        applySize(w, h);
      }

      function onUp(ev) {
        if (ev && ev.pointerId !== resizePid) return;
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        canvas.classList.remove("is-dragging");
        setCanvasHeight();
        syncBlockResizePropInputs(wrap);
        renderLayers();
      }

      document.addEventListener("pointermove", onMove, { passive: false });
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    });
  }

  function syncContainerNestDimensionInputs(wrap) {
    if (selectedBlocks.length !== 1 || primarySelected() !== wrap || wrap.dataset.type !== "container") {
      return;
    }
    const nest = wrap.querySelector(".canvas-block__nest");
    if (!nest) return;
    syncCssLengthControls("prop-container-nest-w", nest, "width", Math.round(nest.offsetWidth));
    syncCssLengthControls("prop-container-nest-h", nest, "height", Math.round(nest.offsetHeight));
  }

  function containerNestResizeFloors(nest) {
    const minWParsed = parseInt(nest.style.minWidth, 10);
    const minHParsed = parseInt(nest.style.minHeight, 10);
    const floorW = Math.max(
      CONTAINER_RESIZE_MIN_W,
      !isNaN(minWParsed) && minWParsed > 0 ? minWParsed : 0
    );
    const floorH = Math.max(
      CONTAINER_RESIZE_MIN_H,
      !isNaN(minHParsed) && minHParsed > 0 ? minHParsed : 0
    );
    return { floorW: floorW, floorH: floorH };
  }

  function wireContainerNestDrag(wrap, nest) {
    nest.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.target.closest(".canvas-block__resize-handle")) return;
      if (e.target !== nest) return;
      e.stopPropagation();
      beginBlockDrag(wrap, e.clientX, e.clientY, e.pointerId);
      e.preventDefault();
    });
  }

  function attachContainerNestResize(wrap, nest) {
    const handle = document.createElement("span");
    handle.className = "canvas-block__resize-handle";
    handle.title = "ドラッグしてサイズ変更";
    handle.setAttribute("aria-hidden", "true");
    nest.appendChild(handle);

    handle.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      pushUndoSnapshot();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = nest.offsetWidth;
      const startH = nest.offsetHeight;
      const nestResizePid = e.pointerId;
      canvas.classList.add("is-dragging");

      function onMove(ev) {
        if (ev.pointerId !== nestResizePid) return;
        const floors = containerNestResizeFloors(nest);
        const dw = ev.clientX - startX;
        const dh = ev.clientY - startY;
        const w = Math.max(floors.floorW, Math.round(startW + dw));
        const h = Math.max(floors.floorH, Math.round(startH + dh));
        nest.style.width = w + "px";
        nest.style.height = h + "px";
        setCanvasHeight();
        syncContainerNestDimensionInputs(wrap);
      }

      function onUp(ev) {
        if (ev && ev.pointerId !== nestResizePid) return;
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        canvas.classList.remove("is-dragging");
        setCanvasHeight();
        syncContainerNestDimensionInputs(wrap);
      }

      document.addEventListener("pointermove", onMove, { passive: false });
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    });
  }

  function finalizeContainerBlock(wrap, nest) {
    wireContainerNestDrag(wrap, nest);
    attachContainerNestResize(wrap, nest);
  }

  function buildBlockFromEntry(entry) {
    if (!entry || !entry.type) return null;
    const id = typeof entry.id === "string" && entry.id ? entry.id : nextId();

    if (entry.type === "text") {
      const wrap = document.createElement("div");
      wrap.className = "canvas-block";
      wrap.dataset.type = "text";
      wrap.id = id;
      const st = entry.style || {};
      const p = document.createElement("p");
      p.className = "canvas-block__text";
      const rawText = entry.text != null ? String(entry.text) : "";
      if (st.textFormat === "html") {
        p.innerHTML = sanitizeRichTextHtml(rawText);
      } else {
        p.textContent = rawText;
      }
      if (typeof st.fontSize === "string" && st.fontSize.trim()) {
        p.style.fontSize = st.fontSize;
      } else {
        p.style.fontSize = (parseInt(st.fontSizePx, 10) || 16) + "px";
      }
      p.style.color = st.color || "#3c2355";
      p.style.fontWeight = st.fontWeight || "400";
      applyTextFontFamilyToInner(p, st.fontFamily != null ? st.fontFamily : "sans-serif");
      p.style.textAlign = normalizeTextAlign(st.textAlign);
      applyStyleLineHeight(p, st);
      if (st.letterSpacing != null && st.letterSpacing !== "") {
        const ls = st.letterSpacing;
        p.style.letterSpacing = typeof ls === "number" ? ls + "em" : String(ls);
      }
      if (st.textTransform === "uppercase" || st.textTransform === "lowercase" || st.textTransform === "none") {
        p.style.textTransform = st.textTransform;
      }
      if (typeof st.width === "string" && st.width.trim()) {
        p.style.width = st.width;
        p.style.boxSizing = "border-box";
      } else {
        const tw = parseInt(st.widthPx, 10);
        if (!isNaN(tw) && tw > 0) {
          p.style.width = tw + "px";
          p.style.boxSizing = "border-box";
        }
      }
      if (typeof st.height === "string" && st.height.trim()) {
        p.style.height = st.height;
        p.style.boxSizing = "border-box";
      } else {
        const th = parseInt(st.heightPx, 10);
        if (!isNaN(th) && th > 0) {
          p.style.height = th + "px";
          p.style.boxSizing = "border-box";
        }
      }
      wrap.appendChild(p);
      attachCanvasTextPaste(p);
      bindBlock(wrap);
      return wrap;
    }

    if (entry.type === "image") {
      const wrap = document.createElement("div");
      wrap.className = "canvas-block";
      wrap.dataset.type = "image";
      wrap.id = id;
      const st = entry.style || {};
      const img = document.createElement("img");
      img.className = "canvas-block__img";
      img.alt = "";
      img.draggable = false;
      const w = parseInt(entry.widthPx, 10);
      const ih = parseInt(entry.heightPx, 10);
      const effW = !isNaN(w) && w > 0 ? w : 240;
      if (typeof entry.width === "string" && entry.width.trim()) {
        img.style.width = entry.width;
      } else {
        img.style.width = effW + "px";
      }
      if (typeof entry.height === "string" && entry.height.trim()) {
        img.style.height = entry.height;
        syncImageObjectFit(img);
      } else if (!isNaN(ih) && ih > 0) {
        img.style.height = ih + "px";
        syncImageObjectFit(img);
      }
      wrap.style.boxSizing = "border-box";
      wrap.style.width = effW + "px";
      if (!isNaN(ih) && ih > 0) {
        wrap.style.height = ih + "px";
      }
      const brPct = parseFloat(st.borderRadiusPct);
      if (!isNaN(brPct) && brPct >= 0) {
        img.style.borderRadius = Math.min(100, Math.max(0, brPct)) + "%";
      }
      img.src = entry.src || defaultImagePlaceholderSrc();
      wrap.appendChild(img);
      requestAnimationFrame(function () {
        if (img.offsetWidth) wrap.style.width = img.offsetWidth + "px";
        if (img.offsetHeight) wrap.style.height = img.offsetHeight + "px";
      });
      bindBlock(wrap);
      return wrap;
    }

    if (entry.type === "button") {
      const wrap = document.createElement("div");
      wrap.className = "canvas-block";
      wrap.dataset.type = "button";
      wrap.id = id;
      const st = entry.style || {};
      wrap.style.textAlign = normalizeTextAlign(st.blockAlign);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "canvas-block__btn";
      btn.textContent = entry.label != null ? String(entry.label) : "ボタン";
      if (typeof st.fontSize === "string" && st.fontSize.trim()) {
        btn.style.fontSize = st.fontSize;
      } else {
        btn.style.fontSize = (parseInt(st.fontSizePx, 10) || 14) + "px";
      }
      btn.style.fontWeight = st.fontWeight != null ? String(st.fontWeight) : "600";
      btn.style.fontFamily = normalizeFontFamily(st.fontFamily != null ? st.fontFamily : "sans-serif");
      btn.style.color = st.color || "#ffffff";
      const solidBg =
        typeof st.backgroundColorSolid === "string" && st.backgroundColorSolid
          ? st.backgroundColorSolid
          : st.backgroundColor && st.backgroundColor !== "transparent"
            ? st.backgroundColor
            : "#7e57a4";
      btn.dataset.bgColorSolid =
        typeof solidBg === "string" && solidBg.indexOf("#") === 0 && solidBg.length >= 4
          ? solidBg
          : "#7e57a4";
      if (st.backgroundColor === "transparent") {
        btn.dataset.bgTransparent = "1";
        btn.style.backgroundColor = "transparent";
      } else {
        btn.dataset.bgTransparent = "";
        btn.style.backgroundColor = st.backgroundColor || btn.dataset.bgColorSolid;
        btn.dataset.bgColorSolid = rgbToHex(btn.style.backgroundColor) || btn.dataset.bgColorSolid;
      }
      const py = parseInt(st.paddingVerticalPx, 10);
      const px = parseInt(st.paddingHorizontalPx, 10);
      setButtonPadding(
        btn,
        !isNaN(py) ? py : 10,
        !isNaN(px) ? px : 20
      );
      if (typeof st.borderRadius === "string" && st.borderRadius.trim()) {
        btn.style.borderRadius = st.borderRadius;
      } else {
        const br = parseInt(st.borderRadiusPx, 10);
        btn.style.borderRadius = (!isNaN(br) ? br : 6) + "px";
      }
      const bwi = parseInt(st.borderWidthPx, 10);
      const borderW = !isNaN(bwi) ? Math.max(0, bwi) : 0;
      if (borderW > 0) {
        applyButtonBorderSides(btn, borderW, st.borderColor || "#1e293b");
      } else {
        applyButtonBorderSides(btn, 0);
        if (st.borderColor) {
          setButtonBorderColorsOnly(btn, st.borderColor);
        }
      }
      const wp = parseInt(st.widthPx, 10);
      const hp = parseInt(st.heightPx, 10);
      if (typeof st.width === "string" && st.width.trim()) {
        btn.style.width = st.width;
      } else if (!isNaN(wp) && wp > 0) {
        btn.style.width = wp + "px";
      }
      if (typeof st.height === "string" && st.height.trim()) {
        btn.style.height = st.height;
      } else if (!isNaN(hp) && hp > 0) {
        btn.style.height = hp + "px";
      }
      applyStyleLineHeight(btn, st);
      if (st.backgroundImageSrc) {
        applyButtonBackgroundImage(btn, st.backgroundImageSrc, st.backgroundImageFit);
      } else {
        applyButtonBackgroundImage(btn, "");
      }
      wrap.appendChild(btn);
      attachPlainPaste(btn);
      bindBlock(wrap);
      return wrap;
    }

    if (entry.type === "contact") {
      const wrap = document.createElement("div");
      wrap.className = "canvas-block canvas-block--contact";
      wrap.dataset.type = "contact";
      wrap.id = id;
      const c = entry.contact || {};
      wrap.dataset.contactMode =
        c.mode === "email" || c.mode === "line" || c.mode === "url" || c.mode === "none"
          ? c.mode
          : "none";
      wrap.dataset.contactValue = c.value != null ? String(c.value) : "";
      const st = entry.style || {};
      let titleText = "お問い合わせ";
      let submitText = "送信";
      if (Object.prototype.hasOwnProperty.call(entry, "submitLabel")) {
        titleText = entry.label != null ? String(entry.label) : "お問い合わせ";
        submitText = entry.submitLabel != null ? String(entry.submitLabel) : "送信";
      } else {
        submitText = entry.label != null ? String(entry.label) : "お問い合わせ";
        titleText = "お問い合わせ";
      }
      const chrome = buildContactFormShell(
        titleText,
        submitText,
        st.fieldHeightsPx,
        readContactGapsFromSerializedStyle(st),
        st
      );
      const form = chrome.form;
      const btn = chrome.btn;
      if (typeof st.fontSize === "string" && st.fontSize.trim()) {
        btn.style.fontSize = st.fontSize;
      } else {
        btn.style.fontSize = (parseInt(st.fontSizePx, 10) || 14) + "px";
      }
      btn.style.color = st.color || "#ffffff";
      const solidBg =
        typeof st.backgroundColorSolid === "string" && st.backgroundColorSolid
          ? st.backgroundColorSolid
          : st.backgroundColor && st.backgroundColor !== "transparent"
            ? st.backgroundColor
            : "#7e57a4";
      btn.dataset.bgColorSolid =
        typeof solidBg === "string" && solidBg.indexOf("#") === 0 && solidBg.length >= 4
          ? solidBg
          : "#7e57a4";
      if (st.backgroundColor === "transparent") {
        btn.dataset.bgTransparent = "1";
        btn.style.backgroundColor = "transparent";
      } else {
        btn.dataset.bgTransparent = "";
        btn.style.backgroundColor = st.backgroundColor || btn.dataset.bgColorSolid;
        btn.dataset.bgColorSolid = rgbToHex(btn.style.backgroundColor) || btn.dataset.bgColorSolid;
      }
      const py = parseInt(st.paddingVerticalPx, 10);
      const px = parseInt(st.paddingHorizontalPx, 10);
      setButtonPadding(
        btn,
        !isNaN(py) ? py : 10,
        !isNaN(px) ? px : 20
      );
      if (typeof st.borderRadius === "string" && st.borderRadius.trim()) {
        btn.style.borderRadius = st.borderRadius;
      } else {
        const br = parseInt(st.borderRadiusPx, 10);
        btn.style.borderRadius = (!isNaN(br) ? br : 6) + "px";
      }
      const bwi = parseInt(st.borderWidthPx, 10);
      const borderW = !isNaN(bwi) ? Math.max(0, bwi) : 0;
      if (borderW > 0) {
        applyButtonBorderSides(btn, borderW, st.borderColor || "#1e293b");
      } else {
        applyButtonBorderSides(btn, 0);
        if (st.borderColor) {
          setButtonBorderColorsOnly(btn, st.borderColor);
        }
      }
      const wp = parseInt(st.widthPx, 10);
      const hp = parseInt(st.heightPx, 10);
      form.style.boxSizing = "border-box";
      form.style.minWidth = effectiveContactFormMinW() + "px";
      form.style.minHeight = CONTACT_FORM_MIN_H + "px";
      if (typeof st.formWidth === "string" && st.formWidth.trim()) {
        form.style.width = st.formWidth;
      } else if (!isNaN(wp) && wp > 0) {
        form.style.width = Math.max(effectiveContactFormMinW(), wp) + "px";
      } else {
        form.style.width = effectiveContactFormMinW() + "px";
      }
      if (typeof st.formHeight === "string" && st.formHeight.trim()) {
        form.style.height = st.formHeight;
      } else if (!isNaN(hp) && hp > 0) {
        form.style.height = Math.max(CONTACT_FORM_MIN_H, hp) + "px";
      }
      if (
        typeof st.contactFormBackgroundColor === "string" &&
        st.contactFormBackgroundColor.indexOf("#") === 0
      ) {
        form.style.backgroundColor = st.contactFormBackgroundColor;
      }
      if (typeof st.contactFormBorderRadius === "string" && st.contactFormBorderRadius.trim()) {
        form.style.borderRadius = st.contactFormBorderRadius;
      } else {
        var cfr = parseInt(st.contactFormBorderRadiusPx, 10);
        if (!isNaN(cfr) && cfr >= 0) {
          form.style.borderRadius = cfr + "px";
        } else {
          form.style.borderRadius = "8px";
        }
      }
      const sws = parseInt(st.submitWidthPx, 10);
      const shs = parseInt(st.submitHeightPx, 10);
      if (
        typeof st.submitWidth === "string" ||
        typeof st.submitHeight === "string" ||
        Object.prototype.hasOwnProperty.call(st, "submitWidthPx") ||
        Object.prototype.hasOwnProperty.call(st, "submitHeightPx")
      ) {
        if (typeof st.submitWidth === "string" && st.submitWidth.trim()) {
          btn.style.width = st.submitWidth;
        } else if (!isNaN(sws) && sws > 0) {
          btn.style.width = sws + "px";
        } else {
          btn.style.width = "100%";
        }
        btn.style.boxSizing = "border-box";
        btn.style.maxWidth = "100%";
        if (typeof st.submitHeight === "string" && st.submitHeight.trim()) {
          btn.style.height = st.submitHeight;
        } else if (!isNaN(shs) && shs > 0) {
          btn.style.height = shs + "px";
        }
      } else {
        btn.style.width = "100%";
        btn.style.boxSizing = "border-box";
      }
      if (st.backgroundImageSrc) {
        applyButtonBackgroundImage(btn, st.backgroundImageSrc, st.backgroundImageFit);
      } else {
        applyButtonBackgroundImage(btn, "");
      }
      wireContactSubmitAction(wrap, btn);
      wrap.appendChild(form);
      attachPlainPaste(btn);
      bindBlock(wrap);
      return wrap;
    }

    if (entry.type === "container") {
      const wrap = document.createElement("div");
      wrap.className = "canvas-block canvas-block--container";
      wrap.dataset.type = "container";
      wrap.id = id;
      const nest = document.createElement("div");
      nest.className = "canvas-block__nest";
      applyContainerStyleToNest(nest, entry.style || {});
      wrap.appendChild(nest);
      bindBlock(wrap);
      finalizeContainerBlock(wrap, nest);
      return wrap;
    }

    return null;
  }

  function finalizeMountedNode(node, entry) {
    const x = parseInt(entry.x, 10) || 0;
    const y = parseInt(entry.y, 10) || 0;
    node.dataset.layoutX = String(x);
    node.dataset.layoutY = String(y);
    placeBlock(node, x, y);
    node.style.zIndex = String(parseInt(entry.zIndex, 10) || 1);
    if (entry.type === "container" && Array.isArray(entry.children)) {
      const nest = node.querySelector(".canvas-block__nest");
      if (nest) {
        const kids = entry.children.slice().sort(function (a, b) {
          return (parseInt(a.zIndex, 10) || 0) - (parseInt(b.zIndex, 10) || 0);
        });
        kids.forEach(function (ch) {
          mountBlockTree(ch, nest);
        });
      }
    }
  }

  function mountBlockTree(entry, parentEl) {
    const node = buildBlockFromEntry(entry);
    if (!node) return null;
    finalizeBlockLayerMeta(node, entry);
    parentEl.appendChild(node);
    finalizeMountedNode(node, entry);
    return node;
  }

  function clipSchemaMax() {
    return typeof window.BLOCK_DOCUMENT_SCHEMA_VERSION === "number"
      ? window.BLOCK_DOCUMENT_SCHEMA_VERSION
      : 2;
  }

  function validateClipboardBlockPayload(payload) {
    if (!payload || payload.kind !== CLIPBOARD_BLOCK_KIND || !payload.block || !payload.block.type) {
      return false;
    }
    const ver = clipSchemaMax();
    if (typeof payload.schemaVersion !== "number" || payload.schemaVersion < 1 || payload.schemaVersion > ver) {
      return false;
    }
    return true;
  }

  function assignFreshIdsToBlockEntry(entry) {
    function walk(e) {
      if (!e || !e.type) return;
      e.id = nextId();
      if (e.type === "container" && Array.isArray(e.children)) {
        e.children.forEach(walk);
      }
    }
    walk(entry);
  }

  function offsetBlockEntryRootPosition(entry, dx, dy) {
    entry.x = (parseInt(entry.x, 10) || 0) + dx;
    entry.y = (parseInt(entry.y, 10) || 0) + dy;
  }

  function copySelectedBlockToClipboard() {
    const p = primarySelected();
    if (!p || !canvas.contains(p)) return;
    const blockEntry = serializeBlockElement(p);
    if (!blockEntry) return;
    const payload = {
      kind: CLIPBOARD_BLOCK_KIND,
      schemaVersion: clipSchemaMax(),
      block: blockEntry,
    };
    internalClipboard = payload;
    const text = JSON.stringify(payload);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
    }
  }

  function mountPastedBlockEntry(blockEntry) {
    pushUndoSnapshot();
    const entry = JSON.parse(JSON.stringify(blockEntry));
    assignFreshIdsToBlockEntry(entry);
    offsetBlockEntryRootPosition(entry, PASTE_POSITION_OFFSET, PASTE_POSITION_OFFSET);
    const target = getAppendTargetForNewBlock();
    const node = mountBlockTree(entry, target.parent);
    if (!node) return false;
    node.style.zIndex = String(nextZIndexInParent(target.parent));
    canvas.querySelectorAll(".canvas-block").forEach(function (b) {
      bumpIdSeqFromId(b.id);
    });
    selectBlock(node);
    setCanvasHeight();
    renderLayers();
    return true;
  }

  function tryPasteFromClipboardText(text) {
    if (!text || typeof text !== "string") return false;
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (err) {
      return false;
    }
    if (!validateClipboardBlockPayload(payload)) return false;
    return mountPastedBlockEntry(payload.block);
  }

  function pasteFromClipboard() {
    if (navigator.clipboard && navigator.clipboard.readText) {
      return navigator.clipboard
        .readText()
        .then(function (text) {
          if (tryPasteFromClipboardText(text)) return true;
          if (internalClipboard && validateClipboardBlockPayload(internalClipboard)) {
            return mountPastedBlockEntry(internalClipboard.block);
          }
          return false;
        })
        .catch(function () {
          if (internalClipboard && validateClipboardBlockPayload(internalClipboard)) {
            return mountPastedBlockEntry(internalClipboard.block);
          }
          return false;
        });
    }
    if (internalClipboard && validateClipboardBlockPayload(internalClipboard)) {
      return Promise.resolve(mountPastedBlockEntry(internalClipboard.block));
    }
    return Promise.resolve(false);
  }

  function applyCanvasSliceToDom(slice) {
    const docCanvas = slice && slice.canvas ? slice.canvas : {};
    deselect();
    canvas.querySelectorAll(".canvas-block").forEach(function (b) {
      b.remove();
    });
    const fh = docCanvas.floorHeightPx;
    if (typeof fh === "number" && !isNaN(fh)) {
      canvasFloorHeightPx = clampCanvasHeight(fh);
      if (canvasHeightInput) canvasHeightInput.value = String(canvasFloorHeightPx);
    }
    const cvis = docCanvas;
    if (typeof cvis.widthPx === "number" && !isNaN(cvis.widthPx)) {
      canvasWorkWidthPx = clampCanvasWidth(cvis.widthPx);
    } else {
      canvasWorkWidthPx = clampCanvasWidth(1200);
    }
    if (canvasWidthInput) canvasWidthInput.value = String(canvasWorkWidthPx);
    applyCanvasWorkWidth();
    canvasBgColor =
      typeof cvis.backgroundColor === "string" && cvis.backgroundColor
        ? cvis.backgroundColor
        : "#fffbf6";
    canvasBgImageSrc =
      typeof cvis.backgroundImageSrc === "string" ? cvis.backgroundImageSrc : "";
    canvasBgFit =
      typeof cvis.backgroundImageFit === "string"
        ? normalizeBgFit(cvis.backgroundImageFit)
        : "cover";
    syncCanvasBackgroundInputs();
    applyCanvasBackground();
    const entries = Array.isArray(slice.blocks) ? slice.blocks.slice() : [];
    entries.sort(function (a, b) {
      return (parseInt(a.zIndex, 10) || 0) - (parseInt(b.zIndex, 10) || 0);
    });
    idSeq = 0;
    entries.forEach(function (entry) {
      mountBlockTree(entry, canvas);
    });
    canvas.querySelectorAll(".canvas-block").forEach(function (b) {
      bumpIdSeqFromId(b.id);
    });
    requestAnimationFrame(function () {
      reclampTopLevelBlocksToCanvas();
      requestAnimationFrame(function () {
        reclampTopLevelBlocksToCanvas();
        reapplyLayoutPositionsFromDataset();
        stripSalonHeroImageInlineHeightsForResponsiveEdit();
        setCanvasHeight();
        centerCanvasInEditorView();
      });
    });
    setCanvasHeight();
    syncCanvasSizeInputs();
    renderLayers();
    applyFingerprintTemplateClasses();
    stripSalonHeroImageInlineHeightsForResponsiveEdit();
    updateViewportToolbar();
    centerCanvasInEditorView();
    return true;
  }

  /**
   * キャンバスが「左に寄って見える」対策（編集画面のみ）。
   * 原因は (1) 横スクロール付き祖先の scrollLeft=0 (2) flex 子の min-width:min-content で広がった列の左端が見えること。
   * #canvas から body まで横方向に余分な scrollWidth がある要素の scrollLeft を中央にし、scrollIntoView(inline:center) も併用する。
   */
  function centerCanvasInEditorView() {
    if (document.body.classList.contains("nocode-published-mode")) return;
    if (!canvas) return;

    function scrollWideAncestorsToCenter() {
      [".main-area", "#canvas-zoom-viewport", ".canvas-scroll", ".workspace", ".app-body"].forEach(function (sel) {
        var node = document.querySelector(sel);
        if (!node) return;
        var sw = node.scrollWidth;
        var cw = node.clientWidth;
        if (sw > cw + 1) {
          node.scrollLeft = Math.max(0, (sw - cw) / 2);
        }
      });
      var el = canvas;
      while (el && el !== document.body) {
        var sw = el.scrollWidth;
        var cw = el.clientWidth;
        if (sw > cw + 1) {
          el.scrollLeft = Math.max(0, (sw - cw) / 2);
        }
        el = el.parentElement;
      }
    }

    function run() {
      scrollWideAncestorsToCenter();
      if (canvas.scrollIntoView) {
        try {
          canvas.scrollIntoView({ block: "nearest", inline: "center", behavior: "instant" });
        } catch (e) {
          try {
            canvas.scrollIntoView({ block: "nearest", inline: "center" });
          } catch (e2) {
            try {
              canvas.scrollIntoView(false);
            } catch (e3) {}
          }
        }
      }
      scrollWideAncestorsToCenter();
    }

    run();
    requestAnimationFrame(function () {
      run();
      requestAnimationFrame(function () {
        run();
        requestAnimationFrame(run);
      });
    });
    setTimeout(run, 0);
    setTimeout(run, 80);
    setTimeout(run, 250);
    setTimeout(run, 500);
  }

  function applyCanvasDocument(doc) {
    const ver =
      typeof window.BLOCK_DOCUMENT_SCHEMA_VERSION === "number"
        ? window.BLOCK_DOCUMENT_SCHEMA_VERSION
        : 2;
    if (!doc || typeof doc.schemaVersion !== "number") return false;
    if (doc.schemaVersion < 1 || doc.schemaVersion > ver) return false;
    hydrateViewportsFromRootDoc(doc);
    const sliceOk = applyCanvasSliceToDom(viewportsCache[editingViewport]);
    if (!sliceOk) return false;
    if (
      viewportSliceHasNoBlocks(viewportsCache.desktop) &&
      viewportSliceHasNoBlocks(viewportsCache.responsive)
    ) {
      setActiveTemplateKeyFromMenu(null);
    } else if (!("activeTemplateKey" in doc)) {
      setActiveTemplateKeyFromMenu(null);
    } else if (
      doc.activeTemplateKey &&
      typeof doc.activeTemplateKey === "string" &&
      TEMPLATE_JSON_MAP[doc.activeTemplateKey]
    ) {
      setActiveTemplateKeyFromMenu(doc.activeTemplateKey);
    } else {
      setActiveTemplateKeyFromMenu(null);
    }
    return true;
  }

  function switchEditingViewport(next) {
    if (next !== VIEWPORT_DESKTOP && next !== VIEWPORT_RESPONSIVE) return;
    if (next === editingViewport) return;
    if (document.body.classList.contains("nocode-published-mode")) return;
    commitCurrentViewportToCache();
    const prevViewport = editingViewport;
    editingViewport = next;
    updateViewportToolbar();
    const ok = applyCanvasSliceToDom(viewportsCache[editingViewport]);
    if (!ok) {
      editingViewport = prevViewport;
      updateViewportToolbar();
      return;
    }
    if (editingViewport === VIEWPORT_RESPONSIVE) {
      recalcCanvasHeightForResponsiveView();
    }
  }

  function updateViewportToolbar() {
    const desktopBtn = document.getElementById("viewport-desktop-btn");
    const responsiveBtn = document.getElementById("viewport-responsive-btn");
    const scrollEl = document.querySelector(".canvas-scroll");
    if (desktopBtn) {
      desktopBtn.classList.toggle("is-active", editingViewport === VIEWPORT_DESKTOP);
      desktopBtn.setAttribute("aria-pressed", editingViewport === VIEWPORT_DESKTOP ? "true" : "false");
    }
    if (responsiveBtn) {
      responsiveBtn.classList.toggle("is-active", editingViewport === VIEWPORT_RESPONSIVE);
      responsiveBtn.setAttribute(
        "aria-pressed",
        editingViewport === VIEWPORT_RESPONSIVE ? "true" : "false"
      );
    }
    if (scrollEl) {
      scrollEl.classList.toggle("canvas-scroll--viewport-responsive", editingViewport === VIEWPORT_RESPONSIVE);
    }
    document.body.classList.toggle(
      "nocode-edit-view-responsive",
      editingViewport === VIEWPORT_RESPONSIVE
    );
    if (document.documentElement) {
      document.documentElement.classList.toggle(
        "nocode-published-responsive-scroll",
        document.body.classList.contains("nocode-published-mode") &&
          editingViewport === VIEWPORT_RESPONSIVE
      );
    }
    requestAnimationFrame(function () {
      setCanvasHeight();
    });
  }

  /** lp.html 等の公開プレビュー: 画面幅に応じてスマホ用データを表示、無ければ PC を幅に合わせて縮小 */
  const PUBLISHED_VIEWPORT_MAX_WIDTH_MQ = "(max-width: 900px)";

  function applyPublishedFitDesktopZoom() {
    if (!canvas || !document.body.classList.contains("nocode-published-mode")) return;
    if (!document.body.classList.contains("nocode-published--fit-desktop")) {
      canvas.style.removeProperty("zoom");
      canvas.style.removeProperty("transform");
      canvas.style.removeProperty("transformOrigin");
      return;
    }
    const w = canvasWorkWidthPx || 1200;
    const pad = 24;
    const vw = Math.max(200, window.innerWidth - pad);
    const scale = Math.min(1, vw / Math.max(w, 1));
    try {
      canvas.style.zoom = String(scale);
      canvas.style.removeProperty("transform");
      canvas.style.removeProperty("transformOrigin");
    } catch (err) {
      canvas.style.removeProperty("zoom");
      canvas.style.transformOrigin = "top center";
      canvas.style.transform = "scale(" + scale + ")";
    }
  }

  function syncPublishedViewportLayout() {
    if (!document.body.classList.contains("nocode-published-mode")) return;
    if (!viewportsCache.desktop || !viewportsCache.responsive) return;
    let mq;
    try {
      mq = window.matchMedia(PUBLISHED_VIEWPORT_MAX_WIDTH_MQ);
    } catch (err) {
      return;
    }
    const narrow = mq.matches;
    const responsiveEmpty = viewportSliceHasNoBlocks(viewportsCache.responsive);
    document.body.classList.toggle("nocode-published--fit-desktop", narrow && responsiveEmpty);

    const wantResponsive = narrow && !responsiveEmpty;
    if (wantResponsive) {
      if (editingViewport !== VIEWPORT_RESPONSIVE) {
        editingViewport = VIEWPORT_RESPONSIVE;
        applyCanvasSliceToDom(viewportsCache.responsive);
      } else {
        updateViewportToolbar();
        recalcCanvasHeightForResponsiveView();
      }
    } else {
      if (editingViewport !== VIEWPORT_DESKTOP) {
        editingViewport = VIEWPORT_DESKTOP;
        applyCanvasSliceToDom(viewportsCache.desktop);
      } else {
        updateViewportToolbar();
      }
    }
    applyPublishedFitDesktopZoom();
  }

  /* ---------- 複数テンプレート（data は serialize 互換のブロック配列 → mountBlockTree → buildBlockFromEntry） ---------- */
  const DEFAULT_TEMPLATE_KEY = "cafe";

  const templates = {};

  async function ensureTemplateLoaded(templateName) {
    if (templates[templateName]) return templates[templateName];
    const paths = TEMPLATE_JSON_MAP[templateName];
    if (!paths || !paths.desktop || !paths.mobile) return null;
    const bust =
      "nocode_bust=" + String(Date.now()) + "_" + String(Math.random()).slice(2, 8);
    try {
      const urlD = paths.desktop + (paths.desktop.indexOf("?") >= 0 ? "&" : "?") + bust;
      const urlM = paths.mobile + (paths.mobile.indexOf("?") >= 0 ? "&" : "?") + bust;
      const [desk, mob] = await Promise.all([
        fetch(urlD, { cache: "no-store" }).then(function (r) {
          if (!r.ok) throw new Error(paths.desktop);
          return r.json();
        }),
        fetch(urlM, { cache: "no-store" }).then(function (r) {
          if (!r.ok) throw new Error(paths.mobile);
          return r.json();
        }),
      ]);
      if (!desk || !mob || !Array.isArray(desk.data) || !Array.isArray(mob.data)) {
        return null;
      }
      const merged = {
        name: desk.name && String(desk.name).trim() ? desk.name : mob.name,
        desktop: desk,
        mobile: mob,
      };
      templates[templateName] = merged;
      return merged;
    } catch (err) {
      console.error("[NoCodeTemplates] JSON load failed:", templateName, err);
      return null;
    }
  }

  function getTemplateDocSchemaVersion() {
    return typeof window.BLOCK_DOCUMENT_SCHEMA_VERSION === "number"
      ? window.BLOCK_DOCUMENT_SCHEMA_VERSION
      : 2;
  }

  function defaultTemplateCanvas() {
    return {
      widthPx: 1200,
      floorHeightPx: 480,
      backgroundColor: "#fffbf6",
      backgroundImageSrc: "",
      backgroundImageFit: "cover",
    };
  }

  function createBlankCanvasDocument() {
    const ver = getTemplateDocSchemaVersion();
    const blankDesktop = {
      canvas: Object.assign({}, defaultTemplateCanvas()),
      blocks: [],
    };
    const blankResponsive = deepCloneJson(blankDesktop);
    const rw = clampCanvasWidthValue(
      RESPONSIVE_DEFAULT_CANVAS_WIDTH_PX,
      RESPONSIVE_DEFAULT_CANVAS_WIDTH_PX,
      CANVAS_WIDTH_MIN,
      CANVAS_WIDTH_MAX
    );
    blankResponsive.canvas = Object.assign({}, blankResponsive.canvas, { widthPx: rw });
    return {
      version: PERSIST_DATA_VERSION,
      schemaVersion: ver,
      layoutMode: "dualViewport",
      editingViewport: VIEWPORT_DESKTOP,
      activeTemplateKey: null,
      viewports: {
        desktop: blankDesktop,
        responsive: blankResponsive,
      },
    };
  }

  function startNewBlankDocument() {
    if (canvas.querySelector(":scope > .canvas-block") && !confirmReplaceCanvas()) {
      return;
    }
    if (!applyCanvasDocument(createBlankCanvasDocument())) {
      updatePersistStatus("白紙の作成に失敗しました。");
      return;
    }
    clearUndoHistory();
    currentPageId = null;
    clearPublishPageLink();
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("page");
      history.replaceState({}, "", u.pathname + u.search + u.hash);
    } catch (err) {}
    const sel = document.getElementById("templateSelect");
    if (sel) sel.value = "";
    updatePersistStatus("白紙のキャンバスを作成しました。ブラウザに残すには「今すぐ保存」を押してください。");
  }

  /**
   * テンプレートをキャンバスに適用（内部は applyCanvasDocument → mountBlockTree → buildBlockFromEntry）
   * @param {string} templateName - templates のキー
   * @param {{ silent?: boolean }} [options] - silent: true のとき確認ダイアログを出さない（初期ロード用）
   * @returns {boolean}
   */
  /**
   * @param {"desktop"|"responsive"} sliceKind - responsive では JSON のキャンバス幅を維持（従来は 1200 に上書きされスマホ用が効かなかった）
   */
  function normalizeProductSalesStorySlice(canvasIn, blocksIn, sliceKind) {
    sliceKind = sliceKind === "responsive" ? "responsive" : "desktop";
    let canvas = Object.assign({}, defaultTemplateCanvas(), canvasIn || {});
    if (sliceKind === "desktop") {
      canvas.widthPx = 1200;
      canvas.floorHeightPx = 5340;
    } else {
      const rawW = canvasIn && Number(canvasIn.widthPx);
      const rw =
        Number.isFinite(rawW) && rawW > 0 ? rawW : RESPONSIVE_DEFAULT_CANVAS_WIDTH_PX;
      canvas.widthPx = clampCanvasWidthValue(rw, rw, CANVAS_WIDTH_MIN, CANVAS_WIDTH_MAX);
      const rawF = canvasIn && Number(canvasIn.floorHeightPx);
      if (Number.isFinite(rawF) && rawF > 0) {
        canvas.floorHeightPx = rawF;
      }
    }
    const blocks = blocksIn.map(function (entry) {
      return JSON.parse(JSON.stringify(entry));
    });
    let minX = Infinity;
    let minY = Infinity;
    blocks.forEach(function (b) {
      const bx = parseInt(b && b.x, 10);
      const by = parseInt(b && b.y, 10);
      if (!isNaN(bx)) minX = Math.min(minX, bx);
      if (!isNaN(by)) minY = Math.min(minY, by);
    });
    if (isFinite(minX) && isFinite(minY) && (minX !== 0 || minY !== 0)) {
      blocks.forEach(function (b) {
        b.x = (parseInt(b.x, 10) || 0) - minX;
        b.y = (parseInt(b.y, 10) || 0) - minY;
      });
    }
    return { canvas: canvas, blocks: blocks };
  }

  async function loadTemplate(templateName, options) {
    options = options || {};
    const silent = !!options.silent;
    invalidateTemplateCache(templateName);
    try {
      const pair = await ensureTemplateLoaded(templateName);
      if (!pair || !pair.desktop || !pair.mobile || !Array.isArray(pair.desktop.data)) {
        return false;
      }
      if (!silent && canvas.querySelector(":scope > .canvas-block")) {
        if (
          !window.confirm(
            "現在のキャンバス上の内容はすべて失われます。テンプレートを読み込みますか？"
          )
        ) {
          const sel = document.getElementById("templateSelect");
          if (sel) sel.value = "";
          return false;
        }
      }
      let deskCanvas = Object.assign(defaultTemplateCanvas(), pair.desktop.canvas || {});
      let deskBlocks = pair.desktop.data.map(function (entry) {
        return JSON.parse(JSON.stringify(entry));
      });
      let mobCanvas = Object.assign(defaultTemplateCanvas(), pair.mobile.canvas || {});
      let mobBlocks = pair.mobile.data.map(function (entry) {
        return JSON.parse(JSON.stringify(entry));
      });
      if (templateName === "productSalesStory") {
        const d = normalizeProductSalesStorySlice(pair.desktop.canvas, pair.desktop.data, "desktop");
        deskCanvas = d.canvas;
        deskBlocks = d.blocks;
        const m = normalizeProductSalesStorySlice(pair.mobile.canvas, pair.mobile.data, "responsive");
        mobCanvas = m.canvas;
        mobBlocks = m.blocks;
      }
      const doc = {
        schemaVersion: getTemplateDocSchemaVersion(),
        layoutMode: "dualViewport",
        editingViewport: VIEWPORT_DESKTOP,
        activeTemplateKey: templateName,
        viewports: {
          desktop: { canvas: deskCanvas, blocks: deskBlocks },
          responsive: { canvas: mobCanvas, blocks: mobBlocks },
        },
      };
      const ok = applyCanvasDocument(doc);
      if (ok) {
        clearUndoHistory();
        currentPageId = null;
        /* テンプレはディスクの JSON だが、起動時は localStorage が優先される。読み込み直後に保存して次回リロードでも同じ内容にする。 */
        try {
          saveDocumentToLocalStorage({ quiet: true });
        } catch (eSave) {}
        if (!silent) {
          updatePersistStatus(
            "テンプレートを読み込み、このブラウザに保存しました。再読み込み後もこの内容が使われます。"
          );
        }
      }
      return ok;
    } catch (err) {
      console.error("[NoCodeTemplates] loadTemplate:", err);
      return false;
    }
  }

  function initTemplateUI(opt) {
    opt = opt || {};
    const preserveValue = !!opt.preserveValue;
    const sel = document.getElementById("templateSelect");
    if (!sel) return;
    const prev = preserveValue ? sel.value : "";
    sel.textContent = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "テンプレートを選択…";
    sel.appendChild(placeholder);
    Object.keys(TEMPLATE_JSON_MAP).forEach(function (key) {
      const t = templates[key];
      const optEl = document.createElement("option");
      optEl.value = key;
      optEl.textContent = t && t.name ? String(t.name) : TEMPLATE_LABEL_MAP[key] || key;
      sel.appendChild(optEl);
    });
    if (prev && TEMPLATE_JSON_MAP[prev]) {
      sel.value = prev;
    }
  }

  function registerTemplate(key, def) {
    if (!key || typeof key !== "string" || !def || typeof def !== "object") {
      return false;
    }
    if (
      def.desktop &&
      def.mobile &&
      Array.isArray(def.desktop.data) &&
      Array.isArray(def.mobile.data)
    ) {
      templates[key] = {
        name: def.name || def.desktop.name || def.mobile.name,
        desktop: def.desktop,
        mobile: def.mobile,
      };
      initTemplateUI({ preserveValue: true });
      return true;
    }
    if (!Array.isArray(def.data)) {
      return false;
    }
    templates[key] = def;
    initTemplateUI({ preserveValue: true });
    return true;
  }

  function wireTemplateSelectOnce() {
    const sel = document.getElementById("templateSelect");
    if (!sel || sel.dataset.nocodeWired === "1") return;
    sel.dataset.nocodeWired = "1";
    sel.addEventListener("change", async function () {
      if (sel.dataset.nocodeSuppressChange === "1") return;
      const v = sel.value;
      if (!v) return;
      if (!(await loadTemplate(v))) {
        sel.value = "";
      }
    });
  }

  function shouldSyncLayoutDataset(el) {
    if (!document.body.classList.contains("nocode-edit-view-responsive")) return true;
    const p = el.parentElement;
    return !(p && p.classList.contains("canvas-block__nest"));
  }

  /**
   * 初回レイアウトでネスト親の幅が 0 のとき placeBlock が左に寄せた座標を、保存データの x/y で上書きする。
   */
  function reapplyLayoutPositionsFromDataset() {
    if (!canvas) return;
    canvas.querySelectorAll(".canvas-block").forEach(function (b) {
      if (b.dataset.layoutX === undefined || b.dataset.layoutY === undefined) return;
      const x = parseInt(b.dataset.layoutX, 10) || 0;
      const y = parseInt(b.dataset.layoutY, 10) || 0;
      placeBlock(b, x, y);
    });
  }

  function placeBlock(el, x, y) {
    const parent = el.parentElement;
    const inNest = parent && parent.classList.contains("canvas-block__nest");
    if (inNest) {
      let pw = parent.clientWidth || parent.offsetWidth;
      let ph = parent.clientHeight || parent.offsetHeight;
      if (!(pw > 0)) {
        const sw = parseInt(parent.style.width, 10);
        pw = !isNaN(sw) && sw > 0 ? sw : canvasWorkWidthPx > 0 ? canvasWorkWidthPx : CANVAS_WIDTH_MIN;
      }
      if (!(ph > 0)) {
        const sh = parseInt(parent.style.height, 10);
        ph = !isNaN(sh) && sh > 0 ? sh : 1000000;
      }
      void el.offsetWidth;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      el.style.left = Math.max(0, Math.min(x, Math.max(0, pw - w))) + "px";
      el.style.top = Math.max(0, Math.min(y, Math.max(0, ph - h))) + "px";
    } else {
      void el.offsetWidth;
      const bw = el.offsetWidth;
      let cw = canvas.clientWidth || canvas.offsetWidth;
      if (!(cw > 0)) {
        cw = canvasWorkWidthPx > 0 ? canvasWorkWidthPx : CANVAS_WIDTH_MIN;
      }
      el.style.left = Math.max(0, Math.min(x, Math.max(0, cw - bw))) + "px";
      el.style.top = Math.max(0, y) + "px";
    }
    setCanvasHeight();
    if (shouldSyncLayoutDataset(el)) {
      const sx = parseInt(el.style.left, 10) || 0;
      const sy = parseInt(el.style.top, 10) || 0;
      el.dataset.layoutX = String(sx);
      el.dataset.layoutY = String(sy);
    }
  }

  function clearAllSnapGuides() {
    canvas.querySelectorAll(".canvas-snap-guides").forEach(function (g) {
      g.innerHTML = "";
    });
  }

  function getOrCreateSnapGuidesLayer(parentEl) {
    let g = parentEl.querySelector(":scope > .canvas-snap-guides");
    if (!g) {
      g = document.createElement("div");
      g.className = "canvas-snap-guides";
      g.setAttribute("aria-hidden", "true");
      parentEl.insertBefore(g, parentEl.firstChild);
    }
    return g;
  }

  function renderSnapGuides(parentEl, lineV, lineH) {
    if (lineV == null && lineH == null) return;
    const g = getOrCreateSnapGuidesLayer(parentEl);
    const ph = Math.max(parentEl.clientHeight, parentEl.scrollHeight || 0);
    const pw = Math.max(parentEl.clientWidth, parentEl.scrollWidth || 0);
    if (lineV != null) {
      const div = document.createElement("div");
      div.className = "canvas-snap-guide canvas-snap-guide--v";
      div.style.left = lineV + "px";
      div.style.top = "0";
      div.style.height = ph + "px";
      g.appendChild(div);
    }
    if (lineH != null) {
      const div = document.createElement("div");
      div.className = "canvas-snap-guide canvas-snap-guide--h";
      div.style.top = lineH + "px";
      div.style.left = "0";
      div.style.width = pw + "px";
      g.appendChild(div);
    }
  }

  function collectSnapXs(parentEl, excludeSet) {
    const xs = [];
    Array.from(parentEl.querySelectorAll(":scope > .canvas-block")).forEach(function (b) {
      if (excludeSet.has(b)) return;
      const L = b.offsetLeft;
      const w = b.offsetWidth;
      xs.push(L, L + w / 2, L + w);
    });
    return xs;
  }

  function collectSnapYs(parentEl, excludeSet) {
    const ys = [];
    Array.from(parentEl.querySelectorAll(":scope > .canvas-block")).forEach(function (b) {
      if (excludeSet.has(b)) return;
      const T = b.offsetTop;
      const h = b.offsetHeight;
      ys.push(T, T + h / 2, T + h);
    });
    return ys;
  }

  function bestSnap1D(cand, size, targets, threshold) {
    let bestPos = cand;
    let bestGuide = null;
    let bestDist = threshold + 1;
    targets.forEach(function (t) {
      [0, size / 2, size].forEach(function (off) {
        const edge = cand + off;
        const dist = Math.abs(edge - t);
        if (dist < bestDist) {
          bestDist = dist;
          bestPos = t - off;
          bestGuide = t;
        }
      });
    });
    if (bestDist <= threshold) return { pos: bestPos, guide: bestGuide };
    return { pos: cand, guide: null };
  }

  function computeSnapDelta(block, candLeft, candTop, excludeSet) {
    const parent = block.offsetParent || canvas;
    if (!parent) return { dlx: 0, dly: 0, vLine: null, hLine: null };
    const w = block.offsetWidth;
    const h = block.offsetHeight;
    const xs = collectSnapXs(parent, excludeSet);
    const ys = collectSnapYs(parent, excludeSet);
    const thr = SNAP_GUIDE_THRESHOLD_PX;
    const sx = bestSnap1D(candLeft, w, xs, thr);
    const sy = bestSnap1D(candTop, h, ys, thr);
    return {
      dlx: sx.pos - candLeft,
      dly: sy.pos - candTop,
      vLine: sx.guide,
      hLine: sy.guide,
    };
  }

  function canvasContentWidthPx() {
    return canvas.clientWidth;
  }

  function canvasContentHeightPx() {
    return canvas.offsetHeight;
  }

  function syncBlockPositionInputs(block) {
    const ix = propsForm.querySelector("#prop-x");
    const iy = propsForm.querySelector("#prop-y");
    if (ix) ix.value = block.offsetLeft;
    if (iy) iy.value = block.offsetTop;
  }

  function blockAlignBounds(block) {
    const p = block.parentElement;
    if (p && p.classList.contains("canvas-block__nest")) {
      return { width: p.clientWidth, height: p.clientHeight };
    }
    return { width: canvasContentWidthPx(), height: canvasContentHeightPx() };
  }

  function alignBlockCanvasHorizontal(block, mode) {
    if (!block || !mode) return;
    const bounds = blockAlignBounds(block);
    const w = block.offsetWidth;
    let x;
    if (mode === "left") x = 0;
    else if (mode === "center") x = Math.max(0, Math.round((bounds.width - w) / 2));
    else if (mode === "right") x = Math.max(0, Math.round(bounds.width - w));
    else return;
    block.style.left = x + "px";
    setCanvasHeight();
    scheduleAutoSaveToLocalStorage();
    if (selectedBlocks.length === 1 && primarySelected() === block) syncBlockPositionInputs(block);
  }

  function centerBlockHorizontal(block) {
    alignBlockCanvasHorizontal(block, "center");
  }

  function centerBlockVertical(block) {
    const h = block.offsetHeight;
    const ch = blockAlignBounds(block).height;
    const y = Math.max(0, Math.round((ch - h) / 2));
    block.style.top = y + "px";
    setCanvasHeight();
    if (selectedBlocks.length === 1 && primarySelected() === block) syncBlockPositionInputs(block);
  }

  function nudgeSelectedBlocks(dx, dy) {
    if (!dx && !dy) return false;
    const moving = selectedBlocks.filter(function (b) {
      return canvas.contains(b);
    });
    if (moving.length === 0) return false;
    moving.forEach(function (b) {
      placeBlock(b, b.offsetLeft + dx, b.offsetTop + dy);
    });
    setCanvasHeight();
    renderLayers();
    scheduleAutoSaveToLocalStorage();
    if (moving.length === 1 && selectedBlocks.length === 1 && primarySelected() === moving[0]) {
      syncBlockPositionInputs(moving[0]);
    }
    return true;
  }

  function centerSelectedBlocksByAxis(axis) {
    const targets = selectedBlocks.filter(function (b) {
      return canvas.contains(b);
    });
    if (targets.length < 2) return false;
    pushUndoSnapshot();
    const ref = primarySelected() || targets[targets.length - 1];
    if (!ref) return false;
    const parent = ref.parentElement;
    const sameParent = targets.every(function (b) {
      return b.parentElement === parent;
    });
    if (!sameParent) return false;
    const refCx = ref.offsetLeft + ref.offsetWidth / 2;
    const refCy = ref.offsetTop + ref.offsetHeight / 2;
    targets.forEach(function (b) {
      if (b === ref) return;
      const nx = axis === "x" ? Math.round(refCx - b.offsetWidth / 2) : b.offsetLeft;
      const ny = axis === "y" ? Math.round(refCy - b.offsetHeight / 2) : b.offsetTop;
      placeBlock(b, nx, ny);
    });
    setCanvasHeight();
    renderLayers();
    scheduleAutoSaveToLocalStorage();
    if (selectedBlocks.length === 1 && primarySelected()) syncBlockPositionInputs(primarySelected());
    return true;
  }

  function cycleSelectionReferenceBlock() {
    const targets = selectedBlocks.filter(function (b) {
      return canvas.contains(b);
    });
    if (targets.length < 2) return false;
    const current = getSelectionReferenceBlock();
    const idx = current ? targets.indexOf(current) : -1;
    const next = targets[(idx + 1 + targets.length) % targets.length];
    setSelectionReferenceBlock(next);
    refreshSelectionUi();
    return true;
  }

  function alignSelectedToReference(mode) {
    const targets = selectedBlocks.filter(function (b) {
      return canvas.contains(b);
    });
    if (targets.length < 2) return false;
    const ref = getSelectionReferenceBlock();
    if (!ref) return false;
    const parent = ref.parentElement;
    const sameParent = targets.every(function (b) {
      return b.parentElement === parent;
    });
    if (!sameParent) return false;

    pushUndoSnapshot();

    const refLeft = ref.offsetLeft;
    const refTop = ref.offsetTop;
    const refRight = refLeft + ref.offsetWidth;
    const refBottom = refTop + ref.offsetHeight;
    const refCenterX = refLeft + ref.offsetWidth / 2;
    const refCenterY = refTop + ref.offsetHeight / 2;

    targets.forEach(function (b) {
      if (b === ref) return;
      let nx = b.offsetLeft;
      let ny = b.offsetTop;
      if (mode === "left") nx = refLeft;
      else if (mode === "right") nx = refRight - b.offsetWidth;
      else if (mode === "hcenter") nx = Math.round(refCenterX - b.offsetWidth / 2);
      else if (mode === "top") ny = refTop;
      else if (mode === "bottom") ny = refBottom - b.offsetHeight;
      else if (mode === "vcenter") ny = Math.round(refCenterY - b.offsetHeight / 2);
      placeBlock(b, nx, ny);
    });

    setCanvasHeight();
    renderLayers();
    scheduleAutoSaveToLocalStorage();
    refreshSelectionUi();
    return true;
  }

  function groupSelectedBlocks() {
    const targets = selectedBlocks.filter(function (b) {
      return canvas.contains(b);
    });
    if (targets.length < 2) return false;
    const parent = targets[0].parentElement;
    const sameParent = targets.every(function (b) {
      return b.parentElement === parent;
    });
    if (!sameParent || !parent) return false;

    let minL = Infinity;
    let minT = Infinity;
    let maxR = -Infinity;
    let maxB = -Infinity;
    targets.forEach(function (b) {
      minL = Math.min(minL, b.offsetLeft);
      minT = Math.min(minT, b.offsetTop);
      maxR = Math.max(maxR, b.offsetLeft + b.offsetWidth);
      maxB = Math.max(maxB, b.offsetTop + b.offsetHeight);
    });
    if (!isFinite(minL) || !isFinite(minT) || !isFinite(maxR) || !isFinite(maxB)) return false;

    pushUndoSnapshot();

    const group = createContainerBlock();
    parent.appendChild(group);
    placeBlock(group, minL, minT);
    group.style.zIndex = String(nextZIndexInParent(parent));

    const nest = group.querySelector(".canvas-block__nest");
    if (!nest) return false;
    applyContainerStyleToNest(nest, {
      minWidthPx: Math.max(CONTAINER_RESIZE_MIN_W, maxR - minL),
      minHeightPx: Math.max(CONTAINER_RESIZE_MIN_H, maxB - minT),
      widthPx: Math.max(CONTAINER_RESIZE_MIN_W, maxR - minL),
      heightPx: Math.max(CONTAINER_RESIZE_MIN_H, maxB - minT),
      paddingPx: 0,
      backgroundColor: "",
      borderRadiusPx: 0,
    });

    targets.forEach(function (b) {
      const relX = b.offsetLeft - minL;
      const relY = b.offsetTop - minT;
      nest.appendChild(b);
      placeBlock(b, relX, relY);
      b.style.zIndex = String(nextZIndexInParent(nest));
    });

    selectBlock(group);
    setCanvasHeight();
    renderLayers();
    scheduleAutoSaveToLocalStorage();
    return true;
  }

  function createTextBlock() {
    const wrap = document.createElement("div");
    wrap.className = "canvas-block";
    wrap.dataset.type = "text";
    wrap.id = nextId();
    const p = document.createElement("p");
    p.className = "canvas-block__text";
    p.textContent = "ダブルクリックでこの文字を編集できます。右パネルからも変更できます。";
    p.style.fontSize = "18px";
    p.style.color = "#3c2355";
    p.style.fontWeight = "400";
    applyTextFontFamilyToInner(p, "sans-serif");
    wrap.appendChild(p);
    attachCanvasTextPaste(p);
    bindBlock(wrap);
    return wrap;
  }

  function createImageBlock() {
    const wrap = document.createElement("div");
    wrap.className = "canvas-block";
    wrap.dataset.type = "image";
    wrap.id = nextId();
    const img = document.createElement("img");
    img.className = "canvas-block__img";
    img.alt = "";
    img.draggable = false;
    img.style.width = "240px";
    img.src = defaultImagePlaceholderSrc();
    wrap.appendChild(img);
    bindBlock(wrap);
    return wrap;
  }

  function createButtonBlock() {
    const wrap = document.createElement("div");
    wrap.className = "canvas-block";
    wrap.dataset.type = "button";
    wrap.id = nextId();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "canvas-block__btn";
    btn.textContent = "ボタン";
    btn.style.fontSize = "14px";
    btn.style.fontWeight = "600";
    btn.style.fontFamily = "sans-serif";
    btn.style.color = "#ffffff";
    btn.dataset.bgColorSolid = "#7e57a4";
    btn.dataset.bgTransparent = "";
    btn.style.backgroundColor = "#7e57a4";
    btn.style.padding = "10px 20px";
    btn.style.borderRadius = "6px";
    applyButtonBorderSides(btn, 0);
    applyButtonBackgroundImage(btn, "");
    wrap.appendChild(btn);
    attachPlainPaste(btn);
    bindBlock(wrap);
    return wrap;
  }

  var CONTACT_GAPS_DEFAULT = {
    titleBody: 2,
    fields: 2,
    mainButton: 3,
    labelField: 1,
  };

  function clampContactGapPct(n) {
    const x = parseFloat(n);
    if (isNaN(x)) return NaN;
    return Math.min(25, Math.max(0, x));
  }

  function normalizeContactGapsPct(obj) {
    const d = {
      titleBody: CONTACT_GAPS_DEFAULT.titleBody,
      fields: CONTACT_GAPS_DEFAULT.fields,
      mainButton: CONTACT_GAPS_DEFAULT.mainButton,
      labelField: CONTACT_GAPS_DEFAULT.labelField,
    };
    if (!obj || typeof obj !== "object") return d;
    const tb = clampContactGapPct(obj.titleBody);
    if (!isNaN(tb)) d.titleBody = tb;
    const fd = clampContactGapPct(obj.fields);
    if (!isNaN(fd)) d.fields = fd;
    const mb = clampContactGapPct(obj.mainButton);
    if (!isNaN(mb)) d.mainButton = mb;
    const lf = clampContactGapPct(obj.labelField);
    if (!isNaN(lf)) d.labelField = lf;
    return d;
  }

  function readContactGapsPctFromForm(form) {
    if (!form) return normalizeContactGapsPct(null);
    return normalizeContactGapsPct({
      titleBody: form.dataset.contactGapTitleBody,
      fields: form.dataset.contactGapFields,
      mainButton: form.dataset.contactGapMainButton,
      labelField: form.dataset.contactGapLabelField,
    });
  }

  function applyContactGapsToForm(form, gapsPct) {
    const g = normalizeContactGapsPct(gapsPct);
    form.dataset.contactGapTitleBody = String(g.titleBody);
    form.dataset.contactGapFields = String(g.fields);
    form.dataset.contactGapMainButton = String(g.mainButton);
    form.dataset.contactGapLabelField = String(g.labelField);
    form.style.setProperty("--contact-gap-title-body", g.titleBody + "%");
    form.style.setProperty("--contact-gap-fields", g.fields + "%");
    form.style.setProperty("--contact-gap-main-button", g.mainButton + "%");
    form.style.setProperty("--contact-gap-label-fake", g.labelField + "%");
  }

  function readContactGapsFromSerializedStyle(st) {
    if (!st || typeof st !== "object") return undefined;
    return {
      titleBody: st.contactGapTitleBodyPct,
      fields: st.contactGapFieldsPct,
      mainButton: st.contactGapMainButtonPct,
      labelField: st.contactGapLabelFieldPct,
    };
  }

  var CONTACT_HEADING_TITLE_DEFAULT = { fontSizePx: 15, color: "#1e293b", textAlign: "left" };
  var CONTACT_HEADING_LABEL_DEFAULT = { fontSizePx: 11, color: "#64748b", textAlign: "left" };

  function resolvedFontSizePxForPanel(el, defaultPx) {
    const cs = getComputedStyle(el);
    const inline = el.style.fontSize && el.style.fontSize.trim();
    if (!inline) {
      return Math.round(parseFloat(cs.fontSize)) || defaultPx;
    }
    const p = parseCssNumericUnit(inline, NaN, "px");
    if (isNaN(p.n) || p.n <= 0) {
      return Math.round(parseFloat(cs.fontSize)) || defaultPx;
    }
    if (p.unit === "px") {
      return Math.round(p.n);
    }
    return Math.round(parseFloat(cs.fontSize)) || defaultPx;
  }

  function normalizeContactHeadingAlignValue(raw) {
    if (raw === "start") return "left";
    if (raw === "end") return "right";
    return normalizeTextAlign(raw || "left");
  }

  function readContactTitleStyleForPanel(titleEl) {
    const cs = getComputedStyle(titleEl);
    const fontSize = resolvedFontSizePxForPanel(titleEl, CONTACT_HEADING_TITLE_DEFAULT.fontSizePx);
    let color;
    if (titleEl.style.color) {
      color = rgbToHex(titleEl.style.color);
    } else {
      color = rgbToHex(cs.color) || CONTACT_HEADING_TITLE_DEFAULT.color;
    }
    const taInline = titleEl.style.textAlign;
    const ta = taInline
      ? normalizeContactHeadingAlignValue(taInline)
      : normalizeContactHeadingAlignValue(cs.textAlign);
    return { fontSizePx: fontSize, color: color, textAlign: ta };
  }

  function readContactFieldLabelStyleForPanel(labelEl) {
    const cs = getComputedStyle(labelEl);
    const fontSize = resolvedFontSizePxForPanel(labelEl, CONTACT_HEADING_LABEL_DEFAULT.fontSizePx);
    let color;
    if (labelEl.style.color) {
      color = rgbToHex(labelEl.style.color);
    } else {
      color = rgbToHex(cs.color) || CONTACT_HEADING_LABEL_DEFAULT.color;
    }
    const taInline = labelEl.style.textAlign;
    const ta = taInline
      ? normalizeContactHeadingAlignValue(taInline)
      : normalizeContactHeadingAlignValue(cs.textAlign);
    return { fontSizePx: fontSize, color: color, textAlign: ta };
  }

  function normalizeContactHeadingStyleFromSt(st) {
    const out = {
      title: {
        fontSizePx: CONTACT_HEADING_TITLE_DEFAULT.fontSizePx,
        fontSizeCss: "",
        color: CONTACT_HEADING_TITLE_DEFAULT.color,
        textAlign: CONTACT_HEADING_TITLE_DEFAULT.textAlign,
      },
      labels: [
        { fontSizePx: CONTACT_HEADING_LABEL_DEFAULT.fontSizePx, fontSizeCss: "", color: CONTACT_HEADING_LABEL_DEFAULT.color, textAlign: CONTACT_HEADING_LABEL_DEFAULT.textAlign },
        { fontSizePx: CONTACT_HEADING_LABEL_DEFAULT.fontSizePx, fontSizeCss: "", color: CONTACT_HEADING_LABEL_DEFAULT.color, textAlign: CONTACT_HEADING_LABEL_DEFAULT.textAlign },
        { fontSizePx: CONTACT_HEADING_LABEL_DEFAULT.fontSizePx, fontSizeCss: "", color: CONTACT_HEADING_LABEL_DEFAULT.color, textAlign: CONTACT_HEADING_LABEL_DEFAULT.textAlign },
      ],
    };
    if (!st || typeof st !== "object") return out;
    if (typeof st.contactTitleFontSize === "string" && st.contactTitleFontSize.trim()) {
      out.title.fontSizeCss = st.contactTitleFontSize.trim();
    } else {
      const tfs = parseInt(st.contactTitleFontSizePx, 10);
      if (!isNaN(tfs) && tfs > 0) out.title.fontSizePx = tfs;
    }
    if (typeof st.contactTitleColor === "string" && st.contactTitleColor) out.title.color = st.contactTitleColor;
    if (st.contactTitleTextAlign === "left" || st.contactTitleTextAlign === "center" || st.contactTitleTextAlign === "right") {
      out.title.textAlign = st.contactTitleTextAlign;
    }
    const fsa = st.contactFieldLabelFontSizePx;
    const fsCssArr = st.contactFieldLabelFontSizes;
    const cols = st.contactFieldLabelColors;
    const tas = st.contactFieldLabelTextAligns;
    for (let i = 0; i < 3; i++) {
      if (Array.isArray(fsCssArr) && typeof fsCssArr[i] === "string" && fsCssArr[i].trim()) {
        out.labels[i].fontSizeCss = fsCssArr[i].trim();
      } else if (Array.isArray(fsa) && fsa[i] != null) {
        const n = parseInt(fsa[i], 10);
        if (!isNaN(n) && n > 0) out.labels[i].fontSizePx = n;
      }
      if (Array.isArray(cols) && typeof cols[i] === "string" && cols[i]) out.labels[i].color = cols[i];
      if (Array.isArray(tas) && (tas[i] === "left" || tas[i] === "center" || tas[i] === "right")) {
        out.labels[i].textAlign = tas[i];
      }
    }
    return out;
  }

  function applyContactHeadingStyles(titleEl, labelNodeList, st) {
    if (!titleEl) return;
    const h = normalizeContactHeadingStyleFromSt(st);
    titleEl.style.fontSize = h.title.fontSizeCss || h.title.fontSizePx + "px";
    titleEl.style.color = h.title.color;
    titleEl.style.textAlign = h.title.textAlign;
    const labs = labelNodeList && labelNodeList.length ? Array.prototype.slice.call(labelNodeList, 0) : [];
    for (let i = 0; i < 3 && i < labs.length; i++) {
      labs[i].style.fontSize = h.labels[i].fontSizeCss || h.labels[i].fontSizePx + "px";
      labs[i].style.color = h.labels[i].color;
      labs[i].style.textAlign = h.labels[i].textAlign;
    }
  }

  function readContactHeadingStyleFromDomForSerialize(el) {
    const title = el.querySelector(".canvas-block__contact-title");
    const labs = el.querySelectorAll(".canvas-block__contact-row-label");
    const t = title ? readContactTitleStyleForPanel(title) : CONTACT_HEADING_TITLE_DEFAULT;
    const fs = [];
    const fsCss = [];
    const cols = [];
    const tas = [];
    for (let i = 0; i < 3; i++) {
      const L = labs[i] ? readContactFieldLabelStyleForPanel(labs[i]) : CONTACT_HEADING_LABEL_DEFAULT;
      fs.push(L.fontSizePx);
      fsCss.push(labs[i] && labs[i].style.fontSize ? labs[i].style.fontSize : "");
      cols.push(L.color);
      tas.push(L.textAlign);
    }
    return {
      contactTitleFontSize: title && title.style.fontSize ? title.style.fontSize : "",
      contactTitleFontSizePx: t.fontSizePx,
      contactTitleColor: t.color,
      contactTitleTextAlign: t.textAlign,
      contactFieldLabelFontSizes: fsCss,
      contactFieldLabelFontSizePx: fs,
      contactFieldLabelColors: cols,
      contactFieldLabelTextAligns: tas,
    };
  }

  function readContactFormBackgroundResolved(wrapOrForm) {
    const form =
      wrapOrForm.classList && wrapOrForm.classList.contains("canvas-block__contact-form")
        ? wrapOrForm
        : wrapOrForm.querySelector
          ? wrapOrForm.querySelector(".canvas-block__contact-form")
          : null;
    if (!form) return "#ffffff";
    if (form.style.backgroundColor) return rgbToHex(form.style.backgroundColor);
    const cs = getComputedStyle(form);
    return rgbToHex(cs.backgroundColor) || "#ffffff";
  }

  function readContactFormBorderRadiusPx(form) {
    if (!form) return 8;
    const brs = form.style.borderRadius;
    if (brs) {
      const m = String(brs).match(/^([\d.]+)px$/);
      if (m) return Math.round(parseFloat(m[1]));
    }
    const n = parseFloat(getComputedStyle(form).borderTopLeftRadius);
    return !isNaN(n) && n >= 0 ? Math.round(n) : 8;
  }

  function normalizeContactFieldHeightsPx(arr) {
    const d = [56, 56, 180];
    let src = arr;
    if (!Array.isArray(arr) && arr && typeof arr === "object") {
      src = [arr.name, arr.email, arr.message];
    }
    if (!Array.isArray(src) || src.length < 3) return d;
    for (let i = 0; i < 3; i++) {
      const n = parseInt(src[i], 10);
      if (!isNaN(n) && n >= 4) d[i] = n;
    }
    return d;
  }

  function readContactFieldHeightsPx(wrap) {
    const fakes = wrap.querySelectorAll(".canvas-block__contact-fake");
    const out = [56, 56, 180];
    for (let i = 0; i < 3 && i < fakes.length; i++) {
      const el = fakes[i];
      const mh = parseInt(el.style.minHeight, 10);
      const h = parseInt(el.style.height, 10);
      const v = !isNaN(mh) && mh >= 4 ? mh : !isNaN(h) && h >= 4 ? h : NaN;
      if (!isNaN(v)) out[i] = v;
    }
    return out;
  }

  function syncContactBodyGridTemplate(body, fh) {
    const a = normalizeContactFieldHeightsPx(fh);
    body.style.gridTemplateRows =
      "minmax(" +
      a[0] +
      "px, " +
      a[0] +
      "fr) minmax(" +
      a[1] +
      "px, " +
      a[1] +
      "fr) minmax(" +
      a[2] +
      "px, " +
      a[2] +
      "fr)";
  }

  function syncContactBodyGridFromFakes(body) {
    const fakes = body.querySelectorAll(".canvas-block__contact-fake");
    const raw = [];
    for (let i = 0; i < 3; i++) {
      raw[i] = fakes[i] ? parseInt(fakes[i].style.minHeight, 10) : NaN;
    }
    syncContactBodyGridTemplate(body, raw);
    body.querySelectorAll(".canvas-block__contact-row").forEach(function (row) {
      row.style.removeProperty("flex");
    });
  }

  function applyContactFakeMinHeightPx(fake, hPx) {
    const h = Math.max(4, hPx);
    fake.style.minHeight = h + "px";
    fake.style.height = h + "px";
    const body = fake.closest(".canvas-block__contact-body");
    if (body) syncContactBodyGridFromFakes(body);
  }

  function wireContactSubmitAction(wrap, btn) {
    if (!wrap || !btn) return;
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const mode = wrap.dataset.contactMode || "none";
      const value = String(wrap.dataset.contactValue || "").trim();
      if (mode === "none" || !value) {
        window.alert("送信先が設定されていません");
        return;
      }
      if (mode === "email") {
        window.location.href = "mailto:" + value;
        return;
      }
      if (mode === "line" || mode === "url") {
        window.open(value, "_blank", "noopener");
      }
    });
  }

  function buildContactFormShell(titleText, submitText, fieldHeightsPx, gapsPct, headingSt) {
    const fh = normalizeContactFieldHeightsPx(fieldHeightsPx);
    const form = document.createElement("div");
    form.className = "canvas-block__contact-form";
    form.style.boxSizing = "border-box";
    form.style.width = "280px";
    const main = document.createElement("div");
    main.className = "canvas-block__contact-main";
    const title = document.createElement("div");
    title.className = "canvas-block__contact-title";
    title.textContent = titleText;
    const body = document.createElement("div");
    body.className = "canvas-block__contact-body";
    [
      ["お名前", 0],
      ["メールアドレス", 1],
      ["お問い合わせ内容", 2],
    ].forEach(function (rowDef) {
      const row = document.createElement("div");
      row.className = "canvas-block__contact-row";
      const lab = document.createElement("span");
      lab.className = "canvas-block__contact-row-label";
      lab.textContent = rowDef[0];
      const field = rowDef[1] === 2 ? document.createElement("textarea") : document.createElement("input");
      if (rowDef[1] !== 2) {
        field.type = rowDef[1] === 1 ? "email" : "text";
      }
      field.className = "canvas-block__contact-fake canvas-block__contact-input";
      field.placeholder = rowDef[0] + "を入力";
      field.style.minHeight = fh[rowDef[1]] + "px";
      field.style.height = fh[rowDef[1]] + "px";
      field.addEventListener("mousedown", function (ev) {
        ev.stopPropagation();
      });
      field.addEventListener("click", function (ev) {
        ev.stopPropagation();
      });
      row.appendChild(lab);
      row.appendChild(field);
      body.appendChild(row);
    });
    syncContactBodyGridTemplate(body, fh);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "canvas-block__btn canvas-block__contact-submit";
    btn.textContent = submitText;
    btn.style.width = "100%";
    btn.style.boxSizing = "border-box";
    main.appendChild(title);
    main.appendChild(body);
    form.appendChild(main);
    form.appendChild(btn);
    applyContactGapsToForm(form, gapsPct);
    applyContactHeadingStyles(title, body.querySelectorAll(".canvas-block__contact-row-label"), headingSt);
    return { form: form, title: title, btn: btn, main: main, body: body };
  }

  function createContactBlock() {
    const wrap = document.createElement("div");
    wrap.className = "canvas-block canvas-block--contact";
    wrap.dataset.type = "contact";
    wrap.dataset.contactMode = "none";
    wrap.dataset.contactValue = "";
    wrap.id = nextId();
    const chrome = buildContactFormShell("お問い合わせ", "送信", undefined, undefined, {});
    const btn = chrome.btn;
    btn.style.fontSize = "14px";
    btn.style.color = "#ffffff";
    btn.dataset.bgColorSolid = "#7e57a4";
    btn.dataset.bgTransparent = "";
    btn.style.backgroundColor = "#7e57a4";
    btn.style.padding = "10px 20px";
    btn.style.borderRadius = "6px";
    applyButtonBorderSides(btn, 0);
    applyButtonBackgroundImage(btn, "");
    chrome.form.style.borderRadius = "8px";
    chrome.form.style.minWidth = effectiveContactFormMinW() + "px";
    chrome.form.style.minHeight = CONTACT_FORM_MIN_H + "px";
    chrome.form.style.width = effectiveContactFormMinW() + "px";
    chrome.form.style.height = CONTACT_FORM_MIN_H + "px";
    wrap.appendChild(chrome.form);
    wireContactSubmitAction(wrap, btn);
    attachPlainPaste(btn);
    bindBlock(wrap);
    return wrap;
  }

  function createContainerBlock() {
    const wrap = document.createElement("div");
    wrap.className = "canvas-block canvas-block--container";
    wrap.dataset.type = "container";
    wrap.id = nextId();
    const nest = document.createElement("div");
    nest.className = "canvas-block__nest";
    applyContainerStyleToNest(nest, {
      minWidthPx: 280,
      minHeightPx: 160,
      paddingPx: 12,
      backgroundColor: "",
      borderRadiusPx: 6,
    });
    wrap.appendChild(nest);
    bindBlock(wrap);
    finalizeContainerBlock(wrap, nest);
    return wrap;
  }

  function bindBlock(el) {
    el.addEventListener("pointerdown", onBlockPointerDown);
    el.addEventListener("click", function (e) {
      e.stopPropagation();
      selectBlock(el, { additive: !!(e.ctrlKey || e.metaKey) });
    });
    setupInlineEdit(el);
    const bt = el.dataset.type;
    if (bt === "text" || bt === "image" || bt === "button" || bt === "contact") {
      attachBlockResizeHandle(el);
    }
  }

  function beginBlockDrag(el, clientX, clientY, pointerId) {
    if (document.body.classList.contains("nocode-published-mode")) return;
    pushUndoSnapshot();
    const dragPid = typeof pointerId === "number" ? pointerId : null;
    const useGroup = isBlockSelected(el) && selectedBlocks.length > 1;
    const dragBlocks = useGroup
      ? selectedBlocks.filter(function (b) {
          return canvas.contains(b);
        })
      : [el];
    const excludeSet = new Set(dragBlocks);
    const starts = dragBlocks.map(function (b) {
      return { b: b, left: b.offsetLeft, top: b.offsetTop };
    });
    const leaderPair = starts.filter(function (s) {
      return s.b === el;
    })[0];
    const startX = clientX;
    const startY = clientY;
    let moved = false;

    dragState = { el: el, moved: false };

    function onMove(ev) {
      if (dragPid !== null && ev.pointerId !== dragPid) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        moved = true;
        canvas.classList.add("is-dragging");
      }
      if (!moved) return;

      const candL = leaderPair.left + dx;
      const candT = leaderPair.top + dy;
      const snap = computeSnapDelta(el, candL, candT, excludeSet);
      const adx = dx + snap.dlx;
      const ady = dy + snap.dly;

      clearAllSnapGuides();
      if (snap.vLine != null || snap.hLine != null) {
        const parentEl = el.offsetParent || canvas;
        renderSnapGuides(parentEl, snap.vLine, snap.hLine);
      }

      starts.forEach(function (s) {
        placeBlock(s.b, s.left + adx, s.top + ady);
      });

      if (selectedBlocks.length === 1 && primarySelected() === el) {
        const ix = propsForm.querySelector("#prop-x");
        const iy = propsForm.querySelector("#prop-y");
        if (ix) ix.value = el.offsetLeft;
        if (iy) iy.value = el.offsetTop;
      }
    }

    function onUp(ev) {
      if (dragPid !== null && ev && ev.pointerId !== dragPid) return;
      clearAllSnapGuides();
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      canvas.classList.remove("is-dragging");
      dragState = null;
    }

    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }

  function onBlockPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = e.currentTarget;
    if (e.target && e.target.closest && e.target.closest(".canvas-block__resize-handle")) return;
    if (isEditingTarget(e.target)) return;
    if (el.dataset.type === "container") {
      const inner = e.target.closest(".canvas-block__nest .canvas-block");
      if (inner && inner !== el && el.contains(inner)) return;
    }
    beginBlockDrag(el, e.clientX, e.clientY, e.pointerId);
    e.preventDefault();
  }

  function clearAllMeasureLayers() {
    canvas.querySelectorAll(".canvas-measure-layer").forEach(function (layer) {
      layer.innerHTML = "";
    });
  }

  function getOrCreateMeasureLayer(parentEl) {
    let layer = parentEl.querySelector(":scope > .canvas-measure-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "canvas-measure-layer";
      layer.setAttribute("aria-hidden", "true");
      parentEl.insertBefore(layer, parentEl.firstChild);
    }
    return layer;
  }

  function measureVerticalOverlap(t1, h1, t2, h2) {
    return t1 < t2 + h2 && t2 < t1 + h1;
  }

  function measureHorizontalOverlap(l1, w1, l2, w2) {
    return l1 < l2 + w2 && l2 < l1 + w1;
  }

  function parentMeasureHeight(parentEl) {
    return Math.max(parentEl.clientHeight, parentEl.scrollHeight || 0);
  }

  function addMeasureHLine(layer, y, x0, x1, px, kind) {
    const w = x1 - x0;
    if (w < 1) return;
    const line = document.createElement("div");
    line.className =
      "canvas-measure-line canvas-measure-line--h" +
      (kind === "block" ? " is-to-block" : "");
    line.style.top = y + "px";
    line.style.left = x0 + "px";
    line.style.width = w + "px";
    layer.appendChild(line);
    const lab = document.createElement("span");
    lab.className = "canvas-measure-label" + (kind === "block" ? " is-to-block" : "");
    lab.textContent = Math.round(px) + " px";
    lab.style.left = x0 + w / 2 + "px";
    lab.style.top = y - 11 + "px";
    layer.appendChild(lab);
  }

  function addMeasureVLine(layer, x, y0, y1, px, kind) {
    const h = y1 - y0;
    if (h < 1) return;
    const line = document.createElement("div");
    line.className =
      "canvas-measure-line canvas-measure-line--v" +
      (kind === "block" ? " is-to-block" : "");
    line.style.left = x + "px";
    line.style.top = y0 + "px";
    line.style.height = h + "px";
    layer.appendChild(line);
    const lab = document.createElement("span");
    lab.className = "canvas-measure-label" + (kind === "block" ? " is-to-block" : "");
    lab.textContent = Math.round(px) + " px";
    lab.style.left = x + 13 + "px";
    lab.style.top = y0 + h / 2 + "px";
    layer.appendChild(lab);
  }

  function renderHoverMeasures(block) {
    if (!block || !canvas.contains(block)) return;
    const parent = block.offsetParent || canvas;
    if (!parent) return;

    const L = block.offsetLeft;
    const T = block.offsetTop;
    const W = block.offsetWidth;
    const Hh = block.offsetHeight;
    const R = L + W;
    const B = T + Hh;
    const midY = T + Hh / 2;
    const midX = L + W / 2;
    const pw = parent.clientWidth;
    const ph = parentMeasureHeight(parent);

    const siblings = Array.from(parent.querySelectorAll(":scope > .canvas-block")).filter(function (
      s
    ) {
      return s !== block;
    });

    let bestLeft = null;
    let bestLeftEdge = 0;
    siblings.forEach(function (S) {
      const SL = S.offsetLeft;
      const ST = S.offsetTop;
      const SR = SL + S.offsetWidth;
      const Sh = S.offsetHeight;
      if (SR <= L && measureVerticalOverlap(T, Hh, ST, Sh)) {
        if (bestLeft === null || SR > bestLeftEdge) {
          bestLeft = S;
          bestLeftEdge = SR;
        }
      }
    });

    let bestRight = null;
    let bestRightEdge = pw;
    siblings.forEach(function (S) {
      const SL = S.offsetLeft;
      const ST = S.offsetTop;
      const Sh = S.offsetHeight;
      if (SL >= R && measureVerticalOverlap(T, Hh, ST, Sh)) {
        if (bestRight === null || SL < bestRightEdge) {
          bestRight = S;
          bestRightEdge = SL;
        }
      }
    });

    let bestTop = null;
    let bestTopEdge = 0;
    siblings.forEach(function (S) {
      const SL = S.offsetLeft;
      const ST = S.offsetTop;
      const SW = S.offsetWidth;
      const SB = ST + S.offsetHeight;
      if (SB <= T && measureHorizontalOverlap(L, W, SL, SW)) {
        if (bestTop === null || SB > bestTopEdge) {
          bestTop = S;
          bestTopEdge = SB;
        }
      }
    });

    let bestBottom = null;
    let bestBottomEdge = ph;
    siblings.forEach(function (S) {
      const SL = S.offsetLeft;
      const ST = S.offsetTop;
      const SW = S.offsetWidth;
      if (ST >= B && measureHorizontalOverlap(L, W, SL, SW)) {
        if (bestBottom === null || ST < bestBottomEdge) {
          bestBottom = S;
          bestBottomEdge = ST;
        }
      }
    });

    clearAllMeasureLayers();
    const layer = getOrCreateMeasureLayer(parent);

    if (bestLeft !== null) {
      addMeasureHLine(layer, midY, bestLeftEdge, L, L - bestLeftEdge, "block");
    } else {
      addMeasureHLine(layer, midY, 0, L, L, "canvas");
    }

    if (bestRight !== null) {
      addMeasureHLine(layer, midY, R, bestRightEdge, bestRightEdge - R, "block");
    } else {
      addMeasureHLine(layer, midY, R, pw, pw - R, "canvas");
    }

    if (bestTop !== null) {
      addMeasureVLine(layer, midX, bestTopEdge, T, T - bestTopEdge, "block");
    } else {
      addMeasureVLine(layer, midX, 0, T, T, "canvas");
    }

    if (bestBottom !== null) {
      addMeasureVLine(layer, midX, B, bestBottomEdge, bestBottomEdge - B, "block");
    } else {
      addMeasureVLine(layer, midX, B, ph, ph - B, "canvas");
    }
  }

  function clearHoverMeasure() {
    pendingHoverBlock = null;
    if (hoverMeasureRaf) {
      cancelAnimationFrame(hoverMeasureRaf);
      hoverMeasureRaf = null;
    }
    clearAllMeasureLayers();
  }

  function scheduleHoverMeasure(block) {
    pendingHoverBlock = block;
    if (hoverMeasureRaf) return;
    hoverMeasureRaf = requestAnimationFrame(function () {
      hoverMeasureRaf = null;
      const b = pendingHoverBlock;
      if (b && canvas.contains(b)) renderHoverMeasures(b);
      else clearAllMeasureLayers();
    });
  }

  function onCanvasHoverPointerMove(e) {
    if (dragState || canvas.classList.contains("is-dragging")) {
      clearHoverMeasure();
      return;
    }
    const editEl = e.target && e.target.closest && e.target.closest("[contenteditable='true']");
    if (editEl && canvas.contains(editEl)) {
      clearHoverMeasure();
      return;
    }
    const handle = e.target && e.target.closest && e.target.closest(".canvas-block__resize-handle");
    if (handle && canvas.contains(handle)) {
      clearHoverMeasure();
      return;
    }
    if (e.target === canvas) {
      clearHoverMeasure();
      return;
    }
    const block = e.target.closest && e.target.closest(".canvas-block");
    if (!block || !canvas.contains(block)) {
      clearHoverMeasure();
      return;
    }
    scheduleHoverMeasure(block);
  }

  canvas.addEventListener("pointermove", onCanvasHoverPointerMove);
  canvas.addEventListener("pointerleave", clearHoverMeasure);

  canvas.addEventListener("dragover", function (e) {
    if (!e.dataTransfer || !e.dataTransfer.types) return;
    if (Array.prototype.indexOf.call(e.dataTransfer.types, "Files") < 0) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  canvas.addEventListener("drop", function (e) {
    const file = firstImageFileFromDataTransfer(e.dataTransfer);
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    const primary = primarySelected();
    if (
      primary &&
      primary.dataset.type === "image" &&
      canvas.contains(primary) &&
      selectedBlocks.indexOf(primary) !== -1
    ) {
      applyFileToImageBlock(primary, file);
      setCanvasHeight();
      renderLayers();
      return;
    }
    const node = createImageBlock();
    const target = getAppendTargetForNewBlock();
    const parentEl = target.parent;
    parentEl.appendChild(node);
    const r = parentEl.getBoundingClientRect();
    const x = Math.round(e.clientX - r.left - 50);
    const y = Math.round(e.clientY - r.top - 50);
    placeBlock(node, x, y);
    node.style.zIndex = String(nextZIndexInParent(parentEl));
    applyFileToImageBlock(node, file);
    selectBlock(node);
    setCanvasHeight();
    renderLayers();
  });

  canvas.addEventListener("click", function (e) {
    if (e.target === canvas) deselect();
  });

  document.addEventListener("keydown", function (e) {
    const t = e.target;
    const editing =
      t && t.closest && t.closest("input, textarea, select, [contenteditable='true']");

    if (!editing && document.body.classList.contains("nocode-published-mode")) return;

    if (!editing && (e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
      e.preventDefault();
      performUndo();
      return;
    }

    if (!editing && (e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) {
      const p = primarySelected();
      if (p && canvas.contains(p)) {
        e.preventDefault();
        copySelectedBlockToClipboard();
      }
      return;
    }

    if (!editing && (e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      if (selectAllBlocksByShortcut()) {
        e.preventDefault();
      }
      return;
    }

    if (!editing && (e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) {
      e.preventDefault();
      const p = pasteFromClipboard();
      if (p && typeof p.then === "function") {
        p.catch(function () {});
      }
      return;
    }

    if (!editing && (e.ctrlKey || e.metaKey) && (e.key === "g" || e.key === "G")) {
      e.preventDefault();
      groupSelectedBlocks();
      return;
    }

    if (!editing && e.altKey && e.shiftKey && (e.key === "R" || e.key === "r")) {
      e.preventDefault();
      cycleSelectionReferenceBlock();
      return;
    }

    if (!editing && e.altKey && e.shiftKey && (e.key === "L" || e.key === "l")) {
      e.preventDefault();
      alignSelectedToReference("left");
      return;
    }
    if (!editing && e.altKey && e.shiftKey && (e.key === "C" || e.key === "c")) {
      e.preventDefault();
      alignSelectedToReference("hcenter");
      return;
    }
    if (!editing && e.altKey && e.shiftKey && (e.key === "E" || e.key === "e")) {
      e.preventDefault();
      alignSelectedToReference("right");
      return;
    }
    if (!editing && e.altKey && e.shiftKey && (e.key === "T" || e.key === "t")) {
      e.preventDefault();
      alignSelectedToReference("top");
      return;
    }
    if (!editing && e.altKey && e.shiftKey && (e.key === "M" || e.key === "m")) {
      e.preventDefault();
      alignSelectedToReference("vcenter");
      return;
    }
    if (!editing && e.altKey && e.shiftKey && (e.key === "B" || e.key === "b")) {
      e.preventDefault();
      alignSelectedToReference("bottom");
      return;
    }

    if (!editing && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const step = e.shiftKey ? 10 : 1;
      let dx = 0;
      let dy = 0;
      if (e.key === "ArrowUp") dy = -step;
      else if (e.key === "ArrowDown") dy = step;
      else if (e.key === "ArrowLeft") dx = -step;
      else if (e.key === "ArrowRight") dx = step;
      if (nudgeSelectedBlocks(dx, dy)) {
        e.preventDefault();
        return;
      }
    }

    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (editing) return;
    if (selectedBlocks.length === 0) return;
    const anyOnCanvas = selectedBlocks.some(function (b) {
      return canvas.contains(b);
    });
    if (!anyOnCanvas) return;
    e.preventDefault();
    deleteSelectedBlocks();
  });

  function getAppendTargetForNewBlock() {
    const p = primarySelected();
    if (p && p.dataset.type === "container" && canvas.contains(p)) {
      const nest = p.querySelector(".canvas-block__nest");
      if (nest) return { parent: nest };
    }
    return { parent: canvas };
  }

  document.querySelectorAll("[data-add]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      pushUndoSnapshot();
      const type = btn.getAttribute("data-add");
      let node;
      if (type === "text") node = createTextBlock();
      else if (type === "image") node = createImageBlock();
      else if (type === "button") node = createButtonBlock();
      else if (type === "contact") node = createContactBlock();
      else if (type === "container") node = createContainerBlock();
      else return;
      const target = getAppendTargetForNewBlock();
      const count = target.parent.querySelectorAll(":scope > .canvas-block").length;
      target.parent.appendChild(node);
      placeBlock(node, 48 + (count % 5) * 24, 48 + (count % 3) * 32);
      node.style.zIndex = String(nextZIndexInParent(target.parent));
      selectBlock(node);
      setCanvasHeight();
      renderLayers();
    });
  });

  if (canvasWidthInput) {
    canvasWorkWidthPx = clampCanvasWidth(canvasWidthInput.value);
    canvasWidthInput.value = String(canvasWorkWidthPx);
    applyCanvasWorkWidth();
    canvasWidthInput.addEventListener("input", onCanvasWidthInput);
    canvasWidthInput.addEventListener("change", onCanvasWidthInput);
  } else {
    applyCanvasWorkWidth();
  }
  if (canvasHeightInput) {
    canvasFloorHeightPx = clampCanvasHeight(canvasHeightInput.value);
    canvasHeightInput.value = String(canvasFloorHeightPx);
    canvasHeightInput.addEventListener("input", onCanvasHeightInput);
    canvasHeightInput.addEventListener("change", onCanvasHeightInput);
  }
  if (canvasBgColorInput) {
    canvasBgColorInput.addEventListener("input", function () {
      if (canvasBgColorHexInput) canvasBgColorHexInput.value = canvasBgColorInput.value;
      onCanvasBackgroundInput();
    });
    canvasBgColorInput.addEventListener("change", onCanvasBackgroundInput);
  }
  if (canvasBgColorHexInput) {
    canvasBgColorHexInput.addEventListener("input", onCanvasBackgroundInput);
    canvasBgColorHexInput.addEventListener("change", onCanvasBackgroundInput);
    canvasBgColorHexInput.addEventListener("blur", function () {
      const n = normalizeHexColor(canvasBgColorHexInput.value);
      if (n) canvasBgColorHexInput.value = n;
    });
  }
  if (canvasBgImageUrlInput) {
    canvasBgImageUrlInput.addEventListener("input", onCanvasBackgroundInput);
    canvasBgImageUrlInput.addEventListener("change", onCanvasBackgroundInput);
  }
  if (canvasBgFitSelect) {
    canvasBgFitSelect.addEventListener("change", onCanvasBackgroundInput);
  }
  if (canvasBgImageFileInput) {
    canvasBgImageFileInput.addEventListener("change", function () {
      const file = canvasBgImageFileInput.files && canvasBgImageFileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        canvasBgImageSrc = reader.result;
        if (canvasBgImageUrlInput) canvasBgImageUrlInput.value = "";
        if (canvasBgColorInput) canvasBgColor = canvasBgColorInput.value || canvasBgColor;
        if (canvasBgFitSelect) canvasBgFit = normalizeBgFit(canvasBgFitSelect.value);
        applyCanvasBackground();
      };
      reader.readAsDataURL(file);
    });
  }
  if (canvasBgImageClearBtn) {
    canvasBgImageClearBtn.addEventListener("click", clearCanvasBackgroundImage);
  }
  readCanvasBackgroundFromInputs();

  initUnifiedLpLocalStorageOnce();

  if (window.NoCodePages && typeof window.NoCodePages.migrateLegacyIfNeeded === "function") {
    window.NoCodePages.migrateLegacyIfNeeded();
  }

  var loadedFromPageRegistry = false;
  var urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("published") === "1") {
    document.body.classList.add("nocode-published-mode");
  }

  /* 右パネル開閉状態は .canvas-scroll の justify-content（中央寄せ）に効く。初回 apply より後だと
     最初の1フレームだけ flex-start のままになりキャンバスが左に寄って見えるため、ドキュメント適用より先に復元する */
  const WORKSPACE_RAIL_STORAGE_KEY = "nocodeWorkspaceRailCollapsed";
  const workspaceEl = document.getElementById("workspace");
  const workspaceRailToggle = document.getElementById("workspace-rail-toggle");

  function applyWorkspaceRailCollapsed(collapsed) {
    if (!workspaceEl) return;
    workspaceEl.classList.toggle("workspace--rail-collapsed", collapsed);
    if (workspaceRailToggle) {
      workspaceRailToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      workspaceRailToggle.title = collapsed
        ? "右パネル（キャンバス設定・プロパティ）を表示"
        : "右パネルを隠してキャンバスを広く表示";
      workspaceRailToggle.setAttribute(
        "aria-label",
        collapsed ? "右パネル（キャンバス設定・プロパティ）を表示" : "右パネルを隠してキャンバスを広く表示"
      );
      const icon = workspaceRailToggle.querySelector(".workspace-rail-toggle__icon");
      if (icon) icon.textContent = collapsed ? "⟩" : "⟨";
    }
    try {
      localStorage.setItem(WORKSPACE_RAIL_STORAGE_KEY, collapsed ? "1" : "0");
    } catch (err) {}
    requestAnimationFrame(function () {
      centerCanvasInEditorView();
    });
  }

  function initWorkspaceRailToggle() {
    if (!workspaceEl || !workspaceRailToggle) return;
    if (document.body.classList.contains("nocode-published-mode")) {
      workspaceRailToggle.hidden = true;
      return;
    }
    let stored = null;
    try {
      stored = localStorage.getItem(WORKSPACE_RAIL_STORAGE_KEY);
    } catch (err) {}
    applyWorkspaceRailCollapsed(stored === "1");
    workspaceRailToggle.addEventListener("click", function () {
      applyWorkspaceRailCollapsed(!workspaceEl.classList.contains("workspace--rail-collapsed"));
    });
  }
  initWorkspaceRailToggle();

  const SIDEBAR_COLLAPSED_STORAGE_KEY = "nocodeEditorSidebarCollapsed";
  const appBodyEl = document.getElementById("app-body");
  const sidebarToggle = document.getElementById("sidebar-toggle");

  function applySidebarCollapsed(collapsed) {
    if (!appBodyEl) return;
    appBodyEl.classList.toggle("app-body--sidebar-collapsed", collapsed);
    if (sidebarToggle) {
      sidebarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      sidebarToggle.title = collapsed
        ? "左のツールパネル（ブロック・テンプレート等）を表示"
        : "左のツールパネルを隠してキャンバスを広く表示";
      sidebarToggle.setAttribute(
        "aria-label",
        collapsed ? "左のツールパネル（ブロック・テンプレート等）を表示" : "左のツールパネルを隠してキャンバスを広く表示"
      );
      const icon = sidebarToggle.querySelector(".sidebar-toggle__icon");
      if (icon) icon.textContent = collapsed ? "⟩" : "⟨";
    }
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
    } catch (err) {}
    requestAnimationFrame(function () {
      centerCanvasInEditorView();
    });
  }

  function initSidebarToggle() {
    if (!appBodyEl || !sidebarToggle) return;
    if (document.body.classList.contains("nocode-published-mode")) {
      sidebarToggle.hidden = true;
      return;
    }
    let stored = null;
    try {
      stored = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    } catch (err) {}
    applySidebarCollapsed(stored === "1");
    sidebarToggle.addEventListener("click", function () {
      applySidebarCollapsed(!appBodyEl.classList.contains("app-body--sidebar-collapsed"));
    });
  }
  initSidebarToggle();

  var pageIdParam = urlParams.get("page");
  if (pageIdParam && window.NoCodePages && typeof window.NoCodePages.getPage === "function") {
    if (typeof window.NoCodePages.migrateLegacyIfNeeded === "function") {
      window.NoCodePages.migrateLegacyIfNeeded();
    }
    var pageEntry = window.NoCodePages.getPage(pageIdParam);
    if (pageEntry && pageEntry.document) {
      if (applyCanvasDocument(pageEntry.document)) {
        clearUndoHistory();
        loadedFromPageRegistry = true;
        if (!document.body.classList.contains("nocode-published-mode")) {
          currentPageId = pageIdParam;
        }
        updatePersistStatus(
          document.body.classList.contains("nocode-published-mode") ? "" : "ページを読み込みました"
        );
        var tsPage = document.getElementById("templateSelect");
        if (tsPage) tsPage.value = "";
      }
    } else if (pageIdParam) {
      loadedFromPageRegistry = true;
      currentPageId = null;
      updatePersistStatus("ページが見つかりません。白紙を表示します。");
      applyCanvasDocument(createBlankCanvasDocument());
      clearUndoHistory();
      var tsMissing = document.getElementById("templateSelect");
      if (tsMissing) tsMissing.value = "";
    }
  }

  function initViewportToolbar() {
    if (document.body.classList.contains("nocode-published-mode")) return;
    const desktopBtn = document.getElementById("viewport-desktop-btn");
    const responsiveBtn = document.getElementById("viewport-responsive-btn");
    if (desktopBtn) {
      desktopBtn.addEventListener("click", function () {
        switchEditingViewport(VIEWPORT_DESKTOP);
        scheduleAutoSaveToLocalStorage();
      });
    }
    if (responsiveBtn) {
      responsiveBtn.addEventListener("click", function () {
        switchEditingViewport(VIEWPORT_RESPONSIVE);
        scheduleAutoSaveToLocalStorage();
      });
    }
    updateViewportToolbar();
  }

  function runAfterCanvasReady() {
    initTemplateUI({ preserveValue: false });
    wireTemplateSelectOnce();
    const tsInit = document.getElementById("templateSelect");
    if (tsInit) {
      tsInit.dataset.nocodeSuppressChange = "1";
      if (editorActiveTemplateKey && TEMPLATE_JSON_MAP[editorActiveTemplateKey]) {
        tsInit.value = editorActiveTemplateKey;
      } else {
        tsInit.value = "";
      }
      tsInit.dataset.nocodeSuppressChange = "";
    }

    if (persistSaveNowBtn) {
      persistSaveNowBtn.addEventListener("click", function () {
        saveDocumentToLocalStorage();
      });
    }
    if (persistNewDocumentBtn) {
      persistNewDocumentBtn.addEventListener("click", function () {
        startNewBlankDocument();
      });
    }
    if (persistLoadBtn) {
      persistLoadBtn.addEventListener("click", loadDocumentFromLocalStorageManual);
    }
    if (persistDownloadBtn) {
      persistDownloadBtn.addEventListener("click", downloadLpDocumentJsonFile);
    }
    if (persistBrowseJsonBtn && persistFileImportInput) {
      persistBrowseJsonBtn.addEventListener("click", function () {
        persistFileImportInput.click();
      });
      persistFileImportInput.addEventListener("change", function () {
        const file = persistFileImportInput.files && persistFileImportInput.files[0];
        persistFileImportInput.value = "";
        if (!file) return;
        if (canvas.querySelector(":scope > .canvas-block") && !confirmReplaceCanvas()) return;
        const reader = new FileReader();
        reader.onload = function () {
          applyDocumentFromJsonText(String(reader.result || ""));
        };
        reader.onerror = function () {
          alert("ファイルの読み込みに失敗しました。");
        };
        reader.readAsText(file, "utf-8");
      });
    }
    if (persistClearLocalBtn) {
      persistClearLocalBtn.addEventListener("click", clearPersistedLocalDocument);
    }

    if (layerDeleteSelectedBtn) {
      layerDeleteSelectedBtn.addEventListener("click", function () {
        if (selectedBlocks.length === 0) return;
        deleteSelectedBlocks();
      });
    }
    if (layerDuplicateSelectedBtn) {
      layerDuplicateSelectedBtn.addEventListener("click", function () {
        if (selectedBlocks.length === 0) return;
        duplicateSelectedBlocks();
      });
    }
    updateLayerToolbarButtons();
    initViewportToolbar();

    let mainAreaCenterOnResizeTimer = null;
    window.addEventListener(
      "resize",
      function () {
        if (document.body.classList.contains("nocode-published-mode")) return;
        clearTimeout(mainAreaCenterOnResizeTimer);
        mainAreaCenterOnResizeTimer = setTimeout(function () {
          centerCanvasInEditorView();
        }, 120);
      },
      { passive: true }
    );

    if (document.readyState === "complete") {
      if (!document.body.classList.contains("nocode-published-mode")) {
        centerCanvasInEditorView();
      }
    } else {
      window.addEventListener(
        "load",
        function () {
          if (!document.body.classList.contains("nocode-published-mode")) {
            centerCanvasInEditorView();
          }
        },
        { once: true }
      );
    }

    window.addEventListener("pageshow", function (ev) {
      if (ev.persisted && !document.body.classList.contains("nocode-published-mode")) {
        centerCanvasInEditorView();
      }
    });

    // 初回起動時にスマホ編集ビューが選択されている場合の高さ再調整
    recalcCanvasHeightForResponsiveView();

    if (document.body.classList.contains("nocode-published-mode")) {
      syncPublishedViewportLayout();
      let publishedLayoutTimer = null;
      const schedulePublishedLayout = function () {
        clearTimeout(publishedLayoutTimer);
        publishedLayoutTimer = setTimeout(function () {
          syncPublishedViewportLayout();
        }, 100);
      };
      window.addEventListener("resize", schedulePublishedLayout, { passive: true });
      window.addEventListener("orientationchange", schedulePublishedLayout, { passive: true });
      let mqPub = null;
      try {
        mqPub = window.matchMedia(PUBLISHED_VIEWPORT_MAX_WIDTH_MQ);
        if (mqPub && mqPub.addEventListener) {
          mqPub.addEventListener("change", schedulePublishedLayout);
        } else if (mqPub && mqPub.addListener) {
          mqPub.addListener(schedulePublishedLayout);
        }
      } catch (err) {}
    }
  }

  /**
   * キャンバス描画はここで一度だけ。lp_data_v1 に復元可能な JSON があるときは loadTemplate しない。
   */
  if (loadedFromPageRegistry) {
    console.log("[NoCodeStartup] canvas: page registry");
    runAfterCanvasReady();
  } else if (hasSavedDocumentInLocalStorage()) {
    var appliedOk = tryLoadPersistedDocumentOnStartup();
    if (!appliedOk) {
      console.warn("[NoCodePersist] 保存データを適用できなかったため既定テンプレートを読み込みます");
      loadTemplate(DEFAULT_TEMPLATE_KEY, { silent: true }).then(function (ok) {
        if (!ok) {
          console.warn("[NoCodeStartup] default template failed; blank");
          applyCanvasDocument(createBlankCanvasDocument());
        } else {
          console.log("[NoCodeStartup] canvas: defaultTemplate after failed persist", DEFAULT_TEMPLATE_KEY);
        }
        runAfterCanvasReady();
      });
    } else {
      console.log("[NoCodeStartup] canvas: localStorage（成功時は上記ログ）");
      runAfterCanvasReady();
    }
  } else {
    console.log("[NoCodeStartup] localStorage なし → defaultTemplate のみ:", DEFAULT_TEMPLATE_KEY);
    loadTemplate(DEFAULT_TEMPLATE_KEY, { silent: true }).then(function (ok) {
      if (!ok) {
        console.warn("[NoCodeStartup] default template failed; blank");
        applyCanvasDocument(createBlankCanvasDocument());
      } else {
        console.log("[NoCodeStartup] canvas: defaultTemplate", DEFAULT_TEMPLATE_KEY);
      }
      runAfterCanvasReady();
    });
  }

  function applyAiGeneratedTextToCanvas(text, targetValue) {
    const raw = text != null ? String(text) : "";
    const t = raw.trim();
    if (!t) {
      return { ok: false, error: "empty_text" };
    }
    const target = targetValue === "selected-text" ? "selected-text" : "new-block";
    if (target === "selected-text") {
      const b = primarySelected();
      if (!b || b.dataset.type !== "text" || !canvas.contains(b)) {
        return { ok: false, error: "no_text_block_selected" };
      }
      const p = b.querySelector(".canvas-block__text");
      if (!p) {
        return { ok: false, error: "no_text_inner" };
      }
      pushUndoSnapshot();
      p.textContent = t;
      renderProps(b);
      scheduleAutoSaveToLocalStorage();
      return { ok: true };
    }
    pushUndoSnapshot();
    const node = createTextBlock();
    const inner = node.querySelector(".canvas-block__text");
    if (inner) {
      inner.textContent = t;
    }
    const appendTarget = getAppendTargetForNewBlock();
    const parent = appendTarget.parent;
    const count = parent.querySelectorAll(":scope > .canvas-block").length;
    parent.appendChild(node);
    placeBlock(node, 48 + (count % 5) * 24, 48 + (count % 3) * 32);
    node.style.zIndex = String(nextZIndexInParent(parent));
    selectBlock(node);
    setCanvasHeight();
    renderLayers();
    scheduleAutoSaveToLocalStorage();
    return { ok: true };
  }

  window.NoCodeAIText = {
    apply: applyAiGeneratedTextToCanvas,
  };

  window.NoCodeBlockDocument = {
    SCHEMA_VERSION:
      typeof window.BLOCK_DOCUMENT_SCHEMA_VERSION === "number"
        ? window.BLOCK_DOCUMENT_SCHEMA_VERSION
        : 2,
    serialize: serializeCanvasDocument,
    apply: applyCanvasDocument,
    saveToLocalStorage: saveDocumentToLocalStorage,
    loadFromLocalStorage: loadDocumentFromLocalStorageManual,
    downloadJsonFile: downloadLpDocumentJsonFile,
    createBlankDocument: createBlankCanvasDocument,
    startNewBlank: startNewBlankDocument,
    getCurrentPageId: function () {
      return currentPageId;
    },
  };

  function invalidateTemplateCache(templateKey) {
    if (templateKey && templates[templateKey]) {
      delete templates[templateKey];
    }
  }

  window.NoCodeTemplates = {
    templates: templates,
    TEMPLATE_JSON_MAP: TEMPLATE_JSON_MAP,
    TEMPLATE_LABEL_MAP: TEMPLATE_LABEL_MAP,
    loadTemplate: loadTemplate,
    initTemplateUI: initTemplateUI,
    registerTemplate: registerTemplate,
    invalidateTemplateCache: invalidateTemplateCache,
    DEFAULT_TEMPLATE_KEY: DEFAULT_TEMPLATE_KEY,
  };
})();
