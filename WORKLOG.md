# 作業記録（2026-04-14）

## 実施内容

### 1. テンプレートJSONの外部化
- `app.js`内に埋め込まれていたテンプレート定義を分離
- `templates`フォルダを作成し、以下を追加
  - `templates/cafe.json`
  - `templates/salon.json`
  - `templates/supplement.json`

### 2. テンプレート読み込みを遅延化
- テンプレート選択時のみJSONを読み込む方式に変更
- `fetch` + `async/await`で非同期読み込みを実装
- 既存のUI構造は変更なし
- `buildBlockFromEntry`は未変更

### 3. JS分割（肥大化対策）
- `app.js`相当の本体を`editor.js`へ移行
- 状態と定数の管理を`state.js`へ分離
- 描画関連ユーティリティを`renderer.js`へ分離
- `import/export`で連携
- `index.html`の読み込みをモジュール化
  - `editor.js` を `type="module"` で読み込み
  - `template-system.js` を `type="module"` で読み込み

## 現在の主要ファイル
- `editor.js`
- `state.js`
- `renderer.js`
- `templates/cafe.json`
- `templates/salon.json`
- `templates/supplement.json`
- `index.html`

## 補足
- 旧`app.js`は現時点で未参照（互換のため残置）

---

## 障害対応ログ（2026-04 追記）

### 事象A: 白紙保存後のリロードでサプリメントLPが再表示される
- **症状**
  - ブロックを消して保存しても、更新時に `productSalesStory`（`supplement.json`）相当の内容が戻る。
- **主因**
  - `localStorage` に古い保存データ（`activeTemplateKey: "productSalesStory"` / 旧 `viewports` キャッシュ）が残っていた。
  - PC/スマホの二重ビュー状態が非対称のまま保存され、片側の古い `blocks` が復元に混入していた。
- **対応**
  - 保存時に編集中ビューの `blocks` を反対ビューへ同期（`viewports` 間の不整合を抑止）。
  - 読み込み時に片側だけ `blocks` が残る壊れデータを補正。
  - `activeTemplateKey` だけ残るケースを除去。
  - 保存キーを `savedTemplate` に統一し、旧キー（`nocodeTool_lp_document_v4` / `v3`）を読み込み時に移行・削除。
  - 起動分岐を整理し、保存データがあればそれを優先、無ければ初回テンプレート（または白紙）に限定。

### 事象B: `blocks` が空配列で保存される
- **症状**
  - `localStorage` に保存自体はされるが `viewports.desktop.blocks` が `[]` になる。
- **主因**
  - 保存直前のブロック取得が state 側のみで、状況により空配列を拾うことがあった。
- **対応**
  - 保存時シリアライズで state 取得を優先しつつ、空なら DOM 取得へフォールバック。
  - 保存前ログを追加: `console.log("保存するblocks:", blocks);`
  - 空保存警告を追加: `console.warn(...)`

### 事象C: ページ更新時にテンプレートが強制表示される
- **症状**
  - 保存データがあるのに更新後テンプレートへ戻る。
- **主因**
  - 起動条件分岐が複雑化し、保存データ適用失敗時にテンプレート分岐へ流れる経路があった。
- **対応**
  - 起動時の描画を1か所に集約し、`render`（`applyCanvasDocument`）を単発化。
  - `savedTemplate`（互換キー含む）の JSON 存在判定で保存データ経路へ固定。
  - 読み込みログを追加: `console.log("読み込みblocks:", saved.viewports.desktop.blocks);`

### 事象D: コンソール 404 / 外部通信エラー
- **404 (`favicon.ico`)**
  - **原因**: favicon 未配置によるブラウザ既定リクエスト。
  - **対応**: `favicon.svg` を追加し、`/favicon.ico` を `favicon.svg` へリダイレクト。
- **`POST https://apiwww.rakumart.com/... ERR_EMPTY_RESPONSE`**
  - **原因**: プロジェクト外（ブラウザ拡張等）由来の通信エラー。
  - **対応**: コードベース内に該当参照が無いことを確認。開発対象外として切り分け。

### 最終的な確定原因（ユーザー検証）
- `localStorage.clear(); location.reload();` 実施後に再発が止まり、**古い `localStorage` データ残存が主因**であることを確認。

### 運用メモ（再発防止）
- 仕様変更時は保存キーの移行処理を同時に用意する。
- 起動処理は「保存データ優先」を単一路線に保つ。
- 不具合切り分け時は、まず `localStorage` の対象キーを確認する。

### 事象E: スマホ編集（美容サロン）でキャンバス内スクロールバーが消えない
- **症状**
  - スマホ編集ビュー（`nocode-edit-view-responsive`）で、`body.nocode-tpl--beautySalon ... .canvas` に縦スクロールバーが出る。
  - DevTools で `max-width` を一度外して戻すと一時的に消えるが、再レイアウト後に再発する。
