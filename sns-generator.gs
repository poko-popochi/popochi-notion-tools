// SNS投稿文自動生成（Claude API使用）
// freee転送くんと同じGASプロジェクトに追加

const NOTION_DB_ID = '1734552d5ffb8030a252c62abbb3331a';

// SNSルール（システムプロンプト）
const SNS_SYSTEM_PROMPT = `あなたは「ぽぽち」ブランドのSNS投稿文を生成するアシスタントです。
ポメラニアンキャラクター「ぽぽち」「ぱぴち」のブランドオーナーが運営するアカウントの投稿文を生成します。

## 共通ルール（全媒体)
- 一人称は使わない（ぽぽちが主語）
- 押し売り感ゼロ。日常の延長として自然に紹介する
- 季節感を大切にする
- 絵文字は使いすぎない（1投稿あたり2〜3個まで）
- ぽぽちの顔文字：꒰ ՞•ﻌ•՞ ꒱ ꒰ ՞•ﻌ•՞ ꒱ฅ
- セールス感を出さない
- 共通の投稿文をベースに、各媒体のルールに合わせてアレンジする
- 共通文のニュアンスや伝えたいメッセージを必ず守る
- 改行は適切に入れて読みやすくする。顔文字・絵文字・CTAの前には必ず改行を入れる
- 使用する文字は日本語（ひらがな・カタカナ・常用漢字）のみ。中国語の漢字・読めない漢字は絶対に使用しない
- フォロワーを「子」と呼ぶのは禁止。「迷っている方」「気になっている方」のように「方」を使う

## キャラクター名・ハッシュタグの表記
- キャラクター名はすべてひらがな：「ぽぽち」「ぱぴち」
- ハッシュタグも同様：#ぽぽち #ぱぴち（カタカナ・混在は不可）

## 重要：共通投稿文の扱い
- 共通投稿文のニュアンスと伝えたいメッセージを必ず守る
- 共通投稿文にない言葉（「最新話」「新着」「限定」など）を勝手に追加しない
- 共通投稿文をベースに媒体ルールに合わせてアレンジするだけでよい
- **話数・タイトル・固有名詞・数字は共通投稿文から正確にそのまま使うこと。推測・変更・省略は絶対にしない**
  - 例：共通文が「第15話」なら生成文も「第15話」。「16話」など勝手に変えてはいけない

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

### クイズ（間違い探し）の場合
種類「クイズ」かつタグ「間違い探し」のとき、X・Threadsは必ず以下の3ブロック構成で出力すること：
\`\`\`
１投稿目：投稿文（共通文ベース）
===
ヒント꒰ ՞•ﻌ•՞ ꒱
===
答えはこちら！ ꒰ ՞•ﻌ•՞ ꒱
全問正解の方おめでとうございますっ🎉
\`\`\`
- 1投稿目のみ共通文をベースに生成する（問題への導入・楽しんでもらう雰囲気）
- 2投稿目は「ヒント꒰ ՞•ﻌ•՞ ꒱」固定（それ以外の文は追加しない）
- 3投稿目は「答えはこちら！ ꒰ ՞•ﻌ•՞ ꒱\n全問正解の方おめでとうございますっ🎉」固定（改行含む）
- Instagram・TikTokはカルーセル投稿のため通常の投稿文のみ（ツリーなし）

### URLがある投稿（マンガ・クイズ以外）
**URLプロパティにURLがある場合、X・Threadsは例外なく必ず以下の2ブロック構成にすること。本文にURLを直接含めてはいけない。**
\`\`\`
１投稿目：投稿文（共通文ベース・URLなし）
===
短い誘導コピー（CTA）\nURLプロパティのURL
\`\`\`
- 誘導コピーは内容に合わせて自然な一文にする（例：「スタンプはこちら🐾」「詳しくはこちら꒰ ՞•ﻌ•՞ ꒱」など）
- URLは必ず2投稿目に置く。1投稿目には絶対に含めない

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
- トーン：友だちに話しかけるような自然なフレンドリーさ。日常会話の延長で、ゆるく温かく
- 質問形式（〜ませんか？〜でしょうか？）は使わない。共感や気づきを誘う自然な一言でよい
- リンク：直貼りOK
- ハッシュタグ：基本なし
- URLが絡む投稿はツリー形式（===で区切る）← これはXと同様に必ず適用すること
- 基本的にX（Twitter）と同じ投稿文でよい。明確に変える理由（トーンが合わないなど）がある場合のみ変更する

### Instagram（通常投稿）
- トーン：丁寧だけど温かい
- リンク：プロフィールURL誘導のみ（本文にURL直貼り不可）
- ハッシュタグ：5個まで（日本語＋英語ミックス）
- CTA例：▶ LINEスタンプはプロフのリンクから ꒰ ՞•ﻌ•՞ ꒱✨

### InstagramStory（ストーリーズ）
- トーン：一言・超短め。画像に添えるキャプション程度
- 本文：1〜2文以内。シンプルに内容を伝えるだけでよい
- ハッシュタグ：なし
- CTA：不要（ストーリーズはリンクスタンプで誘導するため）
- 例：「ぽぽちの春スタンプ、配信スタート꒰ ՞•ﻌ•՞ ꒱✨」
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
- ツリー投稿の区切りは===（前後に空白行を絶対に入れない。直前・直後は改行1つのみ）
  - 正しい例：投稿文\n===\n2投稿目
  - 誤った例：投稿文\n\n===\n\n2投稿目`;

