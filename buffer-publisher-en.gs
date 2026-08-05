// Buffer投稿予約（英語版：Notion英語DB → Buffer EN アカウント）
// 既存 buffer-publisher.gs と同じGASプロジェクトに置く（getRichText / getSelect / getNotionFiles /
// jstToUtc / convertDriveVideosToCloudinary / processNotionFiles / postToBuffer / patchNotionProperties を流用）。
//
// 動作：英語DB(びより/絵日記)で buffer=true かつ 進捗=投稿待ち のページを、
//   IGキャプション=「キャプション(EN)」／Threadsキャプション=「Threadsキャプション(EN)」(空ならIG流用)
//   で Buffer に下書き(saveToDraft)送信。送信後 buffer=false にして再送防止。
//   ※進捗や媒体ステータスは変えない（Buffer上で公開レビュー後、ぽこ/くれあが投稿済みに更新）。

// 英語DB（2022-06-28の databases/{id}/query 用 database_id）
const EN_BUFFER_DBS = [
  'b99859e72f9e424f9c7ecc343a8af25c', // ぽぽちびより英語リスト
  'a83710605b2b4d7d96cf6568079ce49b'  // ぽぽち絵日記 (EN) リスト
];

// 英語アカウント(poko.popochi.en)のBufferチャンネル
const EN_BUFFER_CHANNELS = {
  Instagram: '6a433e7c5ab6d2f106889c40',
  Threads:   '6a4340495ab6d2f10688a8e3'
};

// -------------------------------------------------------
// 初回セットアップ：このファイルを入れたら GASエディタで一度だけ実行する。
// checkAndPublishToBufferEN を15分ごとに動かす時間主導トリガーを作る（重複は作らない）。
// ※ 事前にスクリプトプロパティ BUFFER_API_KEY_EN（英語BufferのAPIキー）を設定しておくこと。
// -------------------------------------------------------
function setupBufferENTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'checkAndPublishToBufferEN')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkAndPublishToBufferEN').timeBased().everyMinutes(15).create();
  console.log('英語Buffer用トリガーを設定しました（15分ごと）');
}

// -------------------------------------------------------
// メイン関数（トリガーで定期実行：15分ごと）
// -------------------------------------------------------
function checkAndPublishToBufferEN() {
  const scriptProps = PropertiesService.getScriptProperties();
  const notionKey   = scriptProps.getProperty('NOTION_API_KEY');
  const bufferKeyEN = scriptProps.getProperty('BUFFER_API_KEY_EN'); // 英語アカウント用

  if (!notionKey || !bufferKeyEN) {
    console.error('スクリプトプロパティが未設定です（NOTION_API_KEY / BUFFER_API_KEY_EN）');
    return;
  }

  EN_BUFFER_DBS.forEach(dbId => {
    const pages = queryEnReadyPages(dbId, notionKey);
    if (pages.length === 0) return;
    console.log(`[EN] db=${dbId} 投稿待ち=${pages.length}件`);
    pages.forEach(page => {
      try {
        publishPageEN(page, notionKey, bufferKeyEN);
      } catch (e) {
        console.error(`[EN] エラー pageId=${page.id}: ${e.message}`);
      }
    });
  });
}

