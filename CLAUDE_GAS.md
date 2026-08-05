# SNS投稿文自動生成機能（GAS版）実装仕様

## 概要

NotionのタスクDBに「生成する」チェックボックスを追加し、ONにするとGASが数分以内に検知してClaude APIを呼び出し、各媒体の投稿文を生成してNotionに書き戻す。

Vercel・Makeは不要。GASが全部完結する。

---

## 追加先のGASプロジェクト

**既存の「freee転送くん」と同じGASプロジェクトに追加する。**
- 新しいファイル `sns-generator.gs` を作成して追加するだけでOK
- スクリプトプロパティ（環境変数）も同じプロジェクトを共有

---

## Notionデータベース情報

- **DB URL**: `https://www.notion.so/1734552d5ffb8030a252c62abbb3331a`
- **Data Source ID**: `1734552d-5ffb-8122-a2b3-000b972d08d7`
- **Notion APIトークン**: スクリプトプロパティ `NOTION_API_KEY` に保存済み（ntn_から始まる）

### 追加するプロパティ

NotionのタスクDBに以下のチェックボックスプロパティを追加する（手動で追加）：
- プロパティ名：`生成する`（型：チェックボックス）

### 既存の関連プロパティ

| プロパティ名 | 型 | 用途 |
|---|---|---|
| `内容` | title | 投稿タイトル |
| `投稿文` | text | ぽこさんが書いた共通ベース文 |
| `URL` | url | 誘導先URL |
| `種類` | multi_select | スタンプ/マンガ/etc |
| `VOOM` | select | ×=生成対象 / -=スキップ / o=投稿済み |
| `Twitter` | select | 同上（X） |
| `Instagram` | select | 同上（× or S=ストーリーズ） |
| `TikTok` | select | 同上 |
| `VOOM投稿文` | text | 生成結果の書き込み先 |
| `X投稿文` | text | 生成結果の書き込み先 |
| `Instagram投稿文` | text | 生成結果の書き込み先 |
| `Threads投稿文` | text | 生成結果の書き込み先 |
| `TikTok投稿文` | text | 生成結果の書き込み先 |

### ステータスのロジック

```
生成する = true → 処理対象
× → その媒体の投稿文を生成して書き込む
- → スキップ（空欄のまま）
o → スキップ（投稿済み・触らない）
S → Instagramストーリーズ扱い（生成して書き込む）
```

---

## スクリプトプロパティ（環境変数）

既存プロジェクトのスクリプトプロパティに以下を追加：

```
ANTHROPIC_API_KEY = sk-ant-xxxxx（Claude APIキー）
NOTION_API_KEY = ntn_xxxxx（既存のものを流用）
```

---

## GASの実装

### ファイル名
`sns-generator.gs`

### トリガー設定
- 関数名：`checkAndGenerateSNS`
- トリガー種別：時間主導型
- 間隔：**5分ごと**（または1分ごと）

### 処理フロー

1. Notion APIで「生成する=true」のページを検索
2. 各ページのプロパティを取得
3. `投稿文`（共通ベース文）が空なら処理スキップ
4. 生成対象の媒体（×またはS）を確認
5. Claude APIに投げて投稿文を一括生成（JSON形式）
6. Notionの各投稿文プロパティに書き戻す
7. `生成する`チェックボックスをfalseに戻す

### コード

