# SNS投稿文自動生成機能 実装仕様

## 概要

NotionのタスクDB内のページに「SNS文生成」ボタンを追加し、押すとVercel Serverless FunctionがClaude APIを呼び出して各媒体の投稿文を生成、Notionに書き戻す機能を実装する。

---

## プロジェクト構成

**新規Vercelプロジェクト**として作成する（もふもふエスケープとは別プロジェクト）。
- リポジトリ名例：`popochi-notion-tools`
- Vercel Pro契約済みのため追加コストなし
- シンプルなNext.js App Router構成でOK（または素のNode.js + Vercel Functions）
- 将来的にfreee仕訳補助など他のNotion連携機能も同じプロジェクトに追加できる

---

## Notionデータベース情報

- **DB URL**: `https://www.notion.so/1734552d5ffb8030a252c62abbb3331a`
- **Data Source ID**: `1734552d-5ffb-8122-a2b3-000b972d08d7`

### 関連プロパティ一覧

| プロパティ名 | 型 | 用途 |
|---|---|---|
| `内容` | title | 投稿タイトル（Claude APIへの参考情報） |
| `投稿文` | text | ぽこさんが書いた共通ベース文（必須・必ず存在する） |
| `URL` | url | 誘導先URL（`userDefined:URL`） |
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
× → 生成して書き込む
- → スキップ（空欄のまま）
o → スキップ（投稿済み・触らない）
S → Instagramストーリーズ扱い（生成して書き込む）
```

---

## Notionボタンの設定

NotionのDBに「SNS文生成」というボタンプロパティを追加し、以下のWebhookを設定する：

- **URL**: `https://<your-vercel-domain>/api/generate-sns`
- **Method**: POST
- **Body**: Notionが自動送信するページIDが含まれる

Notionのボタン（Button property）がPOSTするbodyは以下の形式：
```json
{
  "data": {
    "id": "ページのUUID（ハイフンなし or あり）"
  }
}
```

---

## Vercel API Route実装

### ファイルパス
```
/api/generate-sns.ts
```

### 処理フロー

1. POSTリクエストを受け取り、bodyからNotion page IDを取得
2. Notion APIでそのページのプロパティを取得
3. 各媒体のステータスを確認（`×` or `S` のものだけ生成対象）
4. `投稿文`（共通ベース文）が空なら400エラーを返す
5. Claude APIを呼び出し、生成対象の媒体分の投稿文を一括生成（JSON形式で返させる）
6. Notion APIで各プロパティに書き込む

### 環境変数

```
NOTION_API_KEY=（Notion Integration Token）
ANTHROPIC_API_KEY=（Claude APIキー）
```

### コード例

```typescript
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const body = await req.json();
  
  // Notionボタンが送るpage IDを取得
  const pageId = body?.data?.id || body?.page_id;
  if (!pageId) return NextResponse.json({ error: 'page_id missing' }, { status: 400 });

  // Notionページのプロパティ取得
  const page = await notion.pages.retrieve({ page_id: pageId }) as any;
  const props = page.properties;

  // 各値の取得
  const 内容 = props['内容']?.title?.[0]?.plain_text ?? '';
  const 投稿文 = props['投稿文']?.rich_text?.[0]?.plain_text ?? '';
  const url = props['URL']?.url ?? '';
  const 種類 = props['種類']?.multi_select?.map((s: any) => s.name).join(', ') ?? '';
  const voom = props['VOOM']?.select?.name ?? '-';
  const twitter = props['Twitter']?.select?.name ?? '-';
  const instagram = props['Instagram']?.select?.name ?? '-';
  const tiktok = props['TikTok']?.select?.name ?? '-';

  if (!投稿文) {
    return NextResponse.json({ error: '投稿文が空です' }, { status: 400 });
  }

  // 生成対象の媒体を決定
  const targets: string[] = [];
  if (voom === '×') targets.push('VOOM');
  if (twitter === '×') targets.push('X');
  if (instagram === '×' || instagram === 'S') targets.push('Instagram');
  // Threadsは独立したステータスプロパティがないため、Xと同じ場合に生成
  // ※必要に応じてThreadsプロパティを別途追加することを推奨
  if (twitter === '×') targets.push('Threads');
  if (tiktok === '×') targets.push('TikTok');

  if (targets.length === 0) {
    return NextResponse.json({ message: '生成対象の媒体がありません' });
  }

  // Claude API呼び出し
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    system: SNS_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `以下の情報をもとに、指定された媒体の投稿文を生成してください。

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

