# Buffer投稿予約 GAS実装仕様（現在の状態）

最終更新: 2026-04-11

---

## 概要

MakeシナリオをGASで完全置き換えする実装。
Notionのタスクデータベースを監視し、Buffer経由でX/Threads/Instagram/TikTokに投稿予約（下書き）する。

---

## 実装ファイル

- `buffer-publisher.gs` — メイン実装（本番稼働中）

---

## 動作フロー

1. Notionから `buffer=true` かつ `進捗=投稿待ち` のページを取得
2. 媒体ステータス（×/S）を見て投稿対象を決定
3. **X画像をDriveにアップロード（Notion PATCH前に必ず実施）**
4. 投稿画像のDrive動画をCloudinaryにアップロード（ここでNotionをPATCH）
5. Buffer GraphQL APIに下書き投稿
6. NotionのステータスをPATCH（進捗→送信済み、buffer→false）
7. 漫画の場合：次話ページに今回のBuffer投稿URLを `前話X_URL` / `前話Threads_URL` として書き込む

---

## Notionデータベース情報

- **DB ID**: `1734552d5ffb8030a252c62abbb3331a`
- **Notion APIトークン**: スクリプトプロパティ `NOTION_API_KEY`

### 使用プロパティ

| プロパティ名 | 型 | 内容 |
|---|---|---|
| `内容` | title | 投稿タイトル |
| `投稿文` | text | 共通投稿文（フォールバック） |
| `X投稿文` | text | X専用投稿文 |
| `Threads投稿文` | text | Threads専用投稿文 |
| `Instagram投稿文` | text | Instagram専用投稿文 |
| `TikTok投稿文` | text | TikTok専用投稿文 |
| `投稿画像` | file | 共通画像・動画（複数可） |
| ` X画像` | file | X/Threads専用画像（あればこちらを優先）**※先頭にスペースあり** |
| `URL` | url | 誘導先URL |
| `公開日` | date | 投稿予約日時（JST） |
| `buffer` | checkbox | trueなら投稿対象 |
| `進捗` | status | 投稿待ち → 送信済み |
| `Twitter` | select | ×=投稿する / -=しない / o=済み |
| `Instagram` | select | 同上（S=ストーリーズ） |
| `TikTok` | select | 同上 |
| `種類` | multi_select | マンガ判定に使用 |
| `タグ` | multi_select | マンガシリーズ識別（タグ[0]） |
| `話数` | number | マンガ話数 |
| `前話X_URL` | url | 前話のBufferポストURL（X用） |
| `前話Threads_URL` | url | 前話のBufferポストURL（Threads用） |

---

## Buffer API情報

- **エンドポイント**: `https://api.buffer.com/graphql`（GraphQL）
- **旧REST APIは使わない**（認証方式が変わっており401エラーになる）
- **全投稿を `saveToDraft: true` で下書き保存**（人間がBuffer上でレビュー後に公開）

### チャンネルID

```javascript
const BUFFER_CHANNELS = {
  X:         '65828cb230da3c08a72753d4', // アカウント①
  Threads:   '67c121833b85969eaf47871f', // アカウント②
  Instagram: '67c120e83b85969eaf3faa81', // アカウント②
  TikTok:    '67c121083b85969eaf41140f'  // アカウント②
};
```

### スクリプトプロパティ（必須）

| キー | 内容 |
|---|---|
| `NOTION_API_KEY` | Notion APIトークン |
| `BUFFER_API_KEY_1` | BufferアカウントAのAPIキー（X用） |
| `BUFFER_API_KEY_2` | BufferアカウントBのAPIキー（Threads/Instagram/TikTok用） |
| `CLOUDINARY_CLOUD_NAME` | Cloudinaryクラウド名 |
| `CLOUDINARY_API_KEY` | Cloudinary APIキー |
| `CLOUDINARY_API_SECRET` | Cloudinary APIシークレット |

---

## 画像・動画の処理フロー

### X画像プロパティ（`X画像`）

- Notion管理のS3画像のみ対応
- DLしてGoogleドライブの一時フォルダに保存し `lh3.googleusercontent.com/d/{fileId}` URLをBufferに渡す
- **投稿完了後に一時ファイルは自動削除**

### 投稿画像プロパティ（`投稿画像`）

- Notion管理のS3画像 → Driveに一時保存（上記と同様）
- Google DriveのURL（外部リンク）→ **Cloudinaryに動画アップロード**してURLを差し替え

### Cloudinary動画アップロード

```
Drive動画blob → Cloudinary video/upload エンドポイント
→ secure_url（例: https://res.cloudinary.com/xxx/video/upload/xxx.mp4）
→ NotionのプロパティURLをCloudinary URLで更新
→ BufferのassetsにそのURLを渡す
```

**重要**: Cloudinaryアップロード時にNotionをPATCHする → X画像のS3 URLが無効化される  
→ **X画像のDrive保存はCloudinaryアップロード（Notion PATCH）より前に実施すること**

