// Buffer投稿予約（Notion → Buffer）
// Makeシナリオ4130484の代替GAS実装

const NOTION_DB_ID_BUFFER = '1734552d5ffb8030a252c62abbb3331a';

const BUFFER_CHANNELS = {
  X:         '65828cb230da3c08a72753d4', // アカウント①
  Threads:   '67c121833b85969eaf47871f', // アカウント②
  Instagram: '67c120e83b85969eaf3faa81', // アカウント②
  TikTok:    '67c121083b85969eaf41140f'  // アカウント②
};

const BUFFER_GRAPHQL_ENDPOINT = 'https://api.buffer.com/graphql';
const DRIVE_IMAGE_FOLDER_ID   = '1vR1dSzCmpjj0x2DL09gKwJdk7xReQWM6';

// -------------------------------------------------------
// メイン関数（トリガーで1分ごとに実行）
// -------------------------------------------------------
function checkAndPublishToBuffer() {
  const scriptProps = PropertiesService.getScriptProperties();
  const notionKey   = scriptProps.getProperty('NOTION_API_KEY');
  const bufferKey1  = scriptProps.getProperty('BUFFER_API_KEY_1'); // アカウント①：X用
  const bufferKey2  = scriptProps.getProperty('BUFFER_API_KEY_2'); // アカウント②：Threads/Instagram/TikTok用

  if (!notionKey || !bufferKey1 || !bufferKey2) {
    console.error('スクリプトプロパティが未設定です（NOTION_API_KEY / BUFFER_API_KEY_1 / BUFFER_API_KEY_2）');
    return;
  }

  const queryRes = UrlFetchApp.fetch(
    `https://api.notion.com/v1/databases/${NOTION_DB_ID_BUFFER}/query`,
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
            { property: '進捗',   status:   { equals: '投稿待ち' } }
          ]
        }
      }),
      muteHttpExceptions: true
    }
  );

  if (queryRes.getResponseCode() !== 200) {
    console.error('Notion APIクエリ失敗:', queryRes.getContentText());
    return;
  }

  const pages = JSON.parse(queryRes.getContentText()).results;
  if (!pages || pages.length === 0) {
    console.log('投稿待ちページなし');
    return;
  }

  console.log(`投稿待ちページ数: ${pages.length}`);
  pages.forEach(page => {
    try {
      publishPage(page, notionKey, bufferKey1, bufferKey2);
    } catch (e) {
      console.error(`エラー pageId=${page.id}: ${e.message}`);
    }
  });
}