以下のJSON形式のみで返してください（マークダウン不要）：
{
  "VOOM": "VOOM用投稿文（対象外なら空文字）",
  "X": "X用投稿文（対象外なら空文字）",
  "Instagram": "Instagram用投稿文（対象外なら空文字）",
  "Threads": "Threads用投稿文（対象外なら空文字）",
  "TikTok": "TikTok用投稿文（対象外なら空文字）"
}`
    }]
  });

  // レスポンスのJSONパース
  const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
  const generated = JSON.parse(responseText);

  // Notionへの書き戻し
  const updateProps: any = {};
  if (generated.VOOM && voom === '×') updateProps['VOOM投稿文'] = { rich_text: [{ text: { content: generated.VOOM } }] };
  if (generated.X && twitter === '×') updateProps['X投稿文'] = { rich_text: [{ text: { content: generated.X } }] };
  if (generated.Instagram && (instagram === '×' || instagram === 'S')) updateProps['Instagram投稿文'] = { rich_text: [{ text: { content: generated.Instagram } }] };
  if (generated.Threads && twitter === '×') updateProps['Threads投稿文'] = { rich_text: [{ text: { content: generated.Threads } }] };
  if (generated.TikTok && tiktok === '×') updateProps['TikTok投稿文'] = { rich_text: [{ text: { content: generated.TikTok } }] };

  await notion.pages.update({ page_id: pageId, properties: updateProps });

  return NextResponse.json({ success: true, generated });
}
```

---

## システムプロンプト（SNS_SYSTEM_PROMPT）

以下をそのまま定数として実装に組み込む：

```typescript
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

## 媒体別ルール

### X（Twitter）
- トーン：短く、直球
- リンク：本文にURL直貼りOK
- ハッシュタグ：基本なし
- CTA例：▼ LINEスタンプはこちら ＋URL

### Threads
- トーン：会話的、ゆるい。問いかけ要素を入れるとアルゴリズムに有利
- リンク：直貼りOK
- ハッシュタグ：基本なし
- 共感・ファン化を意識

### Instagram
- トーン：丁寧だけど温かい
- リンク：プロフィールURL誘導のみ（本文にURL直貼り不可）
- ハッシュタグ：10〜15個（日本語＋英語ミックス）
- CTA例：▶ LINEスタンプはプロフのリンクから ꒰ ՞•ﻌ•՞ ꒱✨

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
- CTA例：スタンプはプロフのリンクからチェックしてね🐾

## 書式ルール
- 改行は実際の改行（\\n）で表現
- URLはそのまま記載
- 対象外の媒体は空文字列で返す
- JSONのみ返す（前後の説明文・マークダウン不要）`;
```

---

## Notionボタン追加手順（Claude Codeではなく手動で行う）

1. タスクDB（SNS更新LIST）を開く
2. プロパティの追加 → 「ボタン」を選択
3. ボタン名：「SNS文生成」
4. アクション：「Webhook送信」
5. URL：`https://<デプロイ後のVercelドメイン>/api/generate-sns`

---

## 実装上の注意点

- Notionボタンから来るリクエストのbody形式は事前に `console.log` で確認すること（形式が変わる可能性あり）
- `@notionhq/client` と `@anthropic-ai/sdk` が未インストールなら `npm install` する
- Vercel環境変数に `NOTION_API_KEY` と `ANTHROPIC_API_KEY` を追加する
- NotionのIntegrationがタスクDBに接続されていることを確認する
- Threadsの独立したステータスプロパティがDB上に存在しないため、現状はXと連動。必要なら `Threads` プロパティをDBに追加する

---

## 完成イメージ

1. Notionのタスクページを開く
2. `投稿文`（共通）を記入
3. 各媒体のステータスを `×` に設定
4. 「SNS文生成」ボタンを押す
5. 数秒後に各媒体の投稿文プロパティが自動入力される
6. 気に入らなければ手動で編集
7. `buffer` チェックをON → Makeが予約投稿