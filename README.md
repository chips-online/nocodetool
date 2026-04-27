# NoCodeTool

簡易ノーコード LP エディタ。テンプレート JSON の**上書き保存**は Node.js サーバー（`server.js`）経由でのみ行え、パスワードは**サーバー側の環境変数**で管理します。

## まず最初に（読み分けガイド）

- **ローカル開発用の手順**: `ローカルで確認する` 〜 `Supabase で LP を保存・公開する` まで  
- **一般公開（本番）用の手順**: **`Vercel へのデプロイ手順（一般公開）` から下**

> 一般公開したい場合は、**この README の「Vercel へのデプロイ手順（一般公開）」から開始**してください。

---

## ローカルで確認する（開発用）

1. **前提**  
   [Node.js](https://nodejs.org/) がインストールされていること（現行の LTS 版を推奨）。

2. **PowerShell でプロジェクトフォルダに移動し、カレントのパスを表示する**  
   `npm install` / `npm start` は、**このリポジトリのルート**（`package.json` と同じフォルダ）で実行してください。

   - **いま開いているフォルダのフルパスを表示する**（カレントディレクトリの確認）  
     PowerShell で次のいずれかを実行します。

     ```powershell
     Get-Location
     ```

     省略形として `pwd` も同じ意味です。パスだけを文字列で知りたい場合は次です。

     ```powershell
     (Get-Location).Path
     ```

   - **別の場所からプロジェクトフォルダへ移動する**  
     フォルダのパスにスペースが含まれる場合は、**ダブルクォート**で囲みます。

     ```powershell
     cd "C:\Users\chipp\OneDrive\ドキュメント\AI program\NoCodeTool"
     ```

     移動したあと、再度 `Get-Location` や `(Get-Location).Path` で、意図したフォルダになっているか確認できます。

   - **エクスプローラーから開く**  
     プロジェクトフォルダをエクスプローラーで開いた状態で、アドレスバーをクリックしてパスをコピーしたり、フォルダ内の空白を **Shift+右クリック** → **ターミナルで開く**（Windows のバージョンによりメニュー名が異なる場合があります）で、そのフォルダをカレントにした PowerShell を開けます。

3. **依存パッケージのインストール（初回のみ）**  
   プロジェクトのルート（`package.json` があるフォルダ）で次を実行します。

   ```bash
   npm install
   ```

4. **サーバーの起動**

   ```bash
   npm start
   ```

   `server.js` が起動し、既定では **ポート `3847`** で待ち受けます（`.env` の `PORT` で変更できます）。

5. **ブラウザで開く**  
   次の URL を開いて動作を確認します（`PORT` を変えた場合は番号を合わせてください）。

   | 用途 | URL |
   |------|-----|
| LP エディタ | `http://localhost:3847/editor` または `http://localhost:3847/editor.html` |
   | トップ | `http://localhost:3847/` または `http://localhost:3847/index.html` |
| 公開用 LP | `http://localhost:3847/view?id=<ページID>`（互換: `lp.html?id=<ページID>`） |
   | 管理画面 | `http://localhost:3847/admin.html` |

   **HTML を `file://` で直接開かないでください。** テンプレート JSON の読み込みや API の挙動は、`npm start` で表示した `http://localhost:...` 経由と一致させる必要があります（詳しくは後述の「テンプレートを更新したのに画面に反映されない」）。

6. **テンプレート上書き保存や認証 API を試す場合**  
   ルートに `.env` を置き `ADMIN_PASSWORD` を設定し、サーバーを起動し直します。手順は次節「管理者パスワードの設定」を参照してください。エディタの表示だけなら、パスワード未設定でもサーバーは起動します（保存 API は失敗します）。

7. **終了**  
   サーバーを動かしているターミナルで `Ctrl+C` を押して停止します。

---

## 管理者パスワードの設定

テンプレート上書き（`editor.html` の「テンプレートを上書き保存（管理者）」）および `POST /api/auth` / `POST /api/save-template` で使うパスワードです。**フロントのコードや README に実パスワードを書かないでください。**

### 1. `.env` ファイルを用意する

プロジェクトのルート（`package.json` と同じ階層）に `.env` を置きます。

初回は次のどちらかで作成できます。

- **推奨**: 同梱の `.env.example` をコピーして名前を `.env` に変更する  
  - Windows（エクスプローラー）: `.env.example` を複製し、ファイル名を `.env` にする  
  - PowerShell: `Copy-Item .env.example .env`
- または、新規にテキストファイル `.env` を作成する

### 2. `ADMIN_PASSWORD` を設定する

`.env` を開き、次のように **ご自身で決めたパスワード** を設定します。

```env
ADMIN_PASSWORD=ここに強力なパスワードを入力
```

- **変数名は `ADMIN_PASSWORD` 固定**です（`server.js` が `process.env.ADMIN_PASSWORD` を読みます）。
- 記号・長めの文字列を含めると安全です。
- 行頭の `#` はコメント行です。

任意で HTTP ポートも指定できます（省略時は `3847`）。

```env
ADMIN_PASSWORD=your-secret-password
PORT=3847
```

### 3. サーバーを起動し直す

環境変数は**プロセス起動時**に読み込まれます。パスワードを変更したら **必ずサーバーを一度止めてから** 再度起動してください。

```bash
npm start
```

起動後、ブラウザで `http://localhost:3847/editor.html`（`PORT` を変えた場合はその番号）を開き、テンプレート上書き保存時に同じパスワードを入力します。

### 4. Git にコミットしない

`.env` には秘密情報が入るため、**リポジトリにコミットしないでください**。このプロジェクトでは `.gitignore` に `.env` が含まれています。共有するのは **`.env.example`（ダミー値）のみ**にしてください。

---

## 補足

| 項目 | 内容 |
|------|------|
| 未設定時 | `ADMIN_PASSWORD` が空のとき、`/api/auth` と `/api/save-template` は常に失敗します。コンソールに警告が出ます。 |
| 検証の場所 | パスワードの比較は **サーバー上**のみ（`server.js`）。クライアントには正しいパスワードを埋め込みません。 |
| 本番環境 | HTTPS の利用、強いパスワード、必要に応じてリバースプロキシ側の認証・IP 制限などを検討してください。 |

---

## Supabase で LP を保存・公開する

`/editor` の「サーバーに保存」ボタンは、現在の LP JSON を Supabase の `pages` テーブルへ保存し、`/view?id=<uuid>` の共有 URL を発行します。

### 1. Supabase プロジェクトを作成

1. ブラウザで [Supabase](https://supabase.com/) を開き、アカウント登録またはログインします。  
2. ダッシュボードで **New project** をクリックします。  
3. 画面の入力欄を次のように埋めます。  
   - **Organization**: 既定のままでOK  
   - **Name**: 任意（例: `nocode-lp-tool`）  
   - **Database Password**: 自分で決めた強いパスワード（忘れないようメモ）  
   - **Region**: 日本から使うなら近いリージョンを選択  
4. **Create new project** を押して、作成完了まで待ちます（1〜2分程度）。  
5. プロジェクト作成後、左メニューの **Project Settings** → **API** を開きます。  
6. 次の2つをコピーして控えます（あとで `.env` と Vercel に設定します）。  
   - **Project URL**（`SUPABASE_URL` に使う）  
   - **Project API keys** の **anon public**（`SUPABASE_ANON_KEY` に使う）  

> 注意: `service_role` キーは強力な管理者キーです。このアプリでは使いません。

### 2. テーブル作成（`pages`）

SQL Editor で次を実行します。

```sql
create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  content jsonb not null,
  created_at timestamptz not null default now()
);
```

### 3. RLS（最小構成）

`anon` キーから insert/select できるように、必要最低限のポリシーを設定します。

```sql
alter table public.pages enable row level security;

create policy "allow public insert pages"
on public.pages
for insert
to anon
with check (true);

create policy "allow public select pages"
on public.pages
for select
to anon
using (true);
```

### 4. `.env` 設定

`.env` に次を追加し、サーバーを再起動します。

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

この値はサーバーの `GET /api/public-config` からフロントへ渡されます。

### 5. 動作確認

1. `npm start`
2. `http://localhost:3847/editor` を開く
3. LP を編集して「サーバーに保存」を押す
4. 表示された URL（`/view?id=...`）を開く
5. 別ブラウザでも同じ URL が表示されることを確認

---

## ===== ここから一般公開（本番）手順 =====

## Vercel へのデプロイ手順（一般公開）

このプロジェクトは `vercel.json` で `/editor`、`/view`、`/generate` を公開用ルートにマッピングしています。以下の手順で一般公開できます。

### 1. GitHub に push する（Windows / PowerShell）

【Step1：GitHub側の操作】  
1. [GitHub](https://github.com/) にログインします。  
2. 右上の **+** → **New repository** をクリックします。  
3. **Repository name** に好きな名前を入力します（ローカルフォルダ名と同じでなくてOK）。  
4. **Public** または **Private** を選びます。  
5. **Initialize this repository with a README** は **オフ** のままにします（既存プロジェクトをそのまま push するため）。  
6. **Create repository** を押します。  
7. 作成後に表示されるリポジトリURL（例: `https://github.com/あなたのユーザー名/あなたのリポジトリ名.git`）を控えます。  

【Step2：PowerShellでの操作】  
> ここからは **PowerShell** で実行します。まず、`package.json` があるプロジェクトフォルダで実行してください。  

```powershell
cd "C:\Users\chipp\OneDrive\ドキュメント\AI program\NoCodeTool"
```
このコマンドは、Git操作を行う作業フォルダへ移動します。  

```powershell
git init
```
このコマンドは、現在のフォルダを「Gitで管理するプロジェクト」として初期化します。  

```powershell
git add .
```
このコマンドは、現在フォルダ内の変更ファイルをコミット対象としてまとめて登録します。  

```powershell
git commit -m "prepare production deploy"
```
このコマンドは、登録した変更を「1つの履歴」として保存します。  

```powershell
git remote add origin https://github.com/<あなたのユーザー名>/<あなたのリポジトリ名>.git
```
このコマンドは、ローカルのGitとGitHubリポジトリを接続します。`<あなたのユーザー名>` と `<あなたのリポジトリ名>` を自分の値に置き換えてください。  

```powershell
git branch -M main
```
このコマンドは、現在のブランチ名を `main` にそろえます。  

```powershell
git push -u origin main
```
このコマンドは、ローカルの履歴をGitHubへ送信（初回公開）します。`-u` により次回から `git push` だけで送れるようになります。  

【Step3：確認方法】  
1. GitHubのリポジトリページを再読み込みします。  
2. ファイル一覧に `README.md` や `index.html` などが表示されれば成功です。  
3. PowerShellで次を実行し、`nothing to commit, working tree clean` と出ればローカル状態も正常です。  

```powershell
git status
```

よくあるエラーと原因（初心者向け）  
- `fatal: remote origin already exists.`  
  - 既に `origin` が登録済みです。`git remote -v` で確認し、URLを変える場合は `git remote set-url origin <新しいURL>` を使います。  
- `src refspec main does not match any`  
  - まだ `git commit` していない、またはブランチ名が `main` でない可能性があります。先に `git commit` を行い、`git branch -M main` を実行してください。  

### 2. Vercel にプロジェクトを接続

1. [Vercel](https://vercel.com/) にログイン
2. **Add New Project** を選択
3. GitHub リポジトリを選んで Import
4. Framework Preset は **Other**（静的 + Serverless API）で問題ありません

### 3. 環境変数を設定

Vercel の Project Settings → **Environment Variables** に次を登録します。

- `OPENAI_API_KEY`（必須）
- `OPENAI_MODEL`（任意、未設定時 `gpt-4.1-mini`）
- `ALLOWED_ORIGINS`（必須。例: `https://<your-project>.vercel.app`）
- `SUPABASE_URL`（必須）
- `SUPABASE_ANON_KEY`（必須）
- `ADMIN_PASSWORD`（テンプレート上書き機能を使う場合）

> `SUPABASE_SERVICE_ROLE_KEY` は**登録しないでください**（フロント公開用途では不要・危険）。

### 4. デプロイ実行

1. **Deploy** を押して初回デプロイ
2. 完了後に発行された URL（例: `https://<your-project>.vercel.app`）を開く

### 5. 本番確認チェックリスト

1. `https://<your-project>.vercel.app/editor` が開く
2. LP を編集して「サーバーに保存」が成功する
3. `/view?id=...` の URL が発行される
4. 別ブラウザ（シークレットウィンドウ可）でも同じ URL が表示される
5. `/view?id=...` をリロードしても 404 にならない
6. ブラウザのソースや Network に `OPENAI_API_KEY` が存在しない

### 6. 更新時のデプロイ

`main` ブランチへ push すると Vercel が自動再デプロイします。環境変数を変更した場合は、Vercel 側で再デプロイ（Redeploy）してください。

---

## テンプレートを更新したのに画面に反映されない

次のどれかが原因になることが多いです。

### 1. ブラウザの「キャッシュ」と localStorage は別

**キャッシュを削除しても、サイトのデータ（localStorage）に保存された LP は残ります。** エディタは起動時に「前回の作業」を localStorage から復元するため、**ディスク上の `templates/*.json` を更新しても、その古いキャンバスがそのまま表示**されます。

**対処:** ヘッダーの「その他の保存・読込」から **「ブラウザの保存を削除」** を実行するか、**「新規作成」** してから、テンプレートを選び直してください。

### 2. テンプレートを選び直す（メモリ・HTTP キャッシュ）

ドロップダウンで同じテンプレートを選び直すと、最新の JSON を読み直します（実装でキャッシュを避けています）。それでも古い場合は、上記 **localStorage の削除** を試してください。

### 3. `npm start` で開いているか

テンプレート保存 API と同じオリジン（例: `http://localhost:3847/editor.html`）で開くと、`templates/` 配下の JSON に `Cache-Control: no-store` が付与されます。**`file://` で HTML を直接開く**と挙動が異なることがあります。

### 4. サプリメント販売LPがリロードのたびに戻る

ブラウザ保存（`nocodeTool_lp_document_v4`、旧 `nocodeTool_lp_document_v3` は起動時に一度だけ読み取り v4 に移行）の JSON に **`activeTemplateKey` が `productSalesStory`** とブロックが残っていると、起動のたびにその内容が復元されます。初回のみ、エディタがその状態を検知して **白紙に差し替える**移行処理が入っています（フラグ `nocode_editor_supplement_sticky_purge_v1`）。意図的にサプリメントを使う場合は、テンプレートから選び直したあと **「今すぐ保存」** してください。

### 5. PC で白紙にしたのに更新後にサプリが戻る（PC／スマホの二重データ）

編集は **PC ビュー**と**スマホ ビュー**で別データを持ちます。片方だけ古いブロックが残ると、保存 JSON に混入しリロード後に再び現れることがありました。現在は **「今すぐ保存」時に、編集中ビューのブロックをもう一方のビューにも複製**して両方を一致させ、**読み込み時にも片方だけブロックがある壊れた保存を修復**します。

---

## 関連ファイル

| ファイル | 役割 |
|----------|------|
| `.env` | 実際のパスワード（ローカル・サーバーにのみ配置、Git 対象外） |
| `.env.example` | 変数名のサンプル（コミット可） |
| `server.js` | `dotenv` で `.env` を読み込み、API で検証 |
