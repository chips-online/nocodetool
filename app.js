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

  const CANVAS_WIDTH_MIN = 400;
  const CANVAS_WIDTH_MAX = 3840;
  const CANVAS_HEIGHT_MIN = 200;
  const CANVAS_HEIGHT_MAX = 16000;
  /** キャンバス min-height を決めるとき、最下端ブロックの下に足す余白（px）。0 = 付けない */
  const CANVAS_PADDING_BOTTOM = 0;
  const CONTAINER_RESIZE_MIN_W = 100;
  const CONTAINER_RESIZE_MIN_H = 60;
  const BLOCK_RESIZE_MIN_TEXT_W = 48;
  const BLOCK_RESIZE_MIN_TEXT_H = 28;
  const BLOCK_RESIZE_MIN_IMG_W = 40;
  const BLOCK_RESIZE_MIN_IMG_H = 40;
  const BLOCK_RESIZE_MIN_BTN_W = 48;
  const BLOCK_RESIZE_MIN_BTN_H = 36;
  const CLIPBOARD_BLOCK_KIND = "nocodeToolBlockClip";
  const PASTE_POSITION_OFFSET = 16;
  /** localStorage に保存する LP ドキュメントのキー（schema 変更時はキーも更新推奨） */
  const LOCAL_STORAGE_DOC_KEY = "nocodeTool_lp_document_v2";
  const PERSIST_DEBOUNCE_MS = 1500;

  let idSeq = 0;
  /** 管理画面から開いたときのページ ID（保存時に NoCodePages にも書き込む） */
  let currentPageId = null;
  let persistDebounceTimer = null;
  let internalClipboard = null;
  let canvasWorkWidthPx = 1200;
  let canvasFloorHeightPx = 480;
  let canvasBgColor = "#fffbf6";
  let canvasBgImageSrc = "";
  let canvasBgFit = "cover";
  let selectedBlocks = [];
  let dragState = null;
  let hoverMeasureRaf = null;
  let pendingHoverBlock = null;
  const SNAP_GUIDE_THRESHOLD_PX = 6;
  let layerDragSourceBlock = null;

  function primarySelected() {
    return selectedBlocks.length > 0 ? selectedBlocks[selectedBlocks.length - 1] : null;
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
    renderLayers();
    scheduleAutoSaveToLocalStorage();
  }

  function isDomAncestorOf(ancestor, el) {
    if (!ancestor || !el) return false;
    let n = el.parentElement;
    while (n) {
      if (n === ancestor) return true;
      n = n.parentElement;
    }
    return false;
  }

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
      nest.appendChild(srcBlock);
      const order = siblingsStackSorted(nest);
      applyZFromBackToFront(order);
      setCanvasHeight();
      renderLayers();
      scheduleAutoSaveToLocalStorage();
      return true;
    }

    const parent = dstBlock.parentElement;
    if (!parent || (parent !== canvas && !parent.classList.contains("canvas-block__nest"))) {
      return false;
    }
    parent.insertBefore(srcBlock, dstBlock);
    if (!reorderBlockRelativeToCore(srcBlock, dstBlock)) {
      applyZFromBackToFront(siblingsStackSorted(parent));
    }
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
          }

          toggleOrSpacer.addEventListener("click", function (e) {
            e.stopPropagation();
            setBranchOpen(branchWrap.hidden);
          });
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
  }

  function clampCanvasHeight(v) {
    let n = parseInt(v, 10);
    if (isNaN(n)) return canvasFloorHeightPx;
    return Math.min(CANVAS_HEIGHT_MAX, Math.max(CANVAS_HEIGHT_MIN, n));
  }

  function clampCanvasWidth(v) {
    let n = parseInt(v, 10);
    if (isNaN(n)) return canvasWorkWidthPx;
    return Math.min(CANVAS_WIDTH_MAX, Math.max(CANVAS_WIDTH_MIN, n));
  }

  function applyCanvasWorkWidth() {
    document.documentElement.style.setProperty(
      "--canvas-width",
      canvasWorkWidthPx + "px"
    );
  }

  function reclampTopLevelBlocksToCanvas() {
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

  function setCanvasHeight() {
    let contentBottom = canvasFloorHeightPx;
    canvas.querySelectorAll(":scope > .canvas-block").forEach(function (el) {
      const bottom = el.offsetTop + el.offsetHeight;
      if (bottom + CANVAS_PADDING_BOTTOM > contentBottom) {
        contentBottom = bottom + CANVAS_PADDING_BOTTOM;
      }
    });
    canvas.style.minHeight = contentBottom + "px";
    scheduleAutoSaveToLocalStorage();
  }

  function updatePersistStatus(message) {
    if (persistStatusEl) {
      persistStatusEl.textContent = message || "";
    }
  }

  function saveDocumentToLocalStorage() {
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
    const raw = JSON.stringify(doc);
    try {
      localStorage.setItem(LOCAL_STORAGE_DOC_KEY, raw);
    } catch (err) {
      console.error(err);
      updatePersistStatus("保存に失敗しました（容量不足の可能性）。");
      return false;
    }
    if (currentPageId && window.NoCodePages && typeof window.NoCodePages.savePage === "function") {
      try {
        window.NoCodePages.savePage(currentPageId, doc, {});
      } catch (err) {
        console.error(err);
      }
    }
    const t = new Date();
    const hh = String(t.getHours()).padStart(2, "0");
    const mm = String(t.getMinutes()).padStart(2, "0");
    updatePersistStatus("ブラウザに保存済み " + hh + ":" + mm);
    return true;
  }

  function scheduleAutoSaveToLocalStorage() {
    if (persistDebounceTimer) clearTimeout(persistDebounceTimer);
    persistDebounceTimer = setTimeout(function () {
      persistDebounceTimer = null;
      saveDocumentToLocalStorage();
    }, PERSIST_DEBOUNCE_MS);
  }

  /**
   * 起動時: localStorage に有効なドキュメントがあれば適用
   * @returns {boolean} 復元したか
   */
  function tryLoadPersistedDocumentOnStartup() {
    let raw;
    try {
      raw = localStorage.getItem(LOCAL_STORAGE_DOC_KEY);
    } catch (err) {
      return false;
    }
    if (!raw || typeof raw !== "string") return false;
    let doc;
    try {
      doc = JSON.parse(raw);
    } catch (err) {
      return false;
    }
    if (!doc || typeof doc.schemaVersion !== "number") return false;
    const ok = applyCanvasDocument(doc);
    if (ok) {
      updatePersistStatus("前回の作業を復元しました");
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
    let raw;
    try {
      raw = localStorage.getItem(LOCAL_STORAGE_DOC_KEY);
    } catch (err) {
      alert("読み込みに失敗しました。");
      return;
    }
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
    if (applyCanvasDocument(doc)) {
      updatePersistStatus("ブラウザから読み込みました");
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
    if (applyCanvasDocument(doc)) {
      updatePersistStatus("JSONファイルから読み込みました");
      saveDocumentToLocalStorage();
      return true;
    }
    alert("ドキュメントを適用できませんでした。");
    return false;
  }

  function clearPersistedLocalDocument() {
    if (!window.confirm("このブラウザに保存したLPデータを削除します。よろしいですか？")) return;
    try {
      localStorage.removeItem(LOCAL_STORAGE_DOC_KEY);
    } catch (err) {
      alert("削除に失敗しました。");
      return;
    }
    updatePersistStatus("ブラウザの保存を削除しました");
  }

  function onCanvasHeightInput() {
    if (!canvasHeightInput) return;
    canvasFloorHeightPx = clampCanvasHeight(canvasHeightInput.value);
    canvasHeightInput.value = String(canvasFloorHeightPx);
    setCanvasHeight();
  }

  function isEditingTarget(target) {
    const n = target && target.closest && target.closest("[contenteditable='true']");
    return !!(n && canvas.contains(n));
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
        const fbr = propsForm.querySelector("#prop-contact-form-br");
        if (fbr && form) fbr.value = String(readContactFormBorderRadiusPx(form));
      }
      syncContactHeadingPropsInputs(block);
    } else if (type === "container") {
      const nest = block.querySelector(".canvas-block__nest");
      const brInp = propsForm.querySelector("#prop-container-br");
      if (nest && brInp) {
        const stNest = readContainerStyleFromNest(nest);
        brInp.value = String(stNest.borderRadiusPx);
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
    const fs = propsForm.querySelector("#prop-contact-h-title-fs");
    const fc = propsForm.querySelector("#prop-contact-h-title-color");
    const fa = propsForm.querySelector("#prop-contact-h-title-align");
    if (fs) fs.value = String(t.fontSizePx);
    if (fc) syncFieldColorPair(fc, t.color);
    if (fa) fa.value = normalizeTextAlign(t.textAlign);
    for (let i = 0; i < 3; i++) {
      const c = labs[i] ? readContactFieldLabelStyleForPanel(labs[i]) : CONTACT_HEADING_LABEL_DEFAULT;
      const fs2 = propsForm.querySelector("#prop-contact-h-row-" + i + "-fs");
      const fc2 = propsForm.querySelector("#prop-contact-h-row-" + i + "-color");
      const fa2 = propsForm.querySelector("#prop-contact-h-row-" + i + "-align");
      if (fs2) fs2.value = String(c.fontSizePx);
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
    intro.textContent =
      selectedBlocks.length + " 個を選択中（Ctrl / ⌘ + クリックで追加・解除）";
    propsForm.appendChild(intro);
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
    selectedBlocks = [];
    copy.forEach(function (b) {
      b.classList.remove("is-selected");
      if (canvas.contains(b)) b.remove();
    });
    setCanvasHeight();
    refreshSelectionUi();
  }

  function deleteBlock(block) {
    if (!block || !canvas.contains(block)) return;
    const i = selectedBlocks.indexOf(block);
    if (i >= 0) selectedBlocks.splice(i, 1);
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

    if (opts.additive) {
      const j = selectedBlocks.indexOf(el);
      if (j >= 0) {
        selectedBlocks.splice(j, 1);
        el.classList.remove("is-selected");
      } else {
        selectedBlocks.push(el);
        el.classList.add("is-selected");
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
    }

    refreshSelectionUi();
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
    if (Object.keys(map).length === 0) return;
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
      centerBlockHorizontal(el);
    });
    const btnAlignV = document.createElement("button");
    btnAlignV.type = "button";
    btnAlignV.className = "btn";
    btnAlignV.textContent = "垂直";
    btnAlignV.title = inNest ? "コンテナ高さの中央（上下）" : "キャンバス高さの中央（上下）";
    btnAlignV.addEventListener("click", function () {
      centerBlockVertical(el);
    });
    const btnAlignHV = document.createElement("button");
    btnAlignHV.type = "button";
    btnAlignHV.className = "btn btn-primary";
    btnAlignHV.textContent = "縦横";
    btnAlignHV.title = inNest ? "コンテナ内で水平・垂直ともに中央" : "水平・垂直ともに中央";
    btnAlignHV.addEventListener("click", function () {
      centerBlockHorizontal(el);
      centerBlockVertical(el);
    });
    alignBtns.appendChild(btnAlignH);
    alignBtns.appendChild(btnAlignV);
    alignBtns.appendChild(btnAlignHV);
    alignWrap.appendChild(alignLab);
    alignWrap.appendChild(alignBtns);
    propsForm.appendChild(alignWrap);

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
        addField(body, "枠の幅 (px)", "number", !isNaN(tw) && tw > 0 ? tw : Math.round(el.offsetWidth), function (v) {
          if (v > 0) {
            inner.style.width = v + "px";
            inner.style.boxSizing = "border-box";
          } else {
            inner.style.width = "";
          }
          setCanvasHeight();
        }, undefined, { min: 0, max: 2000, id: "prop-text-w" });
        addField(body, "枠の高さ (px)", "number", !isNaN(th) && th > 0 ? th : Math.round(el.offsetHeight), function (v) {
          if (v > 0) {
            inner.style.height = v + "px";
            inner.style.boxSizing = "border-box";
          } else {
            inner.style.height = "";
          }
          setCanvasHeight();
        }, undefined, { min: 0, max: 4000, id: "prop-text-h" });
        addField(body, "文字サイズ (px)", "number", parseInt(inner.style.fontSize, 10) || 16, function (v) {
          inner.style.fontSize = v + "px";
          setCanvasHeight();
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
        addField(body, "幅 (px)", "number", img.width || parseInt(img.style.width, 10) || 240, function (v) {
          img.style.width = v ? v + "px" : "auto";
          syncImageObjectFit(img);
          setCanvasHeight();
        }, undefined, { min: 1, max: 2000, id: "prop-img-w" });
        addField(body, "高さ (px)", "number", !isNaN(hp) && hp > 0 ? hp : Math.round(img.offsetHeight), function (v) {
          if (v > 0) img.style.height = v + "px";
          else img.style.height = "";
          syncImageObjectFit(img);
          setCanvasHeight();
        }, undefined, { min: 0, max: 4000, id: "prop-img-h" });
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
          addField(
            body,
            "【フォーム見出し】文字サイズ (px)",
            "number",
            tCur.fontSizePx,
            function (v) {
              if (titleEl) titleEl.style.fontSize = Math.max(8, v) + "px";
              setCanvasHeight();
            },
            undefined,
            { min: 8, max: 72, id: "prop-contact-h-title-fs" }
          );
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
              addField(
                body,
                "【" + rowNames[idx] + "】文字サイズ (px)",
                "number",
                c.fontSizePx,
                function (v) {
                  if (rowLabs[idx]) rowLabs[idx].style.fontSize = Math.max(6, v) + "px";
                  setCanvasHeight();
                },
                undefined,
                { min: 6, max: 48, id: "prop-contact-h-row-" + idx + "-fs" }
              );
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
          addField(
            body,
            "フォーム枠の角丸 (px)",
            "number",
            formEl ? readContactFormBorderRadiusPx(formEl) : 8,
            function (v) {
              if (formEl) formEl.style.borderRadius = Math.max(0, v) + "px";
              setCanvasHeight();
            },
            undefined,
            { min: 0, max: 64, id: "prop-contact-form-br" }
          );
        }
        addField(
          body,
          type === "contact" ? "送信ボタン 横幅 (px)" : "横幅 (px)",
          "number",
          type === "contact" ? readButtonWidthPx(btn) || 0 : wPxBtn,
          function (v) {
            if (type === "contact") {
              if (v > 0) {
                btn.style.width = v + "px";
                btn.style.boxSizing = "border-box";
                btn.style.maxWidth = "100%";
              } else {
                btn.style.width = "100%";
                btn.style.maxWidth = "";
              }
            } else {
              if (v > 0) btn.style.width = v + "px";
              else btn.style.width = "";
            }
            setCanvasHeight();
          },
          undefined,
          { min: 0, max: 1200, id: "prop-btn-w" }
        );
        addField(
          body,
          type === "contact" ? "送信ボタン 高さ (px)" : "高さ (px)",
          "number",
          type === "contact" ? readButtonHeightPx(btn) || Math.round(btn.offsetHeight) : hPxBtn,
          function (v) {
            if (v > 0) btn.style.height = v + "px";
            else btn.style.height = "";
            setCanvasHeight();
          },
          undefined,
          { min: 0, max: 800, id: "prop-btn-h" }
        );
        addField(body, "文字サイズ (px)", "number", parseInt(btn.style.fontSize, 10) || 14, function (v) {
          const n = Math.max(1, v);
          btn.style.fontSize = n + "px";
          setCanvasHeight();
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
        addField(
          body,
          "角丸 (px)",
          "number",
          br,
          function (v) {
            btn.style.borderRadius = Math.max(0, v) + "px";
            setCanvasHeight();
          },
          undefined,
          { min: 0, max: 48 }
        );
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
          addField(
            body,
            "最小幅 (px)",
            "number",
            st.minWidthPx || 0,
            function (v) {
              nest.style.minWidth = v > 0 ? v + "px" : "";
              setCanvasHeight();
            },
            undefined,
            { min: 0, max: 1200 }
          );
          addField(
            body,
            "最小高さ (px)",
            "number",
            st.minHeightPx || 0,
            function (v) {
              nest.style.minHeight = v > 0 ? v + "px" : "";
              setCanvasHeight();
            },
            undefined,
            { min: 0, max: 4000 }
          );
          addField(
            body,
            "幅 (px)",
            "number",
            st.widthPx > 0 ? st.widthPx : Math.round(nest.offsetWidth),
            function (v) {
              nest.style.width = v > 0 ? v + "px" : "";
              setCanvasHeight();
            },
            undefined,
            { min: 0, max: 2000, id: "prop-container-nest-w" }
          );
          addField(
            body,
            "高さ (px)",
            "number",
            st.heightPx > 0 ? st.heightPx : Math.round(nest.offsetHeight),
            function (v) {
              nest.style.height = v > 0 ? v + "px" : "";
              setCanvasHeight();
            },
            undefined,
            { min: 0, max: 4000, id: "prop-container-nest-h" }
          );
          addField(
            body,
            "内側の余白 (px)",
            "number",
            st.paddingPx,
            function (v) {
              nest.style.padding = v >= 0 ? v + "px" : "";
              setCanvasHeight();
            },
            undefined,
            { min: 0, max: 80 }
          );
          addField(body, "背景色", "color", st.backgroundColor || "#ffffff", function (v) {
            nest.style.backgroundColor = v;
            setCanvasHeight();
          });
          addField(
            body,
            "角丸 (px)",
            "number",
            st.borderRadiusPx,
            function (v) {
              nest.style.borderRadius = Math.max(0, v) + "px";
              setCanvasHeight();
            },
            undefined,
            { min: 0, max: 64, id: "prop-container-br" }
          );
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
    let borderRadiusPx = 0;
    const brs = nest.style.borderRadius;
    if (brs) {
      const m = String(brs).match(/^([\d.]+)px$/);
      if (m) borderRadiusPx = Math.round(parseFloat(m[1]));
    } else {
      borderRadiusPx = Math.round(parseFloat(getComputedStyle(nest).borderTopLeftRadius)) || 0;
    }
    return {
      minWidthPx: !isNaN(mw) && mw > 0 ? mw : 0,
      minHeightPx: !isNaN(mh) && mh > 0 ? mh : 0,
      widthPx: !isNaN(ww) && ww > 0 ? ww : 0,
      heightPx: !isNaN(hh) && hh > 0 ? hh : 0,
      paddingPx: paddingPx,
      backgroundColor: bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)" ? rgbToHex(bg) : "",
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
    nest.style.minWidth = !isNaN(mw) && mw > 0 ? mw + "px" : "";
    nest.style.minHeight = !isNaN(mh) && mh > 0 ? mh + "px" : "";
    nest.style.padding = !isNaN(pad) && pad >= 0 ? pad + "px" : "";
    nest.style.width = !isNaN(ww) && ww > 0 ? ww + "px" : "";
    nest.style.height = !isNaN(hh) && hh > 0 ? hh + "px" : "";
    if (st.backgroundColor && String(st.backgroundColor).trim()) {
      nest.style.backgroundColor = st.backgroundColor;
    } else {
      nest.style.backgroundColor = "";
    }
    let borderR = 6;
    if (Object.prototype.hasOwnProperty.call(st, "borderRadiusPx")) {
      const br = parseInt(st.borderRadiusPx, 10);
      borderR = !isNaN(br) && br >= 0 ? br : 0;
    }
    nest.style.borderRadius = borderR + "px";
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
        fontSizePx: parseInt(inner && inner.style.fontSize, 10) || 16,
        color: rgbToHex(inner && inner.style.color) || "#3c2355",
        fontWeight: (inner && inner.style.fontWeight) || "400",
        fontFamily: normalizeFontFamily(
          (inner && inner.dataset && inner.dataset.fontFamily) || (inner && inner.style.fontFamily)
        ),
        widthPx: !isNaN(boxW) && boxW > 0 ? boxW : 0,
        heightPx: !isNaN(boxH) && boxH > 0 ? boxH : 0,
        textAlign: normalizeTextAlign(inner && inner.style.textAlign),
      };
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
      return attachLayerMetaToSerialized(el, {
        id: id,
        type: "image",
        x: x,
        y: y,
        zIndex: z,
        src: img ? img.getAttribute("src") || "" : "",
        widthPx: !isNaN(w) && w > 0 ? w : 240,
        heightPx: !isNaN(h) && h > 0 ? h : 0,
      });
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
            fontSizePx: parseInt(btn && btn.style.fontSize, 10) || 14,
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
            widthPx: wPx,
            heightPx: hPx,
            paddingVerticalPx: pad.y,
            paddingHorizontalPx: pad.x,
            borderRadiusPx: btn ? readButtonBorderRadius(btn) : 6,
            borderWidthPx: bw,
            borderColor: btn ? readButtonBorderColorHex(btn) : "#1e293b",
            backgroundImageSrc: btn ? readButtonBgImageSrc(btn) : "",
            backgroundImageFit: btn ? readButtonBgImageFit(btn) : "cover",
            fontWeight: (btn && btn.style.fontWeight) || "600",
            fontFamily: normalizeFontFamily(btn && btn.style.fontFamily),
          };
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
        style: {
          fontSizePx: parseInt(btn && btn.style.fontSize, 10) || 14,
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
          widthPx: formW,
          heightPx: formH,
          fieldHeightsPx: readContactFieldHeightsPx(el),
          contactGapTitleBodyPct: cgap.titleBody,
          contactGapFieldsPct: cgap.fields,
          contactGapMainButtonPct: cgap.mainButton,
          contactGapLabelFieldPct: cgap.labelField,
          contactTitleFontSizePx: headStyle.contactTitleFontSizePx,
          contactTitleColor: headStyle.contactTitleColor,
          contactTitleTextAlign: headStyle.contactTitleTextAlign,
          contactFieldLabelFontSizePx: headStyle.contactFieldLabelFontSizePx,
          contactFieldLabelColors: headStyle.contactFieldLabelColors,
          contactFieldLabelTextAligns: headStyle.contactFieldLabelTextAligns,
          contactFormBackgroundColor: form ? readContactFormBackgroundResolved(form) : "#ffffff",
          contactFormBorderRadiusPx: form ? readContactFormBorderRadiusPx(form) : 8,
          submitWidthPx: readButtonWidthPx(btn),
          submitHeightPx: readButtonHeightPx(btn),
          paddingVerticalPx: pad.y,
          paddingHorizontalPx: pad.x,
          borderRadiusPx: btn ? readButtonBorderRadius(btn) : 6,
          borderWidthPx: bw,
          borderColor: btn ? readButtonBorderColorHex(btn) : "#1e293b",
          backgroundImageSrc: btn ? readButtonBgImageSrc(btn) : "",
          backgroundImageFit: btn ? readButtonBgImageFit(btn) : "cover",
        },
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

  function serializeCanvasDocument() {
    const ver =
      typeof window.BLOCK_DOCUMENT_SCHEMA_VERSION === "number"
        ? window.BLOCK_DOCUMENT_SCHEMA_VERSION
        : 2;
    const blocks = blocksStackSorted()
      .map(serializeBlockElement)
      .filter(Boolean);
    return {
      schemaVersion: ver,
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

  function syncBlockResizePropInputs(wrap) {
    if (selectedBlocks.length !== 1 || primarySelected() !== wrap) return;
    const t = wrap.dataset.type;
    if (t === "text") {
      const wi = propsForm.querySelector("#prop-text-w");
      const hi = propsForm.querySelector("#prop-text-h");
      if (wi) wi.value = Math.round(wrap.offsetWidth);
      if (hi) hi.value = Math.round(wrap.offsetHeight);
    } else if (t === "image") {
      const img = wrap.querySelector(".canvas-block__img");
      const wi = propsForm.querySelector("#prop-img-w");
      const hi = propsForm.querySelector("#prop-img-h");
      if (img && wi) wi.value = Math.round(img.offsetWidth);
      if (img && hi) hi.value = Math.round(img.offsetHeight);
    } else if (t === "contact") {
      const btn = wrap.querySelector(".canvas-block__btn");
      const wi = propsForm.querySelector("#prop-btn-w");
      const hi = propsForm.querySelector("#prop-btn-h");
      if (btn && wi) wi.value = readButtonWidthPx(btn) || 0;
      if (btn && hi) hi.value = readButtonHeightPx(btn) || Math.round(btn.offsetHeight);
    } else if (t === "button") {
      const btn = wrap.querySelector(".canvas-block__btn");
      const wi = propsForm.querySelector("#prop-btn-w");
      const hi = propsForm.querySelector("#prop-btn-h");
      if (btn && wi) wi.value = readButtonWidthPx(btn) || Math.round(btn.offsetWidth);
      if (btn && hi) hi.value = readButtonHeightPx(btn) || Math.round(btn.offsetHeight);
    }
  }

  function attachBlockResizeHandle(wrap) {
    if (wrap.querySelector(":scope > .canvas-block__resize-handle")) return;
    const handle = document.createElement("span");
    handle.className = "canvas-block__resize-handle";
    handle.title = "ドラッグしてサイズ変更";
    handle.setAttribute("aria-hidden", "true");
    wrap.appendChild(handle);

    handle.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const type = wrap.dataset.type;
      const startX = e.clientX;
      const startY = e.clientY;
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
        applySize = function (w, h) {
          form.style.width = w + "px";
          form.style.height = h + "px";
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
        } else {
          mw = BLOCK_RESIZE_MIN_BTN_W;
          mh = BLOCK_RESIZE_MIN_BTN_H;
        }
        const w = Math.max(mw, Math.round(startW + dw));
        const h = Math.max(mh, Math.round(startH + dh));
        applySize(w, h);
      }

      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        canvas.classList.remove("is-dragging");
        setCanvasHeight();
        syncBlockResizePropInputs(wrap);
        renderLayers();
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  function syncContainerNestDimensionInputs(wrap) {
    if (selectedBlocks.length !== 1 || primarySelected() !== wrap || wrap.dataset.type !== "container") {
      return;
    }
    const nest = wrap.querySelector(".canvas-block__nest");
    if (!nest) return;
    const wi = propsForm.querySelector("#prop-container-nest-w");
    const hi = propsForm.querySelector("#prop-container-nest-h");
    if (wi) wi.value = Math.round(nest.offsetWidth);
    if (hi) hi.value = Math.round(nest.offsetHeight);
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
    nest.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      if (e.target.closest(".canvas-block__resize-handle")) return;
      if (e.target !== nest) return;
      e.stopPropagation();
      beginBlockDrag(wrap, e.clientX, e.clientY);
      e.preventDefault();
    });
  }

  function attachContainerNestResize(wrap, nest) {
    const handle = document.createElement("span");
    handle.className = "canvas-block__resize-handle";
    handle.title = "ドラッグしてサイズ変更";
    handle.setAttribute("aria-hidden", "true");
    nest.appendChild(handle);

    handle.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = nest.offsetWidth;
      const startH = nest.offsetHeight;
      canvas.classList.add("is-dragging");

      function onMove(ev) {
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

      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        canvas.classList.remove("is-dragging");
        setCanvasHeight();
        syncContainerNestDimensionInputs(wrap);
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
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
      p.style.fontSize = (parseInt(st.fontSizePx, 10) || 16) + "px";
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
      const tw = parseInt(st.widthPx, 10);
      const th = parseInt(st.heightPx, 10);
      if (!isNaN(tw) && tw > 0) {
        p.style.width = tw + "px";
        p.style.boxSizing = "border-box";
      }
      if (!isNaN(th) && th > 0) {
        p.style.height = th + "px";
        p.style.boxSizing = "border-box";
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
      const img = document.createElement("img");
      img.className = "canvas-block__img";
      img.alt = "";
      img.draggable = false;
      const w = parseInt(entry.widthPx, 10);
      const ih = parseInt(entry.heightPx, 10);
      const effW = !isNaN(w) && w > 0 ? w : 240;
      img.style.width = effW + "px";
      if (!isNaN(ih) && ih > 0) {
        img.style.height = ih + "px";
        syncImageObjectFit(img);
      }
      wrap.style.boxSizing = "border-box";
      wrap.style.width = effW + "px";
      if (!isNaN(ih) && ih > 0) {
        wrap.style.height = ih + "px";
      }
      img.src = entry.src || defaultImagePlaceholderSrc();
      wrap.appendChild(img);
      bindBlock(wrap);
      return wrap;
    }

    if (entry.type === "button") {
      const wrap = document.createElement("div");
      wrap.className = "canvas-block";
      wrap.dataset.type = "button";
      wrap.id = id;
      const st = entry.style || {};
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "canvas-block__btn";
      btn.textContent = entry.label != null ? String(entry.label) : "ボタン";
      btn.style.fontSize = (parseInt(st.fontSizePx, 10) || 14) + "px";
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
      const br = parseInt(st.borderRadiusPx, 10);
      btn.style.borderRadius = (!isNaN(br) ? br : 6) + "px";
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
      if (!isNaN(wp) && wp > 0) btn.style.width = wp + "px";
      if (!isNaN(hp) && hp > 0) btn.style.height = hp + "px";
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
      btn.style.fontSize = (parseInt(st.fontSizePx, 10) || 14) + "px";
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
      const br = parseInt(st.borderRadiusPx, 10);
      btn.style.borderRadius = (!isNaN(br) ? br : 6) + "px";
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
      if (!isNaN(wp) && wp > 0) {
        form.style.width = wp + "px";
      } else {
        form.style.width = "280px";
      }
      if (!isNaN(hp) && hp > 0) {
        form.style.height = hp + "px";
      }
      if (
        typeof st.contactFormBackgroundColor === "string" &&
        st.contactFormBackgroundColor.indexOf("#") === 0
      ) {
        form.style.backgroundColor = st.contactFormBackgroundColor;
      }
      var cfr = parseInt(st.contactFormBorderRadiusPx, 10);
      if (!isNaN(cfr) && cfr >= 0) {
        form.style.borderRadius = cfr + "px";
      } else {
        form.style.borderRadius = "8px";
      }
      const sws = parseInt(st.submitWidthPx, 10);
      const shs = parseInt(st.submitHeightPx, 10);
      if (Object.prototype.hasOwnProperty.call(st, "submitWidthPx") || Object.prototype.hasOwnProperty.call(st, "submitHeightPx")) {
        if (!isNaN(sws) && sws > 0) {
          btn.style.width = sws + "px";
          btn.style.boxSizing = "border-box";
          btn.style.maxWidth = "100%";
        } else {
          btn.style.width = "100%";
          btn.style.maxWidth = "";
        }
        if (!isNaN(shs) && shs > 0) {
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

  function applyCanvasDocument(doc) {
    const ver =
      typeof window.BLOCK_DOCUMENT_SCHEMA_VERSION === "number"
        ? window.BLOCK_DOCUMENT_SCHEMA_VERSION
        : 2;
    if (!doc || typeof doc.schemaVersion !== "number") return false;
    if (doc.schemaVersion < 1 || doc.schemaVersion > ver) return false;
    deselect();
    canvas.querySelectorAll(".canvas-block").forEach(function (b) {
      b.remove();
    });
    const fh = doc.canvas && doc.canvas.floorHeightPx;
    if (typeof fh === "number" && !isNaN(fh)) {
      canvasFloorHeightPx = clampCanvasHeight(fh);
      if (canvasHeightInput) canvasHeightInput.value = String(canvasFloorHeightPx);
    }
    const cvis = doc.canvas || {};
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
    const entries = Array.isArray(doc.blocks) ? doc.blocks.slice() : [];
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
    });
    setCanvasHeight();
    renderLayers();
    return true;
  }

  /* ---------- 複数テンプレート（data は serialize 互換のブロック配列 → mountBlockTree → buildBlockFromEntry） ---------- */
  const DEFAULT_TEMPLATE_KEY = "cafe";

  const templates = {};
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

  async function ensureTemplateLoaded(templateName) {
    if (templates[templateName]) return templates[templateName];
    const paths = TEMPLATE_JSON_MAP[templateName];
    if (!paths || !paths.desktop || !paths.mobile) return null;
    const bust =
      "nocode_bust=" + String(Date.now()) + "_" + String(Math.random()).slice(2, 8);
    try {
      const urlD = paths.desktop + (paths.desktop.indexOf("?") >= 0 ? "&" : "?") + bust;
      const [desk, mob] = await Promise.all([
        fetch(urlD, { cache: "no-store" }).then(function (r) {
          if (!r.ok) throw new Error(paths.desktop);
          return r.json();
        }),
        fetch(paths.mobile + (paths.mobile.indexOf("?") >= 0 ? "&" : "?") + bust, { cache: "no-store" }).then(
          function (r) {
            if (!r.ok) throw new Error(paths.mobile);
            return r.json();
          }
        ),
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
    return {
      schemaVersion: getTemplateDocSchemaVersion(),
      canvas: Object.assign({}, defaultTemplateCanvas()),
      blocks: [],
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
    currentPageId = null;
    const sel = document.getElementById("templateSelect");
    if (sel) sel.value = "";
    updatePersistStatus("白紙のキャンバスを作成しました");
    saveDocumentToLocalStorage();
  }

  /**
   * テンプレートをキャンバスに適用（内部は applyCanvasDocument → mountBlockTree → buildBlockFromEntry）
   * @param {string} templateName - templates のキー
   * @param {{ silent?: boolean }} [options] - silent: true のとき確認ダイアログを出さない（初期ロード用）
   * @returns {boolean}
   */
  async function loadTemplate(templateName, options) {
    options = options || {};
    const silent = !!options.silent;
    try {
      const pair = await ensureTemplateLoaded(templateName);
      if (!pair || !pair.desktop || !Array.isArray(pair.desktop.data)) {
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
      let canvas = Object.assign(defaultTemplateCanvas(), pair.desktop.canvas || {});
      let blocks = pair.desktop.data.map(function (entry) {
        return JSON.parse(JSON.stringify(entry));
      });
      if (templateName === "productSalesStory") {
        canvas.widthPx = 1200;
        canvas.floorHeightPx = 5340;
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
      }
      const doc = {
        schemaVersion: getTemplateDocSchemaVersion(),
        canvas: canvas,
        blocks: blocks,
      };
      const ok = applyCanvasDocument(doc);
      if (ok) currentPageId = null;
      return ok;
    } catch (err) {
      console.error("[NoCodeTemplates] loadTemplate:", err);
      return false;
    }
  }

  function initTemplateUI() {
    const sel = document.getElementById("templateSelect");
    if (!sel) return;
    const prev = sel.value;
    sel.textContent = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "テンプレートを選択…";
    sel.appendChild(placeholder);
    Object.keys(TEMPLATE_JSON_MAP).forEach(function (key) {
      const t = templates[key];
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = t && t.name ? String(t.name) : TEMPLATE_LABEL_MAP[key] || key;
      sel.appendChild(opt);
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
      initTemplateUI();
      return true;
    }
    if (!Array.isArray(def.data)) {
      return false;
    }
    templates[key] = def;
    initTemplateUI();
    return true;
  }

  function wireTemplateSelectOnce() {
    const sel = document.getElementById("templateSelect");
    if (!sel || sel.dataset.nocodeWired === "1") return;
    sel.dataset.nocodeWired = "1";
    sel.addEventListener("change", async function () {
      const v = sel.value;
      if (!v) return;
      if (!(await loadTemplate(v))) {
        sel.value = "";
      }
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

  function centerBlockHorizontal(block) {
    const w = block.offsetWidth;
    const cw = blockAlignBounds(block).width;
    const x = Math.max(0, Math.round((cw - w) / 2));
    block.style.left = x + "px";
    setCanvasHeight();
    if (selectedBlocks.length === 1 && primarySelected() === block) syncBlockPositionInputs(block);
  }

  function centerBlockVertical(block) {
    const h = block.offsetHeight;
    const ch = blockAlignBounds(block).height;
    const y = Math.max(0, Math.round((ch - h) / 2));
    block.style.top = y + "px";
    setCanvasHeight();
    if (selectedBlocks.length === 1 && primarySelected() === block) syncBlockPositionInputs(block);
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

  function normalizeContactHeadingAlignValue(raw) {
    if (raw === "start") return "left";
    if (raw === "end") return "right";
    return normalizeTextAlign(raw || "left");
  }

  function readContactTitleStyleForPanel(titleEl) {
    const cs = getComputedStyle(titleEl);
    const fsInline = parseInt(titleEl.style.fontSize, 10);
    const fontSize =
      !isNaN(fsInline) && fsInline > 0
        ? fsInline
        : Math.round(parseFloat(cs.fontSize)) || CONTACT_HEADING_TITLE_DEFAULT.fontSizePx;
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
    const fsInline = parseInt(labelEl.style.fontSize, 10);
    const fontSize =
      !isNaN(fsInline) && fsInline > 0
        ? fsInline
        : Math.round(parseFloat(cs.fontSize)) || CONTACT_HEADING_LABEL_DEFAULT.fontSizePx;
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
        color: CONTACT_HEADING_TITLE_DEFAULT.color,
        textAlign: CONTACT_HEADING_TITLE_DEFAULT.textAlign,
      },
      labels: [
        { fontSizePx: CONTACT_HEADING_LABEL_DEFAULT.fontSizePx, color: CONTACT_HEADING_LABEL_DEFAULT.color, textAlign: CONTACT_HEADING_LABEL_DEFAULT.textAlign },
        { fontSizePx: CONTACT_HEADING_LABEL_DEFAULT.fontSizePx, color: CONTACT_HEADING_LABEL_DEFAULT.color, textAlign: CONTACT_HEADING_LABEL_DEFAULT.textAlign },
        { fontSizePx: CONTACT_HEADING_LABEL_DEFAULT.fontSizePx, color: CONTACT_HEADING_LABEL_DEFAULT.color, textAlign: CONTACT_HEADING_LABEL_DEFAULT.textAlign },
      ],
    };
    if (!st || typeof st !== "object") return out;
    const tfs = parseInt(st.contactTitleFontSizePx, 10);
    if (!isNaN(tfs) && tfs > 0) out.title.fontSizePx = tfs;
    if (typeof st.contactTitleColor === "string" && st.contactTitleColor) out.title.color = st.contactTitleColor;
    if (st.contactTitleTextAlign === "left" || st.contactTitleTextAlign === "center" || st.contactTitleTextAlign === "right") {
      out.title.textAlign = st.contactTitleTextAlign;
    }
    const fsa = st.contactFieldLabelFontSizePx;
    const cols = st.contactFieldLabelColors;
    const tas = st.contactFieldLabelTextAligns;
    for (let i = 0; i < 3; i++) {
      if (Array.isArray(fsa) && fsa[i] != null) {
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
    titleEl.style.fontSize = h.title.fontSizePx + "px";
    titleEl.style.color = h.title.color;
    titleEl.style.textAlign = h.title.textAlign;
    const labs = labelNodeList && labelNodeList.length ? Array.prototype.slice.call(labelNodeList, 0) : [];
    for (let i = 0; i < 3 && i < labs.length; i++) {
      labs[i].style.fontSize = h.labels[i].fontSizePx + "px";
      labs[i].style.color = h.labels[i].color;
      labs[i].style.textAlign = h.labels[i].textAlign;
    }
  }

  function readContactHeadingStyleFromDomForSerialize(el) {
    const title = el.querySelector(".canvas-block__contact-title");
    const labs = el.querySelectorAll(".canvas-block__contact-row-label");
    const t = title ? readContactTitleStyleForPanel(title) : CONTACT_HEADING_TITLE_DEFAULT;
    const fs = [];
    const cols = [];
    const tas = [];
    for (let i = 0; i < 3; i++) {
      const L = labs[i] ? readContactFieldLabelStyleForPanel(labs[i]) : CONTACT_HEADING_LABEL_DEFAULT;
      fs.push(L.fontSizePx);
      cols.push(L.color);
      tas.push(L.textAlign);
    }
    return {
      contactTitleFontSizePx: t.fontSizePx,
      contactTitleColor: t.color,
      contactTitleTextAlign: t.textAlign,
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
    const d = [10, 10, 36];
    if (!Array.isArray(arr) || arr.length < 3) return d;
    for (let i = 0; i < 3; i++) {
      const n = parseInt(arr[i], 10);
      if (!isNaN(n) && n >= 4) d[i] = n;
    }
    return d;
  }

  function readContactFieldHeightsPx(wrap) {
    const fakes = wrap.querySelectorAll(".canvas-block__contact-fake");
    const out = [10, 10, 36];
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
    fake.style.height = "";
    const body = fake.closest(".canvas-block__contact-body");
    if (body) syncContactBodyGridFromFakes(body);
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
      const fake = document.createElement("span");
      fake.className = "canvas-block__contact-fake";
      fake.style.minHeight = fh[rowDef[1]] + "px";
      fake.setAttribute("aria-hidden", "true");
      row.appendChild(lab);
      row.appendChild(fake);
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
    wrap.appendChild(chrome.form);
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
    el.addEventListener("mousedown", onBlockMouseDown);
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

  function beginBlockDrag(el, clientX, clientY) {
    if (document.body.classList.contains("nocode-published-mode")) return;
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

    function onUp() {
      clearAllSnapGuides();
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      canvas.classList.remove("is-dragging");
      dragState = null;
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function onBlockMouseDown(e) {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    if (e.target && e.target.closest && e.target.closest(".canvas-block__resize-handle")) return;
    if (isEditingTarget(e.target)) return;
    if (el.dataset.type === "container") {
      const inner = e.target.closest(".canvas-block__nest .canvas-block");
      if (inner && inner !== el && el.contains(inner)) return;
    }
    beginBlockDrag(el, e.clientX, e.clientY);
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

    if (!editing && (e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) {
      const p = primarySelected();
      if (p && canvas.contains(p)) {
        e.preventDefault();
        copySelectedBlockToClipboard();
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

  if (window.NoCodePages && typeof window.NoCodePages.migrateLegacyIfNeeded === "function") {
    window.NoCodePages.migrateLegacyIfNeeded();
  }

  var loadedFromPageRegistry = false;
  var urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("published") === "1") {
    document.body.classList.add("nocode-published-mode");
  }
  var pageIdParam = urlParams.get("page");
  if (pageIdParam && window.NoCodePages && typeof window.NoCodePages.getPage === "function") {
    if (typeof window.NoCodePages.migrateLegacyIfNeeded === "function") {
      window.NoCodePages.migrateLegacyIfNeeded();
    }
    var pageEntry = window.NoCodePages.getPage(pageIdParam);
    if (pageEntry && pageEntry.document) {
      if (applyCanvasDocument(pageEntry.document)) {
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
      var tsMissing = document.getElementById("templateSelect");
      if (tsMissing) tsMissing.value = "";
    }
  }

  var restoredPersistedDoc = false;
  if (!loadedFromPageRegistry) {
    restoredPersistedDoc = tryLoadPersistedDocumentOnStartup();
  }
  if (!restoredPersistedDoc && !loadedFromPageRegistry) {
    applyCanvasDocument(createBlankCanvasDocument());
  }
  initTemplateUI();
  wireTemplateSelectOnce();
  if (!restoredPersistedDoc && !loadedFromPageRegistry) {
    const ts = document.getElementById("templateSelect");
    if (ts) {
      ts.value = "";
    }
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

  window.NoCodeTemplates = {
    templates: templates,
    loadTemplate: loadTemplate,
    initTemplateUI: initTemplateUI,
    registerTemplate: registerTemplate,
    DEFAULT_TEMPLATE_KEY: DEFAULT_TEMPLATE_KEY,
  };
})();