- **主因**
  - `max-width` そのものではなく、`.canvas` に指定した `overflow-x: hidden` が影響。
  - この指定により別軸の `overflow-y` が `auto` 扱いになり、`canvas` が縦スクロールコンテナ化していた。
  - さらにスマホ向け最終上書きで `overflow` を広範囲（`app-body/workspace` まで）に変更し、サイド枠連動やスクロール不能の副作用が発生した。
- **対応（確定）**
  - スマホ編集時の `.canvas` / `.canvas-sp` を以下へ変更:
    - `overflow-x: hidden` → `overflow-x: clip`
    - `overflow-y: visible` を明示
  - 美容サロン専用の `.canvas` ルールにも同じ修正を適用。
  - スマホ編集モードのスクロール責務を整理:
    - `body` は `overflow: hidden`（固定）
    - `main-area` のみ `overflow-y: auto`
    - `app/app-body/workspace` は `height: 100%`, `min-height: 0`, `overflow: hidden`
  - これにより「サイド枠は固定」「スクロールは管理画面側」「キャンバス内スクロールなし」を両立。

### 事象F: 自動保存の意図せぬ再有効化
- **症状**
  - 変更時に `localStorage` が更新され続ける（手動保存運用と不整合）。
- **主因**
  - `scheduleAutoSaveToLocalStorage()` が一時的に再実装され、デバウンス自動保存が有効化された。
- **対応（確定）**
  - `scheduleAutoSaveToLocalStorage()` を再度空実装へ戻し、保存経路を「今すぐ保存」ボタンのみに統一。

### 検証で得た知見（今回）
- DevTools で `max-width` をトグルして一時的に直るケースは、値そのものより「再レイアウトのトリガー」の可能性が高い。
- キャンバス内スクロール問題は、幅指定より `overflow` の軸間相互作用（`hidden` と `auto`）を疑うのが有効。

---

## 作業記録（2026-04-16）

### キャンバス表示：ルーラー撤去と拡大縮小（ズーム）
- **方針変更**: 当初検討していたルーラー（px 目盛り）は不要。要望は**表示の拡大・縮小**だったため差し替え。
- **削除**: `canvas-ruler.js`、関連 HTML / CSS、サイドバーの「ルーラー表示」チェック。
- **追加**: `canvas-zoom.js`
  - スライダー、−／＋、100% リセット、「全体表示」。
  - DOM: `#canvas-zoom-viewport` → `#canvas-zoom-scale` → 既存 `.canvas-scroll` → `#canvas`。
  - 倍率 25〜200%（5% 刻み）、`localStorage` キー `nocode_editor_canvas_zoom_pct`。
  - `zoom` 対応ブラウザは CSS `zoom`、それ以外は `transform: scale` ＋ `ResizeObserver` でラッパー調整。
- **その他**: `editor.js` の `centerCanvasInEditorView` に `#canvas-zoom-viewport` を追加。公開モード（`body.nocode-published-mode`）ではズームバー非表示・倍率リセット。
- **対象 HTML**: `editor.html` / `index.html` で `canvas-zoom.js` を読み込み。

### データ共有・テンプレート（美容サロン PC）
- **補足**: 「今すぐ保存」はブラウザ `localStorage` のみのため、Cursor から直接は読めない。共有には **JSON ダウンロード**やプロジェクトにファイル配置が必要。
- **実施**: ユーザーが配置した `lp-document.json` の `viewports.desktop` をテンプレート形式に変換し、**`templates/salon.desktop.json` を上書き**（`name` / `canvas` / `data`）。スマホ用 `salon.mobile.json` は未変更。

### ヘッダー：保存 UI のコンパクト化
- **課題**: 上部固定の保存エリアが縦に長すぎる。
- **対応**: 「今すぐ保存」「新規作成」と「その他の保存・読込」を**同一行**に配置。
- 「その他」は **details** のまま、ラベルに **▼**（開閉で反転）。詳細パネルは広い画面では **`position: absolute` のドロップダウン**でヘッダー高を抑止。ステータス行はその下に1行。
- **対象**: `editor.html` / `index.html`、`styles.css`（`persist-toolbar*` 等）、`styles.css?v=20260416c`。

### レイヤーパネル：一覧の上下と新規の位置
- **要望**: 新規ブロックは一覧の**下**に。コンテナ内の子レイヤーも**上下を反対**（従来と逆の並び）に。
- **実装**（`editor.js` / `app.js` の `renderLayers`）:
  - 表示順を `backToFront`（z 昇順）のまま利用し、**奥＝上・手前＝下**に統一（従来は `reverse()` で手前が上だった）。
  - 新規は従来どおり最大 z のため、一覧では**常に最下行**。
  - コンテナ内子も同じルール（`siblingsStackSorted` の結果をそのまま表示）。
