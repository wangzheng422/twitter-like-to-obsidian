importScripts(
  "lib/obsidian-api.js",
  "lib/dedup.js",
  "lib/queue.js",
  "lib/markdown.js",
  "lib/article.js",
  "lib/tweet-detail.js"
);

const RETRY_ALARM = "retry-pending-tweets";
const SESSION_STATS_KEY = "sessionStats";
const CONTENT_STATUS_KEY = "contentStatus";
let statsChain = Promise.resolve();
let processChain = Promise.resolve();

async function getApiKey() {
  const data = await chrome.storage.sync.get({ apiKey: "" });
  return data.apiKey || "";
}

async function getStats() {
  const data = await chrome.storage.local.get({ [SESSION_STATS_KEY]: { saved: 0, captured: 0 } });
  return data[SESSION_STATS_KEY] || { saved: 0, captured: 0 };
}

async function updateStats(patch) {
  const stats = await getStats();
  const next = { ...stats, ...patch };
  await chrome.storage.local.set({ [SESSION_STATS_KEY]: next });
  return next;
}

async function resetStats() {
  const next = { saved: 0, captured: 0 };
  await chrome.storage.local.set({ [SESSION_STATS_KEY]: next });
  return next;
}

function incrementStat(field) {
  statsChain = statsChain.then(async () => {
    const stats = await getStats();
    const value = Number(stats[field] || 0) + 1;
    return updateStats({ [field]: value });
  });
  return statsChain;
}

async function updateContentStatus(patch) {
  const currentData = await chrome.storage.local.get({
    [CONTENT_STATUS_KEY]: {
      active: false,
      lastSeenAt: 0,
      url: "",
      likesPage: false,
      processed: 0,
      lastScanCount: 0,
      lastError: ""
    }
  });
  const status = {
    ...currentData[CONTENT_STATUS_KEY],
    ...patch
  };
  status.active = true;
  status.lastSeenAt = Date.now();
  await chrome.storage.local.set({ [CONTENT_STATUS_KEY]: status });
  return status;
}

async function setBadgeForQueue() {
  const queued = await TwitterLikesQueue.count();
  if (queued > 0) {
    await chrome.action.setBadgeText({ text: String(Math.min(queued, 99)) });
    await chrome.action.setBadgeBackgroundColor({ color: "#b91c1c" });
  } else {
    await chrome.action.setBadgeText({ text: "" });
  }
}

async function flashSavedBadge() {
  await chrome.action.setBadgeText({ text: "OK" });
  await chrome.action.setBadgeBackgroundColor({ color: "#15803d" });
  setTimeout(setBadgeForQueue, 1200);
}

function extensionFromUrl(url, fallback = "jpg") {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("format") || parsed.pathname.split(".").pop() || fallback;
  } catch (_) {
    return fallback;
  }
}

