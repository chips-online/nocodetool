/**
 * =============================================================================
 * ブロック JSON（キャンバス・ドキュメント）仕様 — 固定
 * =============================================================================
 * キー名・型・各 type ごとのプロパティ集合は、利用者からの明示指示があるまで
 * 変更しないこと。
 *
 * 実装の単一ソース: editor.js の serializeCanvasDocument / applyCanvasDocument（app.js に同名がある場合は追随）
 * （このファイルはバージョン定数と仕様コメントのみを担う）
 *
 * -----------------------------------------------------------------------------
 * schemaVersion: number  （現行は BLOCK_DOCUMENT_SCHEMA_VERSION のみ）
 *
 * ルートオブジェクト（単一ビュー・従来形式）:
 * {
 *   "schemaVersion": <number>,
 *   "canvas": {
 *     "widthPx": <number>       （省略時は 1200 相当）
 *     "floorHeightPx": <number>
 *     "backgroundColor": string
 *     "backgroundImageSrc": string   （空＝なし）
 *     "backgroundImageFit": string    （"cover" | "contain" | "repeat"）
 *   },
 *   "blocks": [ <Block>, ... ]
 * }
 *
 * ルートオブジェクト（PC／スマホ別レイアウト・editor.js 現行の保存形式）:
 * {
 *   "schemaVersion": <number>,
 *   "layoutMode": "dualViewport",
 *   "editingViewport": "desktop" | "responsive",
 *   "viewports": {
 *     "desktop": { "canvas": { ... }, "blocks": [ ... ] },
 *     "responsive": { "canvas": { ... }, "blocks": [ ... ] }
 *   }
 * }
 * 従来の単一 canvas + blocks 形式の JSON も読み込み可能（スマホ側は自動で複製・幅のみ初期化）。
 *
 * schemaVersion 2 以降: ネスト可能な type "container" を blocks に含められる。
 *
 * 各 Block 共通フィールド:
 *   "id": string
 *   "type": "text" | "image" | "button" | "contact" | "container"
 *   "x": number
 *   "y": number
 *   "zIndex": number
 *   "layerTitle": string     （省略可。レイヤー一覧の表示名）
 *   "layerHidden": boolean   （省略可。true のときキャンバス上は非表示）
 *
 * type が "text" のとき 追加:
 *   "text": string
 *   "style": {
 *     "textFormat": string   （省略可。"html" のとき text は HTML 断片として innerHTML 適用。省略時は従来どおりプレーンテキスト）
 *     "fontSizePx": number
 *     "color": string        （例: "#1a1d21"）
 *     "fontWeight": string   （例: "400" | "600" | "700"）
 *     "fontFamily": string    （省略時は "sans-serif"。例: "sans-serif" | "serif" | "cursive"）
 *     "widthPx": number      （0 ＝枠幅は内容任せ）
 *     "heightPx": number     （0 ＝枠高さは内容任せ）
 *     "textAlign": string     （"left" | "center" | "right" 枠内の行揃え）
 *     "lineHeight": number    （省略可。行ボックスの倍率 例: 1.5）
 *     "letterSpacing": number | string  （省略可。数値は em 単位で付与、文字列はそのまま）
 *     "textTransform": string （省略可。"uppercase" | "lowercase" | "none"）
 *   }
 *
 * type が "image" のとき 追加:
 *   "src": string
 *   "widthPx": number
 *   "heightPx": number       （0 ＝高さはアスペクト比に任せる）
 *
 * type が "button" のとき 追加:
 *   "label": string
 *   "style": {
 *     "fontSizePx": number
 *     "color": string
 *     "backgroundColor": string        （"#rrggbb" または "transparent"）
 *     "backgroundColorSolid": string    （透過時に戻す固体色。省略時は #2563eb）
 *     "widthPx": number              （0 ＝横幅自動）
 *     "heightPx": number             （0 ＝高さは内容・パディング任せ）
 *     "paddingVerticalPx": number
 *     "paddingHorizontalPx": number
 *     "borderRadiusPx": number
 *     "borderWidthPx": number
 *     "borderColor": string
 *     "backgroundImageSrc": string    （空＝なし）
 *     "backgroundImageFit": string    （"cover" | "contain" | "repeat"）
 *     "fontFamily": string  （省略時は "sans-serif"）
 *     "fontWeight": string  （省略時は "600" 相当）
 *     "lineHeight": number  （省略可。行ボックスの倍率）
 *   }
 *
 * type が "contact" のとき 追加（フォーム枠＋送信ボタンの style、連携先）:
 *   "label": string              （フォーム見出し文言）
 *   "submitLabel": string        （送信ボタン文言。省略時は "送信"。旧データのみ label がボタン文言だった場合は読み込み時に解釈）
 *   "contact": {
 *     "mode": string    （"none" | "email" | "line" | "url" — 公開時の遷移先。未設定は none）
 *     "value": string   （メールアドレス、LINE 用 ID/URL、または任意 URL）
 *   }
 *   "style": {
 *     … フォーム枠は widthPx / heightPx（キャンバス上リサイズで変更）、
 *     項目プレビューは fieldHeightsPx: [number, number, number]、
 *     縦方向の余白は contactGapTitleBodyPct / contactGapFieldsPct / contactGapMainButtonPct /
 *     contactGapLabelFieldPct（各フォーム内側の高さに対する 0〜25 の％。省略時は既定値）、
 *     フォーム枠の背景色は contactFormBackgroundColor（# で始まる hex）、
 *     フォーム枠の角丸は contactFormBorderRadiusPx（px。省略時は従来どおり 8 相当）、
 *     見出しは contactTitleFontSizePx / contactTitleColor / contactTitleTextAlign、
 *     各項目ラベルは contactFieldLabelFontSizePx / contactFieldLabelColors / contactFieldLabelTextAligns（各 3 要素の配列）、
 *     送信ボタンは submitWidthPx / submitHeightPx（0 または省略で幅いっぱい等）、
 *     その他はボタンと同様（色・枠・padding 等）
 *   }
 *
 * type が "container" のとき 追加:
 *   "children": [ <Block>, ... ]   （ネスト内のブロック。座標はコンテナ内相対）
 *   "style": {
 *     "minWidthPx": number      （0 または省略＝既定の最小幅）
 *     "minHeightPx": number
 *     "widthPx": number         （0 または省略＝幅は内容・最小幅に任せる）
 *     "heightPx": number
 *     "paddingPx": number
 *     "borderRadiusPx": number    （内側ネストの角丸 px。省略時は 6）
 *     "backgroundColor": string   （空＝クリア）
 *   }
 * =============================================================================
 */
window.BLOCK_DOCUMENT_SCHEMA_VERSION = 2;