- **↑↓ボタン**: 一覧方向に合わせ、手前へ＝**↓**、奥へ＝**↑** に入れ替え。ツールチップを追記。
- **ヘルプ文言**: `editor.html` / `index.html` のレイヤー説明を「リスト上＝奥／下＝手前」等に更新。

### 触った主なファイル（本日まとめ）
- `canvas-zoom.js`（新規）、`canvas-ruler.js`（削除）
- `editor.html`、`index.html`、`styles.css`
- `editor.js`、`app.js`
- `templates/salon.desktop.json`（`lp-document.json` 由来で更新）
- `lp-document.json`（ユーザー配置の参照元・記録用）

---

## 作業記録（2026-04-16）

### レイヤーパネル：コンテナ内外へのブロックの出し入れ
- **要望**: 同一親内の並べ替えだけでなく、別親（キャンバス／コンテナのネスト）へドラッグで移動したい。
- **実装**（`editor.js` / `app.js`）:
  - `reorderBlockRelativeToCore`（Undo なしの z 並べ替え）と `reorderBlockRelativeTo`（Undo あり）を分離。
  - `isDomAncestorOf` で親を子の内側へ入れる誤操作を防止。
  - `tryReparentLayerBlockByDrop`（`editor.js` のみ Undo）: コンテナ行へドロップでネスト内へ、`Shift`+ドロップでコンテナの直前に兄弟配置、その他は `insertBefore` 後に z 調整。
  - レイヤー行の `dragover` / `dragenter` / `drop` を上記に対応。
- **UI**: ドラッグハンドル `title` と `editor.html` / `index.html` のレイヤー説明に操作ヒントを追記。

### コーポレートテンプレート・テンプレ上書き API
- **`lp-copopc.json`** を元に **`templates/corporate.desktop.json`** を更新（`viewports.desktop` → テンプレ形式）。
- **スマホ**: 後に **`lp-coposp.json` の `viewports.responsive`** で **`templates/corporate.mobile.json` を上書き**（ユーザー手元のスマホ用データを反映）。
- **`server.js`**: Windows で `templates` パスが `startsWith` で不一致になる問題を **`path.resolve` + `path.relative`** で判定するよう修正。`ADMIN_PASSWORD` の先頭 BOM を除去する `readAdminPasswordSecret` を追加。
- **`editor-template-api.js`**: `invalid_path` / `write_failed` 時のメッセージを具体化。キャッシュバスト `?v=20260416n`。

### スマホ用コーポレート：キャンバス幅に合わせたレイアウト
- **課題**: 1200px 相当のままだと 400px キャンバスで左に寄って見える。
- **対応**: `corporate.mobile.json` を **幅 400px 基準**、テキストは **左右 20px・幅 360px・中央寄せ** 等に調整。ヒーロー画像を **400px 幅**に変更（`lp-coposp.json` も同様の画像指定を同期）。

### カラー：16 進の直接入力
- **要望**: カラーピッカーに加え **#RRGGBB 等をテキストで入力**したい。
- **実装**:
  - `normalizeHexColor`（`#RGB` / `#RRGGBB`、先頭 `#` 省略可）を `editor.js` / `app.js` に追加。
  - `addField(..., "color")` を **ピッカー + テキスト**の2段に変更。
  - キャンバス背景: `editor.html` / `index.html` に `canvas-bg-color-hex-input` を追加し、読み書き同期。
  - お問い合わせ見出しの色同期: `syncFieldColorPair`。
  - ボタン「背景色（透過OFF時）」を `addField` 化（`prop-btn-bg-solid`）。
  - **`styles.css`**: `.field--colorPair` / `.field__color-row` / `.field__color-hex`。

### スマホ用ポートフォリオテンプレート
- **要望**: 他スマホテンプレ同様に 400px 基準へ。**PC 用には影響させない**。
- **対応**: **`templates/portfolio.mobile.json` のみ**再構成（ルート幅 400、PROFILE は縦並び、WORKS は 6 枚縦積み等）。**`portfolio.desktop.json` は未変更**。

### 本記録で主に触れたファイル
- `editor.js`、`app.js`、`server.js`、`editor-template-api.js`
- `editor.html`、`index.html`、`styles.css`
- `templates/corporate.desktop.json`、`templates/corporate.mobile.json`
- `templates/portfolio.mobile.json`
- `lp-copopc.json`、`lp-coposp.json`（ユーザー配置・反映元）

---

## AI テキスト生成（/generate）・引き継ぎ（2026-04-19 時点）