```javascript
// SNS投稿文自動生成（Claude API使用）
// freee転送くんと同じGASプロジェクトに追加

const NOTION_DB_ID = '1734552d5ffb8122a2b3000b972d08d7';

function checkAndGenerateSNS() {
  const notionKey = PropertiesService.getScriptProperties().getProperty('NOTION_API_KEY');
  const anthropicKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');

  // 「生成する=true」のページを取得
  const queryUrl = `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`;
  const queryPayload = {
    filter: {
      property: '生成する',
      checkbox: { equals: true }
    }
  };

  const queryRes = UrlFetchApp.fetch(queryUrl, {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${notionKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(queryPayload)
  });

  const pages = JSON.parse(queryRes.getContentText()).results;
  if (!pages || pages.length === 0) return;

  pages.forEach(page => {
    try {
      generateSNSForPage(page, notionKey, anthropicKey);
    } catch (e) {
      console.error(`エラー pageId=${page.id}:`, e);
    }
  });
}

function generateSNSForPage(page, notionKey, anthropicKey) {
  const props = page.properties;

  // プロパティ取得
  const 内容 = props['内容']?.title?.[0]?.plain_text ?? '';
  const 投稿文 = props['投稿文']?.rich_text?.[0]?.plain_text ?? '';
  const url = props['URL']?.url ?? '';
  const 種類 = (props['種類']?.multi_select ?? []).map(s => s.name).join(', ');
  const voom = props['VOOM']?.select?.name ?? '-';
  const twitter = props['Twitter']?.select?.name ?? '-';
  const instagram = props['Instagram']?.select?.name ?? '-';
  const tiktok = props['TikTok']?.select?.name ?? '-';

  // 投稿文が空ならスキップ
  if (!投稿文) {
    console.log(`投稿文が空のためスキップ: ${内容}`);
    resetGenerateFlag(page.id, notionKey);
    return;
  }

  // 生成対象の媒体を決定
  const targets = [];
  if (voom === '×') targets.push('VOOM');
  if (twitter === '×') targets.push('X');
  if (twitter === '×') targets.push('Threads'); // XとThreadsは連動
  if (instagram === '×' || instagram === 'S') targets.push('Instagram');
  if (tiktok === '×') targets.push('TikTok');

  if (targets.length === 0) {
    console.log(`生成対象なし: ${内容}`);
    resetGenerateFlag(page.id, notionKey);
    return;
  }

  // Claude API呼び出し
  const prompt = `以下の情報をもとに、指定された媒体の投稿文を生成してください。

【タイトル（内容）】
${内容}

【共通投稿文（ベース）】
${投稿文}

【URL】
${url || 'なし'}

【種類】
${種類 || '未設定'}

【生成対象の媒体】
${targets.join(', ')}

以下のJSON形式のみで返してください（マークダウン不要、前後の説明も不要）：
{
  "VOOM": "VOOM用投稿文（対象外なら空文字）",
  "X": "X用投稿文（対象外なら空文字）",
  "Instagram": "Instagram用投稿文（対象外なら空文字）",
  "Threads": "Threads用投稿文（対象外なら空文字）",
  "TikTok": "TikTok用投稿文（対象外なら空文字）"
}`;

  const claudeRes = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    payload: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system: SNS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const claudeData = JSON.parse(claudeRes.getContentText());
  const responseText = claudeData.content?.[0]?.text ?? '';

  let generated;
  try {
    generated = JSON.parse(responseText);
  } catch (e) {
    console.error('JSONパースエラー:', responseText);
    return;
  }

  // Notionに書き戻す
  const updateProps = {};
  if (generated.VOOM && voom === '×') updateProps['VOOM投稿文'] = { rich_text: [{ text: { content: generated.VOOM } }] };
  if (generated.X && twitter === '×') updateProps['X投稿文'] = { rich_text: [{ text: { content: generated.X } }] };
  if (generated.Instagram && (instagram === '×' || instagram === 'S')) updateProps['Instagram投稿文'] = { rich_text: [{ text: { content: generated.Instagram } }] };
  if (generated.Threads && twitter === '×') updateProps['Threads投稿文'] = { rich_text: [{ text: { content: generated.Threads } }] };
  if (generated.TikTok && tiktok === '×') updateProps['TikTok投稿文'] = { rich_text: [{ text: { content: generated.TikTok } }] };

  // 「生成する」をfalseに戻す
  updateProps['生成する'] = { checkbox: false };

  UrlFetchApp.fetch(`https://api.notion.com/v1/pages/${page.id}`, {
    method: 'patch',
    headers: {
      'Authorization': `Bearer ${notionKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({ properties: updateProps })
  });

  console.log(`生成完了: ${内容} → ${targets.join(', ')}`);
}

function resetGenerateFlag(pageId, notionKey) {
  UrlFetchApp.fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'patch',
    headers: {
      'Authorization': `Bearer ${notionKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({
      properties: { '生成する': { checkbox: false } }
    })
  });
}