### xMediaの決定ロジック

```javascript
const xMedia = xFiles.length > 0
  ? xMediaFromX                          // X画像プロパティがあればそちらを使用
  : sharedMedia.filter(m => m.type === 'image'); // なければ投稿画像の画像部分のみ（動画は除外）
```

---

## スレッド投稿

投稿文の中に `===` で区切ることでスレッド形式になる。

```
1投稿目のテキスト
===
2投稿目のテキスト
===
3投稿目のテキスト
```

Buffer GraphQLの `metadata.twitter.thread` / `metadata.threads.thread` に配列で渡す。

---

## 漫画自動化

投稿した話の次話ページに `前話X_URL` / `前話Threads_URL` を自動書き込みする。

- `種類` プロパティの multi_select に「マンガ」が含まれる → 漫画として扱う
- `タグ[0]` + `話数+1` で次話ページを検索
- 次話が見つかったら、今回の Buffer ポスト URL をプロパティに書き込む

---

## トリガー設定

- 関数名: `checkAndPublishToBuffer`
- 種別: 時間主導型
- 間隔: 1分ごと

---

## 既知の問題・未解決事項

### ✅ Buffer上で動画プレビューができない（解決済み 2026-04-11）

**原因**: Cloudinaryのeager変換署名に `eager_async: false` を含めていたが署名文字列には含めておらず、401エラーが発生していた。

**解決策**: `eager_async` をペイロードから削除（デフォルトで同期実行のため不要）。eager変換（`ac_aac,f_mp4,vc_h264`）でH.264/AACに変換したURLをBufferに渡すことで動画プレビューも正常表示。

### ✅ X画像の処理順修正（2026-04-11 再修正）

**問題**: 投稿画像プロパティに動画URLがある場合、X画像が投稿されなかった。

**原因**: `uploadDriveVideosToCloudinary` の中でNotionをPATCHしていたため、X画像のS3 URLが無効化される可能性があった。

**修正内容**:
- `convertDriveVideosToCloudinary` にリネームしてNotionPATCHを分離
- Drive→Cloudinary変換のみ行い、Notion PATCHは一切しない
- X画像処理は Cloudinaryアップロード後・Notion PATCH前に確実に実施
- Notion PATCHは最後の `updateNotionPage` で一括して行う（`投稿画像` Cloudinary URLも同時に更新）
- `xMedia` 決定に `xMediaFromX.length > 0` チェックも追加

---

## 解決済みの問題（記録）

| 問題 | 原因 | 解決策 |
|---|---|---|
| Buffer 401エラー | 旧REST APIは新トークン非対応 | GraphQL APIに全面移行 |
| `schedulingType` エラー | `scheduled` は無効値 | `automatic` + `dueAt` を使用 |
| `scheduledAt` フィールドエラー | `CreatePostInput` に存在しない | `dueAt` に変更 |
| `mode` エラー | `queue` は無効値 | `addToQueue` / `customScheduled` を使用 |
| `assets.video` エラー | `AssetsInput` に単数フィールドはない | `videos: [{ url }]` に変更 |
| `shouldShareToFeed` エラー | Instagram metadataで必須 | `shouldShareToFeed: instType === 'post'` を追加 |
| 画像URLをBufferが取得できない | NotionのS3 URLは期限切れになる | Drive経由で `lh3.googleusercontent.com` URLに変換 |
| TikTok/Instagramでエラー | メディアなしでは投稿不可 | メディアなしはスキップ + `console.warn` |
| X/Threadsに動画が投稿された | X画像なし時に投稿画像（動画含む）がフォールバックで使われた | `.filter(m => m.type === 'image')` でフォールバック時は画像のみ使用 |
| X画像がBufferに渡らなかった | Notion PATCH後にS3 URLが無効化された | X画像をNotionPATCH前に処理するよう順序変更 |
| Drive動画URLをBufferが取得できない | BufferはDriveのURLを明示的に拒否 | Cloudinaryにアップロードしてから渡す |
| Buffer上で動画プレビューなし | コーデック/フォーマット非互換 + 署名ミス | eager変換（H.264/AAC MP4）を使用、`eager_async`を署名から除外 |
| X画像が投稿されない | Notionプロパティ名が ` X画像`（先頭スペース）なのに `'X画像'` で参照していた | `getNotionFiles(props, ' X画像')` に修正 |
| Notion PATCH失敗（プロパティなし） | BufferポストIDをNotionに保存しようとした | 保存機能を削除（バッファURLは漫画自動化のみに使用） |

---

## VOOMについて

BufferはLINE VOOMに対応していないため、VOOM投稿はMakeまたは手動で継続。

## Makeシナリオの廃止手順

1. GASの動作が安定したら
2. Makeシナリオ4130484を**オフ**にする（削除はせずオフで残す）
3. 1週間問題なければ削除