// -------------------------------------------------------
// 1ページ分の投稿処理
// -------------------------------------------------------
function publishPage(page, notionKey, bufferKey1, bufferKey2) {
  const props = page.properties;

  // --- 投稿文取得 ---
  const 投稿文        = getRichText(props, '投稿文');
  const X投稿文       = getRichText(props, 'X投稿文');
  const Threads投稿文 = getRichText(props, 'Threads投稿文');
  const Insta投稿文   = getRichText(props, 'Instagram投稿文');
  const TikTok投稿文  = getRichText(props, 'TikTok投稿文');

  const xText       = X投稿文 || 投稿文;
  const threadsText = Threads投稿文 || X投稿文 || 投稿文;
  const instText    = Insta投稿文 || 投稿文;
  const tiktokText  = TikTok投稿文 || 投稿文;

  // --- 媒体ステータス ---
  const twitter   = getSelect(props, 'Twitter');   // ×/o/-（Threads連動）
  const instagram = getSelect(props, 'Instagram'); // ×/o/-/S
  const tiktok    = getSelect(props, 'TikTok');    // ×/o/-

  // --- 種類・タグ判定 ---
  const 種類タグ       = props['種類']?.multi_select ?? [];
  const タグ一覧       = props['タグ']?.multi_select ?? [];
  const isManga        = 種類タグ.some(s => s.name === 'マンガ');
  const isQuizMachigai = 種類タグ.some(s => s.name === 'クイズ') && タグ一覧.some(t => t.name === '間違い探し');
  const seriesTag      = タグ一覧[0]?.name ?? null;               // 修正②
  const 話数           = props['話数']?.number ?? null;                                       // 修正③
  const 前話X_URL      = props['前話X_URL']?.url ?? '';
  const 前話Threads_URL = props['前話Threads_URL']?.url ?? '';

  // --- 公開日（JST→UTC） ---
  const 公開日      = props['公開日']?.date?.start ?? null;
  const scheduledAt = 公開日 ? jstToUtc(公開日) : null;

  // --- メディア処理 ---
  // Cloudinaryアップロード時のNOTION PATCHがX画像S3 URLを無効化しないよう、
  // Cloudinaryアップロード・X画像処理はすべてNOTION PATCH前に完了させる。
  // Notion PATCHは最後の updateNotionPage で一括して行う。

  const xFiles      = getNotionFiles(props, ' X画像'); // Notionプロパティ名は先頭にスペースあり
  const uploadedFileIds = [];

  // ① 投稿画像のDrive動画をCloudinaryに変換（Notion PATCHはまだしない）
  const rawSharedFiles = getNotionFiles(props, '投稿画像');
  const { updatedFiles: cloudinarySharedFiles, hasChanges: sharedFilesChanged } =
    convertDriveVideosToCloudinary(rawSharedFiles);
  const sharedMedia = processNotionFiles(cloudinarySharedFiles, uploadedFileIds);

  // ② X画像をDriveにアップロード（Cloudinaryアップロード後・Notion PATCH前）
  const xMediaFromX = processNotionFiles(xFiles, uploadedFileIds);
  // ③ xMedia決定：X画像あり→そのまま使用、なし→投稿画像の画像部分をフォールバック
  const xMedia = (xFiles.length > 0 && xMediaFromX.length > 0)
    ? xMediaFromX
    : sharedMedia.filter(m => m.type === 'image');

  // Buffer post IDを記録（漫画の次話URL書き込みに使用）
  let xPostId      = null;
  let threadsPostId = null;

  try {
    // ① X ← アカウント①
    if (twitter === '×') {
      if (!xText) {
        console.warn(`X投稿文が空のためスキップ pageId=${page.id}`);
      } else {
        try {
          let parts = splitThread(xText);
          let firstMedia = xMedia;
          let metadata   = {};

          if (isQuizMachigai && parts.length >= 3) {
            // クイズ/間違い探し: 画像を各投稿に振り分け
            // 1投稿目→画像1枚目、2投稿目→画像2枚目、3投稿目→画像4枚目
            const q0Media     = xMedia[0] ? [xMedia[0]] : [];
            const hintMedia   = xMedia[1] ? [xMedia[1]] : [];
            const answerMedia = xMedia[3] ? [xMedia[3]] : [];
            const threadItems = [
              Object.assign({ text: parts[0] }, q0Media.length     > 0 ? { assets: buildAssets(q0Media)     } : {}),
              Object.assign({ text: parts[1] }, hintMedia.length   > 0 ? { assets: buildAssets(hintMedia)   } : {}),
              Object.assign({ text: parts[2] }, answerMedia.length  > 0 ? { assets: buildAssets(answerMedia) } : {})
            ];
            metadata = { twitter: { thread: threadItems } };
            firstMedia = []; // thread[0]に含める
          } else {
            // 漫画: 2投稿目の末尾に前話URLを付加
            if (isManga && parts.length >= 2 && 前話X_URL) {
              parts[1] = parts[1] + '\n' + 前話X_URL;
            }
            if (parts.length > 1) {
              const firstItem = Object.assign({ text: parts[0] }, firstMedia.length > 0 ? { assets: buildAssets(firstMedia) } : {});
              metadata = { twitter: { thread: [firstItem, ...parts.slice(1).map(t => ({ text: t }))] } };
              firstMedia = []; // thread[0]に含める
            }
          }

          xPostId = postToBuffer(bufferKey1, BUFFER_CHANNELS.X, parts[0], firstMedia, scheduledAt, metadata);
          console.log(`X投稿完了 (${parts.length}ツイート) pageId=${page.id}`);
        } catch (e) {
          console.error(`X投稿エラー pageId=${page.id}: ${e.message}`);
        }
      }
    }

    // ② Threads（Xと連動）← アカウント②
    if (twitter === '×') {
      if (!threadsText) {
        console.warn(`Threads投稿文が空のためスキップ pageId=${page.id}`);
      } else {
        try {
          let parts = splitThread(threadsText);
          let firstMedia = xMedia;
          let metadata   = {};

          if (isQuizMachigai && parts.length >= 3) {
            // クイズ/間違い探し: 画像を各投稿に振り分け
            // 1投稿目→画像1枚目、2投稿目→画像2枚目、3投稿目→画像4枚目
            const q0Media     = xMedia[0] ? [xMedia[0]] : [];
            const hintMedia   = xMedia[1] ? [xMedia[1]] : [];
            const answerMedia = xMedia[3] ? [xMedia[3]] : [];
            const threadItems = [
              Object.assign({ text: parts[0] }, q0Media.length     > 0 ? { assets: buildAssets(q0Media)     } : {}),
              Object.assign({ text: parts[1] }, hintMedia.length   > 0 ? { assets: buildAssets(hintMedia)   } : {}),
              Object.assign({ text: parts[2] }, answerMedia.length  > 0 ? { assets: buildAssets(answerMedia) } : {})
            ];
            metadata = { threads: { thread: threadItems } };
            firstMedia = []; // thread[0]に含める
          } else {
            // 漫画: 2投稿目の末尾に前話URLを付加
            if (isManga && parts.length >= 2 && 前話Threads_URL) {
              parts[1] = parts[1] + '\n' + 前話Threads_URL;
            }
            if (parts.length > 1) {
              const firstItem = Object.assign({ text: parts[0] }, firstMedia.length > 0 ? { assets: buildAssets(firstMedia) } : {});
              metadata = { threads: { thread: [firstItem, ...parts.slice(1).map(t => ({ text: t }))] } };
              firstMedia = []; // thread[0]に含める
            }
          }

          threadsPostId = postToBuffer(bufferKey2, BUFFER_CHANNELS.Threads, parts[0], firstMedia, scheduledAt, metadata);
          console.log(`Threads投稿完了 (${parts.length}投稿) pageId=${page.id}`);
        } catch (e) {
          console.error(`Threads投稿エラー pageId=${page.id}: ${e.message}`);
        }
      }
    }

    // ③ Instagram ← アカウント②（メディア必須）
    if (instagram === '×' || instagram === 'S') {
      if (!instText) {
        console.warn(`Instagram投稿文が空のためスキップ pageId=${page.id}`);
      } else if (sharedMedia.length === 0) {
        console.warn(`Instagram投稿はメディア必須のためスキップ pageId=${page.id}`);
      } else {
        try {
          const instType = instagram === 'S' ? 'story' : 'post';
          postToBuffer(bufferKey2, BUFFER_CHANNELS.Instagram, instText, sharedMedia, scheduledAt, {
            instagram: {
              type:              instType,
              shouldShareToFeed: instType === 'post' // 通常投稿=true、ストーリーズ=false
            }
          });
          console.log(`Instagram投稿完了 (${instType}) pageId=${page.id}`);
        } catch (e) {
          console.error(`Instagram投稿エラー pageId=${page.id}: ${e.message}`);
        }
      }
    }

    // ④ TikTok ← アカウント②（メディア必須）
    if (tiktok === '×') {
      if (!tiktokText) {
        console.warn(`TikTok投稿文が空のためスキップ pageId=${page.id}`);
      } else if (sharedMedia.length === 0) {
        console.warn(`TikTok投稿はメディア必須のためスキップ pageId=${page.id}`);
      } else {
        try {
          postToBuffer(bufferKey2, BUFFER_CHANNELS.TikTok, tiktokText, sharedMedia, scheduledAt, {});
          console.log(`TikTok投稿完了 pageId=${page.id}`);
        } catch (e) {
          console.error(`TikTok投稿エラー pageId=${page.id}: ${e.message}`);
        }
      }
    }

    // --- Notionステータス更新（Cloudinary URL変換があれば投稿画像も一括更新）---
    const notionUpdateProps = {};
    if (sharedFilesChanged) {
      const patchFiles = cloudinarySharedFiles
        .map(f => {
          if (f?.external?.url) return { type: 'external', name: f.name || 'file', external: { url: f.external.url } };
          if (f?.file?.url)     return { type: 'file',     name: f.name || 'file', file:     { url: f.file.url } };
          return null;
        })
        .filter(Boolean);
      notionUpdateProps['投稿画像'] = { files: patchFiles };
      console.log(`投稿画像をCloudinary URLで一括更新 pageId=${page.id}`);
    }
    updateNotionPage(page.id, notionKey, notionUpdateProps);
    console.log(`Notion更新完了 pageId=${page.id}`);

    // --- 漫画: 次話ページに今回のBuffer URLを書き込む ---
    if (isManga) {
      if (話数 === null) {
        console.log('話数が取得できなかったため次話検索をスキップします');
      } else if (!seriesTag) {
        console.log('タグが取得できなかったため次話検索をスキップします');
      } else {
        const xBufferUrl      = xPostId      ? `https://publish.buffer.com/post/${xPostId}`      : null;
        const threadsBufferUrl = threadsPostId ? `https://publish.buffer.com/post/${threadsPostId}` : null;
        findAndUpdateNextEpisode(話数, seriesTag, xBufferUrl, threadsBufferUrl, notionKey);
      }
    }

  } finally {
    // --- Driveの一時画像ファイルを削除（動画=外部URLは削除しない） ---
    uploadedFileIds.forEach(fileId => {
      try {
        DriveApp.getFileById(fileId).setTrashed(true);
      } catch (e) {
        console.warn(`Drive一時ファイル削除失敗 fileId=${fileId}: ${e.message}`);
      }
    });
    if (uploadedFileIds.length > 0) {
      console.log(`Drive一時ファイル削除完了 (${uploadedFileIds.length}件) pageId=${page.id}`);
    }
  }
}