function queryEnReadyPages(dbId, notionKey) {
  const res = UrlFetchApp.fetch(
    `https://api.notion.com/v1/databases/${dbId}/query`,
    {
      method: 'post',
      headers: {
        'Authorization':  `Bearer ${notionKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type':   'application/json'
      },
      payload: JSON.stringify({
        filter: {
          and: [
            { property: 'buffer', checkbox: { equals: true } },
            { property: '進捗',   select:   { equals: '投稿待ち' } } // ★英語の進捗はselect型
          ]
        }
      }),
      muteHttpExceptions: true
    }
  );
  if (res.getResponseCode() !== 200) {
    console.error(`[EN] Notionクエリ失敗 db=${dbId}:`, res.getContentText());
    return [];
  }
  return JSON.parse(res.getContentText()).results || [];
}

// -------------------------------------------------------
// 1ページ分の英語投稿処理（IG＋Threads・下書き）
// -------------------------------------------------------
function publishPageEN(page, notionKey, bufferKeyEN) {
  const props = page.properties;

  const igText = getRichText(props, 'キャプション(EN)');
  const thText = getRichText(props, 'Threadsキャプション(EN)') || igText; // Threads空ならIGを流用

  const instagram = getSelect(props, 'Instagram'); // ×/o/-
  const threads   = getSelect(props, 'Threads');   // ×/o/-

  // 公開日（JST→UTC）
  const 投稿日      = props['投稿日']?.date?.start ?? null;
  const scheduledAt = 投稿日 ? jstToUtc(投稿日) : null;

  // メディア（英語の組版済み画像）。Drive動画があればCloudinary変換も流用。
  const rawFiles = getNotionFiles(props, '投稿画像');
  const { updatedFiles: cloudinaryFiles, hasChanges: filesChanged } =
    convertDriveVideosToCloudinary(rawFiles);
  const uploadedFileIds = [];
  const sharedMedia = processNotionFiles(cloudinaryFiles, uploadedFileIds);

  let postedIG = false;
  let postedTh = false;

  // ① Instagram（メディア必須）
  if (instagram === '×') {
    if (!igText) {
      console.warn(`[EN] IGキャプション空のためスキップ pageId=${page.id}`);
    } else if (sharedMedia.length === 0) {
      console.warn(`[EN] IGはメディア必須のためスキップ pageId=${page.id}`);
    } else {
      postToBufferEN(bufferKeyEN, EN_BUFFER_CHANNELS.Instagram, igText, sharedMedia, scheduledAt, {
        instagram: { type: 'post', shouldShareToFeed: true }
      });
      console.log(`[EN] IG予約完了 pageId=${page.id}`);
      postedIG = true;
    }
  }

  // ② Threads（テキストのみでも可・画像があれば添付）
  if (threads === '×') {
    if (!thText) {
      console.warn(`[EN] Threadsキャプション空のためスキップ pageId=${page.id}`);
    } else {
      postToBufferEN(bufferKeyEN, EN_BUFFER_CHANNELS.Threads, thText, sharedMedia, scheduledAt, {});
      console.log(`[EN] Threads予約完了 pageId=${page.id}`);
      postedTh = true;
    }
  }
  const posted = postedIG || postedTh;

  // ③ Notion更新：再送防止に buffer=false ＋ 進捗を「投稿済」へ（予約が入った=完了扱い・ぽこ指定）。
  //    Cloudinary変換があれば投稿画像も更新。
  if (posted || filesChanged) {
    const updateProps = {};
    if (posted) {
      updateProps['buffer'] = { checkbox: false };
      updateProps['進捗'] = { select: { name: '投稿済' } };
    }
    // 予約が入った媒体は「o（完了）」に（ぽこ指定）
    if (postedIG) updateProps['Instagram'] = { select: { name: 'o' } };
    if (postedTh) updateProps['Threads'] = { select: { name: 'o' } };
    if (filesChanged) {
      updateProps['投稿画像'] = {
        files: cloudinaryFiles.map(f => {
          if (f?.external?.url) return { type: 'external', name: f.name || 'file', external: { url: f.external.url } };
          if (f?.file?.url)     return { type: 'file',     name: f.name || 'file', file:     { url: f.file.url } };
          return null;
        }).filter(Boolean)
      };
    }
    patchNotionProperties(page.id, updateProps, notionKey);
  }
}

// -------------------------------------------------------
// Buffer投稿（英語：直予約＝saveToDraft:false で公開キューに入れる）
// ※ JP用の共有 postToBuffer は saveToDraft:true 固定なので、EN専用に別関数を用意（JP無影響）。
// buildAssets は buffer.js のものを流用。
// -------------------------------------------------------
function postToBufferEN(bufferKey, channelId, text, mediaItems, scheduledAt, metadata) {
  const input = {
    text:           text,
    channelId:      channelId,
    schedulingType: 'automatic',
    mode:           scheduledAt ? 'customScheduled' : 'addToQueue',
    saveToDraft:    false  // 直予約（自動投稿）
  };
  if (scheduledAt)                                   input.dueAt    = scheduledAt;
  if (metadata && Object.keys(metadata).length > 0) input.metadata = metadata;
  input.assets = buildAssets(mediaItems);

  const mutation = `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id } }
        ... on MutationError { message }
      }
    }
  `;

  const res = UrlFetchApp.fetch('https://api.buffer.com/graphql', {
    method: 'post',
    headers: { 'Authorization': `Bearer ${bufferKey}`, 'Content-Type': 'application/json' },
    payload: JSON.stringify({ query: mutation, variables: { input } }),
    muteHttpExceptions: true
  });

  const body = JSON.parse(res.getContentText());
  if (body.errors?.length) throw new Error(`Buffer GraphQLエラー: ${JSON.stringify(body.errors)}`);
  const result = body.data?.createPost;
  if (!result || result.message) throw new Error(`Buffer投稿エラー: ${JSON.stringify(result)}`);
  return result.post?.id ?? null;
}
