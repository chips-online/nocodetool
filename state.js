export const editorLimits = {
  CANVAS_WIDTH_MIN: 400,
  CANVAS_WIDTH_MAX: 3840,
  CANVAS_HEIGHT_MIN: 200,
  CANVAS_HEIGHT_MAX: 16000,
  CANVAS_PADDING_BOTTOM: 0,
  CONTAINER_RESIZE_MIN_W: 100,
  CONTAINER_RESIZE_MIN_H: 60,
  BLOCK_RESIZE_MIN_TEXT_W: 48,
  BLOCK_RESIZE_MIN_TEXT_H: 28,
  BLOCK_RESIZE_MIN_IMG_W: 40,
  BLOCK_RESIZE_MIN_IMG_H: 40,
  BLOCK_RESIZE_MIN_BTN_W: 48,
  BLOCK_RESIZE_MIN_BTN_H: 36,
  CONTACT_FORM_MIN_W: 560,
  CONTACT_FORM_MIN_H: 480,
  CLIPBOARD_BLOCK_KIND: "nocodeToolBlockClip",
  PASTE_POSITION_OFFSET: 16,
  /** editor.js: 手動「今すぐ保存」のみ（LP ドキュメントはこのキーのみ） */
  LOCAL_STORAGE_DOC_KEY: "lp_data_v1",
  /** 旧: 自動保存のデバウンス。editor は手動保存のみのため未使用 */
  PERSIST_DEBOUNCE_MS: 1500,
  SNAP_GUIDE_THRESHOLD_PX: 6,
  /** PC / スマホの別レイアウト（編集ビュー切替） */
  VIEWPORT_DESKTOP: "desktop",
  VIEWPORT_RESPONSIVE: "responsive",
  /** 旧データ移行時・白紙のスマホ側の初期キャンバス幅（px） */
  RESPONSIVE_DEFAULT_CANVAS_WIDTH_PX: 400,
};

export function createInitialEditorState() {
  return {
    idSeq: 0,
    currentPageId: null,
    internalClipboard: null,
    canvasWorkWidthPx: 1200,
    canvasFloorHeightPx: 480,
    canvasBgColor: "#fffbf6",
    canvasBgImageSrc: "",
    canvasBgFit: "cover",
    selectedBlocks: [],
    dragState: null,
    hoverMeasureRaf: null,
    pendingHoverBlock: null,
    layerDragSourceBlock: null,
  };
}