// -------------------------------------------------------
// 一時的エラー(429/500/502/503/504/ネットワーク)を指数バックオフでリトライするfetchラッパー
// - 成功(2xx)           → HTTPResponse を返す
// - 一時的エラーが継続  → null を返す（呼び出し側で早期returnする・通知メールは飛ばない）
// - 永続的エラー(4xx等) → HTTPResponse を返す（呼び出し側でステータスチェックしてthrowする）
// -------------------------------------------------------
function fetchWithRetry_(url, options, label) {
  const opts = Object.assign({}, options, { muteHttpExceptions: true });
  const transientCodes = [429, 500, 502, 503, 504];
  const maxRetries = 4; // 初回 + 3リトライ

  for (let i = 0; i < maxRetries; i++) {
    let res;
    try {
      res = UrlFetchApp.fetch(url, opts);
    } catch (e) {
      // DNS失敗等のネットワークレイヤーエラー
      if (i < maxRetries - 1) {
        Utilities.sleep(Math.pow(2, i) * 1000 + Math.floor(Math.random() * 500));
        continue;
      }
      console.warn(`[${label || url}] ネットワークエラー継続のためスキップ: ${e.message}`);
      return null;
    }

    const code = res.getResponseCode();
    if (code >= 200 && code < 300) return res;

    if (transientCodes.indexOf(code) >= 0) {
      if (i < maxRetries - 1) {
        const backoff = Math.pow(2, i) * 1000 + Math.floor(Math.random() * 500); // 1s, 2s, 4s + jitter
        console.log(`[${label || url}] ${code} → ${backoff}ms後リトライ (${i + 1}/${maxRetries - 1})`);
        Utilities.sleep(backoff);
        continue;
      }
      console.warn(`[${label || url}] ${code} 継続のため今回はスキップ（次回トリガーに任せる）`);
      return null;
    }

    // 永続的エラー(400/401/403/404等) → 呼び出し側でハンドリング
    return res;
  }
  return null;
}

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

  const queryRes = fetchWithRetry_(queryUrl, {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${notionKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(queryPayload)
  }, 'Notion DB query');

  if (!queryRes) return; // 一時的エラー → 次回トリガーへ
  if (queryRes.getResponseCode() !== 200) {
    throw new Error(`Notion DB query失敗: ${queryRes.getContentText()}`);
  }

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

// -------------------------------------------------------
// 投稿画像（動画は表紙コマ）を Claude API の image ブロックに変換（最大4枚）
// - サムネ欄を最優先（動画の表紙用）→ 続いて投稿画像
// - 画像ファイル → そのまま base64
// - Cloudinary動画 → 最初のフレームを .jpg で取得
// - Drive動画などフレームが取れないものはスキップ（生成は画像なしでも続行）
// -------------------------------------------------------
function buildImageBlocks_(props) {
  const blocks = [];
  const files = [];
  (props['サムネ']?.files ?? []).forEach(f => files.push(f));
  (props['投稿画像']?.files ?? []).forEach(f => files.push(f));
  for (const f of files) {
    if (blocks.length >= 4) break;
    let url = f?.file?.url ?? f?.external?.url ?? '';
    if (!url) continue;
    const hay = (f?.name ?? '') + ' ' + url;
    const isImage = /\.(jpe?g|png|gif|webp)(\?|$)/i.test(hay);
    const isVideo = !isImage && (/\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i.test(hay) || /drive\.google\.com/i.test(url) || /res\.cloudinary\.com\/.+\/video\//i.test(url));
    if (isVideo) {
      if (/res\.cloudinary\.com\/.+\/video\//.test(url)) {
        // Cloudinary動画 → 最初のフレームjpg（codec transformは除去）
        url = url.replace(/\/video\/upload\/(?:[^/]+\/)?(v\d+\/)/, '/video/upload/so_0,w_1080/$1')
                 .replace(/\.(mp4|mov|webm|m4v|avi|mkv)(\?.*)?$/i, '.jpg');
      } else {
        continue; // Drive動画等はフレーム取得不可 → サムネ欄に表紙画像を入れれば拾える
      }
    }
    try {
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) continue;
      const blob = res.getBlob();
      const bytes = blob.getBytes();
      if (bytes.length > 4.5 * 1024 * 1024) continue; // Claudeの5MB/枚制限を回避
      const mime = String(blob.getContentType() || 'image/jpeg').split(';')[0];
      if (!/^image\/(jpeg|png|gif|webp)$/.test(mime)) continue;
      blocks.push({ type: 'image', source: { type: 'base64', media_type: mime, data: Utilities.base64Encode(bytes) } });
    } catch (e) {
      console.warn(`画像取得スキップ: ${f?.name ?? url} (${e.message})`);
    }
  }
  return blocks;
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
  if (instagram === '×') targets.push('Instagram');
  if (instagram === 'S') targets.push('InstagramStory');
  if (tiktok === '×') targets.push('TikTok');

  if (targets.length === 0) {
    console.log(`生成対象なし: ${内容}`);
    resetGenerateFlag(page.id, notionKey);
    return;
  }

  // 投稿画像（動画は表紙コマ）を取得してAIに見せる（的外れ生成の防止）
  const imageBlocks = buildImageBlocks_(props);

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

${url ? `【重要】URLがあります（${url}）。X・Threadsは必ず以下の形式にすること：
1投稿目（本文のみ・URLなし）\n===\nCTA文\nURL
===を省略した場合は生成失敗とみなします。` : ''}

${imageBlocks.length ? `【添付画像】この投稿に実際に使う画像を${imageBlocks.length}枚添付しています（動画投稿の場合は表紙のコマ）。画像の内容（何が描かれているか・オチ・雰囲気）を読み取り、内容に即した投稿文にしてください。ただし共通投稿文のメッセージ・話数・固有名詞が最優先です（画像から推測した内容で上書きしない）。` : ''}

以下のJSON形式のみで返してください（マークダウン不要、前後の説明も不要）：
{
  "VOOM": "VOOM用投稿文（対象外なら空文字）",
  "X": "X用投稿文（対象外なら空文字）",
  "Instagram": "Instagram通常投稿用（対象外なら空文字）",
  "InstagramStory": "Instagramストーリーズ用・超短め（対象外なら空文字）",
  "Threads": "Threads用投稿文（対象外なら空文字）",
  "TikTok": "TikTok用投稿文（対象外なら空文字）"
}`;

  const claudeRes = fetchWithRetry_('https://api.anthropic.com/v1/messages', {
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
      // 画像があれば「画像ブロック＋テキスト」で渡す（マンガ/イラスト/動画表紙を見た上で生成）
      messages: [{ role: 'user', content: imageBlocks.length ? imageBlocks.concat([{ type: 'text', text: prompt }]) : prompt }]
    })
  }, 'Anthropic API');

  if (!claudeRes) return; // 一時的エラー → 次回トリガーへ
  if (claudeRes.getResponseCode() !== 200) {
    throw new Error(`Claude APIエラー: ${claudeRes.getContentText()}`);
  }

  const claudeData = JSON.parse(claudeRes.getContentText());
  const responseText = claudeData.content?.[0]?.text ?? '';

  let generated;
  try {
    const jsonText = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    generated = JSON.parse(jsonText);
  } catch (e) {
    console.error('JSONパースエラー:', responseText);
    return;
  }

  // XとThreadsが同じ内容なら Threads は空にする（buffer-publisher側でXにフォールバックするため不要）
  if (generated.Threads && generated.X && generated.Threads === generated.X) {
    console.log(`Threads投稿文がXと同一のためスキップ: ${内容}`);
    generated.Threads = '';
  }

  // Notionに書き戻す
  const updateProps = {};
  if (generated.VOOM && voom === '×') updateProps['VOOM投稿文'] = { rich_text: [{ text: { content: generated.VOOM } }] };
  if (generated.X && twitter === '×') updateProps['X投稿文'] = { rich_text: [{ text: { content: generated.X } }] };
  if (generated.Instagram && instagram === '×') updateProps['Instagram投稿文'] = { rich_text: [{ text: { content: generated.Instagram } }] };
  if (generated.InstagramStory && instagram === 'S') updateProps['Instagram投稿文'] = { rich_text: [{ text: { content: generated.InstagramStory } }] };
  if (generated.Threads && twitter === '×') updateProps['Threads投稿文'] = { rich_text: [{ text: { content: generated.Threads } }] };
  if (generated.TikTok && tiktok === '×') updateProps['TikTok投稿文'] = { rich_text: [{ text: { content: generated.TikTok } }] };

  // 「生成する」をfalseに戻す
  updateProps['生成する'] = { checkbox: false };

  const patchRes = fetchWithRetry_(`https://api.notion.com/v1/pages/${page.id}`, {
    method: 'patch',
    headers: {
      'Authorization': `Bearer ${notionKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({ properties: updateProps })
  }, 'Notion PATCH (generated)');

  if (!patchRes) {
    console.warn(`Notion書き戻し失敗(一時的) pageId=${page.id} → 次回再生成`);
    return; // 「生成する=true」のまま残るので次回トリガーで再試行
  }
  if (patchRes.getResponseCode() !== 200) {
    throw new Error(`Notion PATCH失敗 pageId=${page.id}: ${patchRes.getContentText()}`);
  }

  console.log(`生成完了: ${内容} → ${targets.join(', ')}`);
}

function resetGenerateFlag(pageId, notionKey) {
  const res = fetchWithRetry_(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'patch',
    headers: {
      'Authorization': `Bearer ${notionKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({
      properties: { '生成する': { checkbox: false } }
    })
  }, 'Notion PATCH (reset flag)');

  if (!res) {
    console.warn(`生成フラグリセット失敗(一時的) pageId=${pageId}`);
    return;
  }
  if (res.getResponseCode() !== 200) {
    throw new Error(`生成フラグリセット失敗 pageId=${pageId}: ${res.getContentText()}`);
  }
}