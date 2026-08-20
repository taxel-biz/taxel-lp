# taxel.biz サイト運用ガイド

このリポジトリは **https://www.taxel.biz**（Taxelコーポレートサイト）の本体です。
`main` に push すると **Netlifyが自動でデプロイ**します。約1分で本番に反映されます。

---

## 1. 必要なアクセス権限

| サービス | 権限 | 誰が付与するか | 状態 |
|---|---|---|---|
| **GitHub** `taxel-biz` Organization | Member（`taxel-lp` への write） | Takeru | ⏳ `nao.satsuki@taxel.biz` 宛に招待済み・**承諾待ち** |
| **Netlify** チーム `taxel` | **不要**（無料プランではメンバー追加が有料。かつ**なくてもデプロイできる**） | ― | 付与しない |
| Squarespace（DNS） | **不要** | ― | 付与しない方針 |
| Google Search Console | 必要になったら | Takeru | ⏳ 未 |

### GitHub の招待を承諾する
`nao.satsuki@taxel.biz` に届いている招待メール、または https://github.com/orgs/taxel-biz/invitation から承諾してください。
届いていない場合はTakeruに連絡を（GitHubユーザー名での再送に切り替えます）。

> **DNS（Squarespace）の権限は渡していません。** DNSを誤操作すると `@taxel.biz` のメールが全部止まるためです。
> DNS変更が必要になったらTakeruに依頼してください。

> **Netlifyのアカウントは不要です。** デプロイはGitHubへのpushをトリガーに自動で走るので、
> Netlifyにログインできなくても更新作業は完結します。
> ビルドログやフォーム受信内容を見たい場合だけTakeruに共有を依頼してください。

---

## 2. 環境構築（5分・ビルド不要）

```bash
git clone https://github.com/taxel-biz/taxel-lp.git
cd taxel-lp
```

**依存パッケージもビルドも必要ありません。** 素のHTMLです（Tailwind CDN + Google Fonts）。

ローカルで確認するには：
```bash
python -m http.server 8899
# → http://localhost:8899
```

> ⚠️ `file://` で直接開かないでください。内部リンクがルート絶対パス（`/company/` 等）なので壊れます。必ずサーバー経由で。

---

## 3. サイト構成（全15ページ）

```
index.html                    トップ
company/index.html            会社概要
taxel_column/index.html       ブログ一覧
taxel_column_article/         記事テンプレート
column/<slug>/index.html      コラム記事 ×10
thanks/index.html             フォーム送信後のお礼ページ（noindex）
404.html                      404ページ
```

補助ファイル：`robots.txt` / `sitemap.xml` / `favicon.svg` / `favicon.ico` / `apple-touch-icon.png` / `CNAME`

---

## 4. 更新のしかた

```bash
git switch -c feature/<変更内容>     # mainに直接pushしない
# HTMLを編集
python -m http.server 8899           # ローカルで目視確認
git add -A && git commit -m "..."
git push -u origin feature/<変更内容>
# → GitHubでPRを作成。Netlifyがプレビューを自動生成するのでそのURLで確認 → マージ
```

**mainにマージされた時点で本番に反映されます。**

### 記事を追加するとき
1. `column/<新しいslug>/index.html` を作成（既存記事をコピーして中身を差し替えるのが早い）
2. `taxel_column/index.html` の一覧にカードを追加
3. **`sitemap.xml` にURLを追加**（忘れやすい）
4. `<link rel="canonical">` を新しいURLに直す（コピー元のまま残さない）

---

## 5. 🚨 触ってはいけないもの

| ファイル / 箇所 | 理由 |
|---|---|
| `googlee0c7c6569f15d3ab.html` | **削除するとSearch Consoleの所有権確認が外れる** |
| `CNAME`（中身は `www.taxel.biz`） | ドメイン設定 |
| 各ページの `<link rel="canonical">` の **www** 表記 | apexは www にリダイレクトされる。canonicalが非wwwだとGoogleが混乱する |
| `<form name="contact" ...>` の `name` 属性と hidden の `form-name` | 変えるとNetlify Formsが別フォーム扱いになり、通知が届かなくなる |
| `robots.txt` の `Sitemap:` 行 | ― |

### 書かないこと（サイトの編集方針）
- **架空の顧客名・事例・ロゴを載せない**（2026-08-19に全部撤去した経緯があります）
- **根拠のない数値を書かない**。数字を載せるなら出典を併記する
- 「（仮）」「未確定」などの内部向け表記を残さない

---

## 6. 問い合わせフォーム

Netlify Forms（無料・月100件）。送信されると **`info@taxel.biz`** にメールが届きます。
受信内容は Netlify の Forms ページでも確認できます。

フォームのHTMLを変更したら、**Netlifyの新規デプロイが走るまで反映されません**（デプロイ時にパースされる仕組み）。

---

## 7. 困ったとき

| 症状 | 確認するところ |
|---|---|
| pushしたのに反映されない | Netlify → Deploys（ビルド失敗していないか） |
| ページが404になる | ディレクトリ名/index.html の構成になっているか |
| フォームの通知が来ない | Netlify → Forms（submissionが記録されているか）→ Notifications |
| リポジトリが見つからない（404） | **ログイン中のGitHubアカウントを確認**。権限がないとprivate/組織リポジトリは404になります |

経緯・設計の記録：`deliverables/taxel_lp_20260819/`（`taxel-biz/taxel-docs` リポジトリ内）
