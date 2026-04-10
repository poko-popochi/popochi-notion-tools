import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log('Received body:', JSON.stringify(body));

    // Notionボタンが送るpage IDを取得
    const pageId: string = body?.data?.id || body?.page_id;
    if (!pageId) {
      return NextResponse.json({ error: 'page_id missing' }, { status: 400 });
    }

    // Notionページのプロパティ取得
    const page = await notion.pages.retrieve({ page_id: pageId }) as any;
    const props = page.properties;

    // 各値の取得
    const 内容: string = props['内容']?.title?.[0]?.plain_text ?? '';
    const 投稿文: string = props['投稿文']?.rich_text?.[0]?.plain_text ?? '';
    const url: string = props['URL']?.url ?? '';
    const 種類: string = props['種類']?.multi_select?.map((s: any) => s.name).join(', ') ?? '';
    const voom: string = props['VOOM']?.select?.name ?? '-';
    const twitter: string = props['Twitter']?.select?.name ?? '-';
    const instagram: string = props['Instagram']?.select?.name ?? '-';
    const tiktok: string = props['TikTok']?.select?.name ?? '-';

    if (!投稿文) {
      return NextResponse.json({ error: '投稿文が空です' }, { status: 400 });
    }

    // 生成対象の媒体を決定（× or S のみ）
    const targets: string[] = [];
    if (voom === '×') targets.push('VOOM');
    if (twitter === '×') targets.push('X');
    if (instagram === '×' || instagram === 'S') targets.push('Instagram');
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
    console.log('Claude response:', responseText);

    // JSON部分だけ抽出（念のため）
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Claude APIのレスポンスが不正です', raw: responseText }, { status: 500 });
    }
    const generated = JSON.parse(jsonMatch[0]);

    // Notionへの書き戻し
    const updateProps: Record<string, any> = {};
    if (generated.VOOM && voom === '×') {
      updateProps['VOOM投稿文'] = { rich_text: [{ text: { content: generated.VOOM } }] };
    }
    if (generated.X && twitter === '×') {
      updateProps['X投稿文'] = { rich_text: [{ text: { content: generated.X } }] };
    }
    if (generated.Instagram && (instagram === '×' || instagram === 'S')) {
      updateProps['Instagram投稿文'] = { rich_text: [{ text: { content: generated.Instagram } }] };
    }
    if (generated.Threads && twitter === '×') {
      updateProps['Threads投稿文'] = { rich_text: [{ text: { content: generated.Threads } }] };
    }
    if (generated.TikTok && tiktok === '×') {
      updateProps['TikTok投稿文'] = { rich_text: [{ text: { content: generated.TikTok } }] };
    }

    await notion.pages.update({ page_id: pageId, properties: updateProps });

    return NextResponse.json({ success: true, generated });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