次回セッションで続きをするための要約。**目的**: OpenAI による文章生成をサーバー経由で公開し、利用制限・CORS・文字数制限付きで運用する。

### 実装済み（コード上）

| 項目 | 内容 |
|------|------|
| バックエンド | `Node.js` + `Express`。`server.js` に `app.all("/generate", …)`。ロジック本体は **`lib/ai-generate.js`**。 |
| OpenAI | モデル既定 `gpt-4.1-mini`（`OPENAI_MODEL` で上書き可）。`req.body.prompt`。成功時は **プレーンテキスト** のみ返却。 |
| 認証情報 | `OPENAI_API_KEY` は **`.env` のみ**（フロントに出さない）。 |
| 日次制限 | `userId` ごとに **1 日 5 回**。`data/generate-usage.json` に永続（**ローカル／単一プロセス**）。超過は **429** `daily_limit`。成功時のみ `count` 加算。 |
| クールダウン | 同一 `userId` で **5 秒以内**は **429** `cooldown`。 |
| フロント | **`ai-text-generate.js`**: 初回 UUID → `localStorage` キー `nocode_ai_user_id`。`POST /generate` に `{ userId, prompt }`（`prompt` は長さ・トーン・指示を結合）。**`index.html` / `editor.html`**: `<meta name="nocode-ai-api-base" content="">`（空＝同一オリジン）。 |
| キャンバス反映 | **`editor.js`**: `window.NoCodeAIText.apply(text, mode)`（`new-block` / `selected-text`）。 |
| Vercel | **`api/generate.js`** が `postGenerateExpress` を呼ぶ。**`vercel.json`**: `/generate` → `/api/generate`。`VERCEL=1` のとき利用状況は **メモリのみ**（インスタンス間で共有されない。本番で厳密にするなら KV 等が必要）。 |
| 安全 | **CORS**: `ALLOWED_ORIGINS`（カンマ区切り・末尾スラッシュなし）。**Origin 必須**（ブラウザ以外は手動で Origin 付与）。**プロンプト最大 500 文字**。エラーは **JSON** `{ error, code }`（成功のみ `text/plain`）。 |
| JSON パース失敗 | **`server.js`**: `express.json` 直後の 4 引数ミドルウェアで **400** `invalid_json`。 |

### 修正済みバグ（重要）

- **検証順序**: 当初 `OPENAI_API_KEY` 未設定だと `userId` 欠落でも **503** になっていた。**`userId` / `prompt` のバリデーション → レート制限 → API キー確認**の順に変更済み（`lib/ai-generate.js`）。

### 動作確認スクリプト

- **`scripts/verify-generate-api.js`**: CORS（Origin なし）、`userId` 必須、不正 JSON、キー未設定の 503 を HTTP で検証。
- **`package.json`**: `"verify:generate": "node scripts/verify-generate-api.js"`。
- 使い方例: ターミナル A で `PORT=3850 node server.js`、ターミナル B で `TEST_PORT=3850 npm run verify:generate`。`TEST_ORIGIN` は既定 `http://localhost:3847`（`.env` の `ALLOWED_ORIGINS` に含まれるオリジンに合わせる）。

### 環境変数（`.env` / `.env.example`）

- 必須（生成を動かす）: **`OPENAI_API_KEY`**（コメント解除して実キーを設定）。
- 必須（ブラウザから呼ぶ）: **`ALLOWED_ORIGINS`**（例: `http://localhost:3847` と本番の `https://xxx.vercel.app`）。
- 任意: `OPENAI_MODEL`、`PORT`、`ADMIN_PASSWORD`（従来どおりテンプレ API 用）。

### 未完了・次回やること（ユーザー／環境依存）

1. **`.env` に `OPENAI_API_KEY` を設定**し、ブラウザで「テキストを生成」が **200 で本文が返る**ことまで実機確認。
2. **1 日 5 回・5 秒クールダウン**の E2E（実 API またはモックで自動化を拡張するか検討）。
3. **Vercel デプロイ**: 環境変数 `OPENAI_API_KEY` / `ALLOWED_ORIGINS` を設定し、**公開 URL** で動作確認。静的と API が同一デプロイなら `nocode-ai-api-base` は空のままでよい。
4. **コスト**: OpenAI ダッシュボードで利用上限（例: 月 $5）を設定する運用を推奨。

### 関連ファイル一覧（この機能）

- `server.js`、`lib/ai-generate.js`、`api/generate.js`、`vercel.json`
- `ai-text-generate.js`、`editor.js`（`NoCodeAIText`）、`index.html`、`editor.html`
- `package.json`、`.env.example`、`.gitignore`（`data/generate-usage.json`）
- `scripts/verify-generate-api.js`