// -------------------------------------------------------
// Buffer GraphQL APIへ投稿（下書き保存）
// 返り値: Buffer post ID（文字列）または null
// -------------------------------------------------------
function postToBuffer(bufferKey, channelId, text, mediaItems, scheduledAt, metadata) {
  const input = {
    text:           text,
    channelId:      channelId,
    schedulingType: 'automatic',
    mode:           scheduledAt ? 'customScheduled' : 'addToQueue',
    saveToDraft:    true  // ① 下書きモード
  };
  if (scheduledAt)                                   input.dueAt    = scheduledAt;
  if (metadata && Object.keys(metadata).length > 0) input.metadata = metadata;

  input.assets = buildAssets(mediaItems);

  const mutation = `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess {
          post { id }
        }
        ... on MutationError {
          message
        }
      }
    }
  `;

  const res = UrlFetchApp.fetch(BUFFER_GRAPHQL_ENDPOINT, {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${bufferKey}`,
      'Content-Type':  'application/json'
    },
    payload: JSON.stringify({ query: mutation, variables: { input } }),
    muteHttpExceptions: true
  });

  const body = JSON.parse(res.getContentText());
  if (body.errors?.length) {
    throw new Error(`Buffer GraphQLエラー: ${JSON.stringify(body.errors)}`);
  }
  const result = body.data?.createPost;
  if (!result || result.message) {
    throw new Error(`Buffer投稿エラー: ${JSON.stringify(result)}`);
  }

  return result.post?.id ?? null; // ③ Buffer post IDを返す
}

// -------------------------------------------------------
// メディア処理
// -------------------------------------------------------

/**
 * Notionファイル配列をメディア情報に変換する。
 * ② ファイル名をゼロ埋め2桁インデックス付きにし、インデックス昇順でソートして返す。
 *
 * - external.url（Drive動画リンク）→ 直リンクに変換（再アップ不要）
 * - file.url（Notion S3画像）→ DLしてDriveに保存し公開URL発行
 *
 * 返り値: [{ type: 'image'|'video', url: string }]
 */
function processNotionFiles(notionFiles, uploadedFileIds) {
  const mediaItems = [];
  const timestamp  = Date.now(); // バッチ内で同一タイムスタンプを使用

  notionFiles.forEach((f, i) => {
    const externalUrl = f?.external?.url ?? null;
    const notionUrl   = f?.file?.url ?? null;
    const paddedIdx   = String(i).padStart(2, '0');

    if (externalUrl) {
      if (/drive\.google\.com/i.test(externalUrl)) {
        // Google DriveのURLはBufferが取得できないためスキップ
        // 動画はYouTube（限定公開）など直接アクセス可能なURLを使用してください
        console.warn(`動画スキップ (${i + 1}件目): Google Drive URLはBufferが取得できません。YouTubeなど別のURLを使用してください。`);
        return;
      }
      mediaItems.push({ type: 'video', url: externalUrl, _index: i });
      console.log(`動画URL設定完了 (${i + 1}件目)`);

    } else if (notionUrl) {
      try {
        const res = UrlFetchApp.fetch(notionUrl, { muteHttpExceptions: true });
        if (res.getResponseCode() !== 200) {
          console.warn(`画像DL失敗 (${i + 1}件目): HTTP ${res.getResponseCode()}`);
          return;
        }
        const blob     = res.getBlob();
        const ext      = getExtension(blob.getContentType());
        const filename = `buffer_tmp_${timestamp}_${paddedIdx}.${ext}`; // ② ゼロ埋め2桁
        const file     = DriveApp.getFolderById(DRIVE_IMAGE_FOLDER_ID).createFile(blob.setName(filename));
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        uploadedFileIds.push(file.getId());
        // lh3形式はBufferが直接取得できるCDN URL
        mediaItems.push({ type: 'image', url: `https://lh3.googleusercontent.com/d/${file.getId()}`, _index: i });
        console.log(`画像アップロード完了 (${i + 1}件目): ${filename}`);
      } catch (e) {
        console.error(`画像アップロードエラー (${i + 1}件目): ${e.message}`);
      }
    }
  });

  // ② インデックス昇順でソートして順番を保証
  mediaItems.sort((a, b) => a._index - b._index);
  return mediaItems.map(item => ({ type: item.type, url: item.url }));
}