function assetMonthFromTweet(tweet) {
  const date = TwitterLikesDedup.dateFromTweet(tweet);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

async function downloadAsset(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Asset download failed: ${response.status}`);
  }
  return {
    body: await response.arrayBuffer(),
    contentType: response.headers.get("Content-Type") || "application/octet-stream"
  };
}

async function saveAsset(url, month, filename, apiKey) {
  const asset = await downloadAsset(url);
  const path = `wzh-twitter/assets/${month}/${filename}`;
  await ObsidianApi.putBinary(path, asset.body, asset.contentType, apiKey);
  return path;
}

async function saveTweetAssets(tweet, apiKey) {
  const saved = { images: [], quoteImages: [], videoThumbnail: "" };
  const month = assetMonthFromTweet(tweet);

  for (const [index, url] of (tweet.images || []).entries()) {
    const ext = extensionFromUrl(url);
    saved.images.push(await saveAsset(url, month, `${tweet.tweet_id}_${index + 1}.${ext}`, apiKey));
  }

  if (tweet.video_thumbnail) {
    const ext = extensionFromUrl(tweet.video_thumbnail);
    saved.videoThumbnail = await saveAsset(tweet.video_thumbnail, month, `${tweet.tweet_id}_video.${ext}`, apiKey);
  }

  if (tweet.quote_tweet && Array.isArray(tweet.quote_tweet.images)) {
    for (const [index, url] of tweet.quote_tweet.images.entries()) {
      const ext = extensionFromUrl(url);
      saved.quoteImages.push(await saveAsset(url, month, `${tweet.tweet_id}_qt_${index + 1}.${ext}`, apiKey));
    }
  }

  return saved;
}

async function maybeSaveArticle(tweet, apiKey) {
  if (!tweet.article_url) {
    return "";
  }
  const articleId = TwitterArticle.articleIdFromUrl(tweet.article_url);
  if (!articleId) {
    return "";
  }
  if (!(await TwitterLikesDedup.articleExists(articleId, apiKey))) {
    const article = await TwitterArticle.fetchArticle(tweet.article_url);
    if (article) {
      await ObsidianApi.putMarkdown(
        `wzh-twitter/articles/${article.article_id}.md`,
        TwitterLikesMarkdown.buildArticleMarkdown(article),
        apiKey
      );
    }
  }
  return articleId;
}

async function saveTweetToMonthlyArchive(tweet, savedAssets, articleId, apiKey) {
  const monthPath = TwitterLikesDedup.monthPathFromTweet(tweet);
  const currentMarkdown = await ObsidianApi.getText(monthPath, apiKey);
  if (currentMarkdown && currentMarkdown.includes(`<!-- tweet_id: ${tweet.tweet_id} -->`)) {
    return { skipped: true };
  }

  const entry = TwitterLikesMarkdown.buildMonthlyTweetEntry(tweet, savedAssets, articleId);
  const nextMarkdown = TwitterLikesMarkdown.insertMonthlyEntry(currentMarkdown, tweet, entry);
  await ObsidianApi.putMarkdown(monthPath, nextMarkdown, apiKey);
  return { saved: true, path: monthPath };
}

async function processTweet(tweet, { fromQueue = false } = {}) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error("Missing Obsidian API key");
  }

  const enrichedTweet = await TwitterTweetDetail.enrichTweet(tweet);
  const monthPath = TwitterLikesDedup.monthPathFromTweet(enrichedTweet);
  const currentMarkdown = await ObsidianApi.getText(monthPath, apiKey);

  if (currentMarkdown && currentMarkdown.includes(`<!-- tweet_id: ${enrichedTweet.tweet_id} -->`)) {
    const articleId = await maybeSaveArticle(enrichedTweet, apiKey);
    const updatedMarkdown = TwitterLikesMarkdown.replaceMonthlyEntryText(
      currentMarkdown,
      enrichedTweet,
      articleId,
      {}
    );
    if (updatedMarkdown && updatedMarkdown !== currentMarkdown) {
      await ObsidianApi.putMarkdown(monthPath, updatedMarkdown, apiKey);
      await incrementStat("saved");
      if (!fromQueue) {
        await flashSavedBadge();
      }
      return { saved: true, updated: true };
    }
    return { skipped: true };
  }

  const savedAssets = await saveTweetAssets(enrichedTweet, apiKey);
  const articleId = await maybeSaveArticle(enrichedTweet, apiKey);
  await saveTweetToMonthlyArchive(enrichedTweet, savedAssets, articleId, apiKey);

  await incrementStat("saved");
  if (!fromQueue) {
    await flashSavedBadge();
  }
  return { saved: true };
}

function enqueueTweet(tweet) {
  const job = processChain.then(() => processTweet(tweet));
  processChain = job.catch(() => {});
  return job;
}

async function queueTweet(tweet) {
  await TwitterLikesQueue.add(tweet);
  await setBadgeForQueue();
}

async function retryQueue() {
  const apiKey = await getApiKey();
  if (!apiKey) {
    await setBadgeForQueue();
    return;
  }

  let queue = await TwitterLikesQueue.all();
  const remaining = [];

  for (const item of queue) {
    try {
      await processTweet(item.data, { fromQueue: true });
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (_) {
      remaining.push({ ...item, retry_count: (item.retry_count || 0) + 1 });
    }
  }

  await TwitterLikesQueue.replace(remaining);
  await setBadgeForQueue();
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 0.5 });
  await setBadgeForQueue();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 0.5 });
  await setBadgeForQueue();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) {
    retryQueue();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "tweet:captured") {
    enqueueTweet(message.tweet)
      .then((result) => sendResponse({ accepted: true, ...result }))
      .catch(async (error) => {
        await queueTweet(message.tweet);
        sendResponse({ accepted: true, queued: true, error: error.message });
      });
    return true;
  }

  if (message.type === "stats:captured") {
    incrementStat("captured");
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "stats:reset") {
    resetStats().then((stats) => sendResponse({ ok: true, stats }));
    return true;
  }

  if (message.type === "content:active") {
    updateContentStatus({
      url: message.url || "",
      likesPage: Boolean(message.likesPage),
      processed: message.processed || 0,
      lastScanCount: message.lastScanCount || 0,
      lastError: ""
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "content:error") {
    updateContentStatus({ lastError: message.error || "Unknown content script error" });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "queue:retry") {
    retryQueue().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "status:get") {
    Promise.all([
      getApiKey(),
      getStats(),
      TwitterLikesQueue.count(),
      chrome.storage.local.get({
        [CONTENT_STATUS_KEY]: {
          active: false,
          lastSeenAt: 0,
          url: "",
          likesPage: false,
          processed: 0,
          lastScanCount: 0,
          lastError: ""
        }
      })
    ])
      .then(async ([apiKey, stats, queued, contentData]) => {
        let connected = false;
        if (apiKey) {
          try {
            connected = await ObsidianApi.health(apiKey);
          } catch (_) {
            connected = false;
          }
        }
        const content = contentData[CONTENT_STATUS_KEY];
        content.active = Boolean(content.lastSeenAt && Date.now() - content.lastSeenAt < 15000);
        sendResponse({ apiKeySet: Boolean(apiKey), connected, stats, queued, content });
      });
    return true;
  }

  return false;
});