// SNSルール（システムプロンプト）
const SNS_SYSTEM_PROMPT = `あなたは「ぽぽち」ブランドのSNS投稿文を生成するアシスタントです。
ポメラニアンキャラクター「ぽぽち」「ぱぴち」のブランドオーナーが運営するアカウントの投稿文を生成します。

## 共通ルール（全媒体）
- 一人称は使わない（ぽぽちが主語）
- 押し売り感ゼロ。日常の延長として自然に紹介する
- 季節感を大切にする
- 絵文字は使いすぎない（1投稿あたり2〜3個まで）
- ぽぽちの顔文字：꒰ ՞•ﻌ•՞ ꒱ ꒰ ՞•ﻌ•՞ ꒱ฅ
- セールス感を出さない
- 共通の投稿文をベースに、各媒体のルールに合わせてアレンジする
- 共通文のニュアンスや伝えたいメッセージを必ず守る
- 改行は適切に入れて読みやすくする。顔文字・絵文字・CTAの前には必ず改行を入れる

## キャラクター名・ハッシュタグの表記
- キャラクター名はすべてひらがな：「ぽぽち」「ぱぴち」
- ハッシュタグも同様：#ぽぽち #ぱぴち（カタカナ・混在は不可）

## 重要：共通投稿文の扱い
- 共通投稿文のニュアンスと伝えたいメッセージを必ず守る
- 共通投稿文にない言葉（「最新話」「新着」「限定」など）を勝手に追加しない
- 共通投稿文をベースに媒体ルールに合わせてアレンジするだけでよい

## ツリー投稿のルール（X・Threadsのみ）
URLが絡む投稿（マンガ更新・スタンプ告知など）は「===」で区切ってツリー形式にする。

### マンガ（ぽぽち絵日記・ぽぽちびより）の場合
必ず以下の3ブロック構成で出力すること：
\`\`\`
１投稿目：投稿文（共通文ベース）
===
前のお話はこちら
===
これまでのお話が一気読みできるよ📚
（URLはシリーズで出し分け：ぽぽち絵日記→https://popochi.jp/comic/enikki / ぽぽちびより→https://popochi.jp/comic/popochi-biyori）
\`\`\`
- 2投稿目は「前のお話はこちら」という文言のみ。URLは手動入力するため出力しない
- 3投稿目のURLはシリーズで出し分ける：
  - ぽぽち絵日記 → https://popochi.jp/comic/enikki
  - ぽぽちびより → https://popochi.jp/comic/popochi-biyori
- シリーズはタイトル（内容）または種類プロパティから判断する

### LINEスタンプ告知・その他URLが絡む投稿の場合
\`\`\`
１投稿目：投稿文（共通文ベース）
===
URLプロパティのURL＋短い誘導コピー
\`\`\`

### ツリーの注意点
- SNSに載せるマンガは最新話。「続きはこちら」ではなく「これまでのお話が読める」という案内にする
- 3ブロックすべて出力すること（2投稿目を省略しない）
- VOOM・Instagram・TikTokはツリー形式にしない（通常の投稿文のみ）

## 媒体別ルール

### X（Twitter）
- トーン：短く、直球
- リンク：本文にURL直貼りOK
- ハッシュタグ：基本なし
- URLが絡む投稿はツリー形式（===で区切る）

### Threads
- トーン：会話的、ゆるい。問いかけ要素を入れるとアルゴリズムに有利
- リンク：直貼りOK
- ハッシュタグ：基本なし
- URLが絡む投稿はツリー形式（===で区切る）
- X（Twitter）と異なる文章にすること。同じになるなら空文字で返す（Xだけで十分）

### Instagram
- トーン：丁寧だけど温かい
- リンク：プロフィールURL誘導のみ（本文にURL直貼り不可）
- ハッシュタグ：10〜15個（日本語＋英語ミックス）
- CTA例：▶ LINEスタンプはプロフのリンクから ꒰ ՞•ﻌ•՞ ꒱✨
- マンガ投稿のハッシュタグルール：
  - 作品タグはタイトルのすぐ後に独立して配置する
  - 作品タグは投稿する作品のものだけを使う（混在厳禁）
    - ぽぽち絵日記の投稿 → #ぽぽち絵日記 のみ（#ぽぽちびより は使わない）
    - ぽぽちびよりの投稿 → #ぽぽちびより のみ（#ぽぽち絵日記 は使わない）
  - その後に空行を入れて本文を続ける
  - 本文の末尾に「他のお話は #ぽぽち絵日記 で読めるよ」など作品に合った一文を入れる（プロフリンク誘導は不要）
  - 最後に一般ハッシュタグをまとめて並べる
  - 例（ぽぽち絵日記の場合）：
    『タイトル』
    #ぽぽち絵日記

    本文…
    他のお話は #ぽぽち絵日記 で読めるよ꒰ ՞•ﻌ•՞ ꒱

    #ぽぽち #ポメラニアン ...

### LINE VOOM
- トーン：友だちに話しかけるようなゆるさ。長めOK
- 顔文字：꒰ ՞•ﻌ•՞ ꒱ を積極的に使う
- リンク：本文にURL直貼りOK
- ハッシュタグ：基本なし
- CTA例：👇スタンプはこちら ＋URL

### TikTok
- トーン：最短
- リンク：プロフィールURLのみ（本文にURL直貼り不可）
- ハッシュタグ：3〜5個
- マンガ更新の場合：過去の投稿で読めるためCTA不要。本文のみで完結させる
- スタンプ告知・その他の場合：CTA必須。例）スタンプはプロフのリンクからチェックしてね🐾

## 出力形式
- JSONのみ返す（前後の説明文・マークダウン不要）
- 対象外の媒体は空文字列で返す
- 改行は実際の\\nで表現
- ツリー投稿の区切りは===（前後に空行は入れない、改行1つで区切るだけ）`;
```

---

## セットアップ手順（Claude Codeへの指示）

1. 既存のfreee転送くんGASプロジェクトを開く
2. 新しいファイル `sns-generator.gs` を作成して上記コードを貼り付ける
3. スクリプトプロパティに `ANTHROPIC_API_KEY` を追加する
4. `checkAndGenerateSNS` 関数を一度手動実行して動作確認
5. トリガーを設定：時間主導型 → 5分ごと

---

## Notionの手動作業（Claude Codeではなく手動で行う）

1. タスクDB（SNS更新LIST）を開く
2. プロパティの追加 → 「チェックボックス」を選択
3. 名前：`生成する`

---

## 使い方（完成後）

1. Notionのタスクページを開く
2. `投稿文`（共通）を記入する
3. 各媒体のステータスを `×` に設定する
4. `生成する` チェックボックスをONにする
5. 5分以内にGASが動いて各媒体の投稿文が自動入力される
6. 気に入らなければ手動で編集
7. `buffer` チェックをON → Makeが予約投稿

---

## 注意点

- `投稿文`（共通ベース文）が空の場合はスキップされる
- Threadsは独立したステータスプロパティがないため、Xと連動（Twitter=×のとき生成）
- GASのタイムアウトは6分なので、1回の実行で複数ページあっても余裕
- エラーはGASの実行ログで確認できる