/**
 * mediaItemsからBuffer API用のassetsオブジェクトを生成する。
 * 動画がある場合は動画優先（1本目のみ）、なければ画像カルーセル。
 */
function buildAssets(mediaItems) {
  if (!mediaItems || mediaItems.length === 0) return [];
  const videos = mediaItems.filter(m => m.type === 'video');
  const images = mediaItems.filter(m => m.type === 'image');
  if (videos.length > 0) return videos.map(m => ({ video: { url: m.url } }));
  if (images.length > 0) return images.map(m => ({ image: { url: m.url } }));
  return [];
}

// -------------------------------------------------------
// 漫画: 次話ページに前話BufferURLを書き込む
// -------------------------------------------------------
function findAndUpdateNextEpisode(currentEpisode, seriesTag, xBufferUrl, threadsBufferUrl, notionKey) {
  if (!xBufferUrl && !threadsBufferUrl) return;

  const nextEpisode = currentEpisode + 1;
  const queryRes = UrlFetchApp.fetch(
    `https://api.notion.com/v1/databases/${NOTION_DB_ID_BUFFER}/query`,
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
            { property: '種類', multi_select: { contains: 'マンガ' } },
            { property: 'タグ',  multi_select: { contains: seriesTag } },
            { property: '話数', number:        { equals: nextEpisode } }
          ]
        }
      }),
      muteHttpExceptions: true
    }
  );

  if (queryRes.getResponseCode() !== 200) {
    console.warn(`次話検索失敗（第${nextEpisode}話）: ${queryRes.getContentText()}`);
    return;
  }

  const pages = JSON.parse(queryRes.getContentText()).results;
  if (!pages || pages.length === 0) {
    console.log(`次話（第${nextEpisode}話）ページが見つからないためスキップ`);
    return;
  }

  const nextPageId  = pages[0].id;
  const updateProps = {};
  if (xBufferUrl)      updateProps['前話X_URL']      = { url: xBufferUrl };
  if (threadsBufferUrl) updateProps['前話Threads_URL'] = { url: threadsBufferUrl };

  patchNotionProperties(nextPageId, updateProps, notionKey);
  console.log(`次話（第${nextEpisode}話）に前話URL書き込み完了 pageId=${nextPageId}`);
}

// -------------------------------------------------------
// Notion更新
// -------------------------------------------------------

/**
 * 投稿完了後のNotionページ更新。
 * 進捗→送信済み、buffer→false に加え、additionalPropsも同時に更新する。
 */
function updateNotionPage(pageId, notionKey, additionalProps) {
  const properties = Object.assign(
    {
      '進捗':   { status:   { name: '送信済み' } },
      'buffer': { checkbox: false }
    },
    additionalProps || {}
  );
  patchNotionProperties(pageId, properties, notionKey);
}

/**
 * Notionページの任意プロパティをPATCHする汎用関数。
 */
function patchNotionProperties(pageId, properties, notionKey) {
  const res = UrlFetchApp.fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'patch',
    headers: {
      'Authorization':  `Bearer ${notionKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type':   'application/json'
    },
    payload: JSON.stringify({ properties }),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    throw new Error(`Notion PATCH失敗 pageId=${pageId}: ${res.getContentText()}`);
  }
}

// -------------------------------------------------------
// ユーティリティ
// -------------------------------------------------------

// -------------------------------------------------------
// Cloudinary動画アップロード
// -------------------------------------------------------

/**
 * notionFiles 内の Google Drive external URL を Cloudinary にアップロードし、
 * secure_url に差し替えた新しいファイル配列を返す。
 * Notion PATCH は行わない（呼び出し元で一括PATCHすること）。
 *
 * 返り値: { updatedFiles: Array, hasChanges: boolean }
 */
function convertDriveVideosToCloudinary(notionFiles) {
  const scriptProps = PropertiesService.getScriptProperties();
  const cloudName   = scriptProps.getProperty('CLOUDINARY_CLOUD_NAME');
  const apiKey      = scriptProps.getProperty('CLOUDINARY_API_KEY');
  const apiSecret   = scriptProps.getProperty('CLOUDINARY_API_SECRET');

  if (!cloudName || !apiKey || !apiSecret) {
    return { updatedFiles: notionFiles, hasChanges: false };
  }

  let hasChanges = false;
  const updatedFiles = notionFiles.map((f, i) => {
    const externalUrl = f?.external?.url ?? null;
    if (!externalUrl || !/drive\.google\.com/i.test(externalUrl)) return f;

    try {
      const cloudinaryUrl = uploadSingleVideoToCloudinary(externalUrl, cloudName, apiKey, apiSecret);
      console.log(`Cloudinaryアップロード完了 (投稿画像 ${i + 1}件目): ${cloudinaryUrl}`);
      hasChanges = true;
      return { type: 'external', name: f.name || 'video', external: { url: cloudinaryUrl } };
    } catch (e) {
      console.error(`Cloudinaryアップロードエラー (投稿画像 ${i + 1}件目): ${e.message}`);
      return f;
    }
  });

  return { updatedFiles, hasChanges };
}

/**
 * Google Drive URL の動画を Cloudinary にアップロードし、Buffer互換MP4 URLを返す。
 * eager変換でH.264/AACに事前変換し、変換済みURLをそのまま返す。
 * DriveApp で直接バイナリ取得するため、ファイルの共有設定に依存しない。
 */
function uploadSingleVideoToCloudinary(driveUrl, cloudName, apiKey, apiSecret) {
  const fileId = extractDriveFileId(driveUrl);
  if (!fileId) throw new Error(`Drive URLからファイルIDを取得できません: ${driveUrl}`);

  const blob = DriveApp.getFileById(fileId).getBlob();

  const timestamp    = Math.floor(Date.now() / 1000);
  const publicId     = `popochi_video_${timestamp}`;
  // eager変換を署名対象パラメータに含める（アルファベット順）
  const eagerTransformation = 'ac_aac,f_mp4,vc_h264';
  const paramsToSign = `eager=${eagerTransformation}&public_id=${publicId}&timestamp=${timestamp}`;
  const signature    = computeCloudinarySignature(paramsToSign, apiSecret);

  const res = UrlFetchApp.fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`,
    {
      method:  'post',
      payload: {
        file:      blob,
        api_key:   apiKey,
        timestamp: String(timestamp),
        public_id: publicId,
        eager:     eagerTransformation, // H.264+AACへ事前変換（デフォルトで同期実行）
        signature: signature
      },
      muteHttpExceptions: true
    }
  );

  if (res.getResponseCode() !== 200) {
    throw new Error(`Cloudinary APIエラー (HTTP ${res.getResponseCode()}): ${res.getContentText()}`);
  }

  const result = JSON.parse(res.getContentText());
  if (!result.secure_url) throw new Error(`secure_urlが取得できません: ${JSON.stringify(result)}`);

  // eager変換済みURLが取得できれば優先して使用（Buffer互換のH.264/AAC MP4）
  const eagerUrl = result.eager?.[0]?.secure_url;
  if (eagerUrl) {
    console.log(`eager変換済みURL取得: ${eagerUrl}`);
    return eagerUrl;
  }

  // フォールバック: トランスフォームパラメータ付きURLを構築
  const fallbackUrl = result.secure_url.replace('/upload/', `/upload/${eagerTransformation}/`).replace(/\.[^.]+$/, '.mp4');
  console.log(`eagerURL未取得のためトランスフォームURL使用: ${fallbackUrl}`);
  return fallbackUrl;
}

/** Cloudinary アップロード用 SHA-1 署名を生成する */
function computeCloudinarySignature(paramsString, apiSecret) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_1,
    paramsString + apiSecret,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

/** Google Drive URL からファイル ID を抽出する */
function extractDriveFileId(url) {
  const m1 = url.match(/\/file\/d\/([^\/\?]+)/);
  if (m1) return m1[1];
  const m2 = url.match(/[?&]id=([^&]+)/);
  if (m2) return m2[1];
  return null;
}

/**
 * 投稿文を「===」で分割してスレッド配列にする。
 * 返り値: ['1投稿目', '2投稿目', ...]（最低1要素）
 */
function splitThread(text) {
  return text.split(/\n*===\n*/).map(s => s.trim()).filter(Boolean);
}


function jstToUtc(jstDateStr) {
  if (!jstDateStr) return null;
  // タイムゾーン情報（+/-/Z）がすでにある場合はそのままパース
  if (/[+Z]/.test(jstDateStr.slice(10))) return new Date(jstDateStr).toISOString();
  // タイムゾーンなしの文字列はJSTとみなし、+09:00 を明示的に付与してパース
  // （GASプロジェクトのタイムゾーン設定に依存させないための安全策）
  return new Date(jstDateStr + '+09:00').toISOString();
}

function getRichText(props, key) {
  return props[key]?.rich_text?.[0]?.plain_text ?? '';
}

function getSelect(props, key) {
  return props[key]?.select?.name ?? '-';
}

function getNotionFiles(props, key) {
  return props[key]?.files ?? [];
}

function getExtension(mimeType) {
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
  return map[mimeType] ?? 'jpg';
}
