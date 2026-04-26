(function () {
  const TWITTER_EPOCH_MS = 1288834974657n;

  function dateFromTweet(tweet) {
    const parsed = Date.parse(tweet?.timestamp || "");
    if (Number.isFinite(parsed)) {
      return new Date(parsed);
    }

    try {
      if (/^\d+$/.test(String(tweet?.tweet_id || ""))) {
        return new Date(Number((BigInt(tweet.tweet_id) >> 22n) + TWITTER_EPOCH_MS));
      }
    } catch (_) {
      // Fall through to current time.
    }

    return new Date();
  }

  function timestampFromTweet(tweet) {
    const parsed = Date.parse(tweet?.timestamp || "");
    return Number.isFinite(parsed) ? tweet.timestamp : dateFromTweet(tweet).toISOString();
  }

  function yamlString(value) {
    return JSON.stringify(value == null ? "" : String(value));
  }

  function frontmatter(fields) {
    const lines = ["---"];
    Object.entries(fields).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        lines.push(`${key}:`);
        value.forEach((item) => lines.push(`  - ${item}`));
      } else {
        lines.push(`${key}: ${value}`);
      }
    });
    lines.push("---", "");
    return lines.join("\n");
  }

  function assetEmbed(path) {
    return `![[${path}]]`;
  }

  function articleTitle(tweet) {
    const title = tweet.article_card?.title || "Article";
    const url = tweet.article_card?.url || tweet.article_url || "";
    return url ? `[${title}](${url})` : title;
  }

  function buildArticleSection(tweet, articleId = "") {
    if (!articleId && !tweet.article_card && !tweet.article_url) {
      return "";
    }

    const parts = ["## Article", "", articleTitle(tweet)];
    if (tweet.article_card?.description) {
      parts.push("", tweet.article_card.description);
    }
    if (tweet.article_card?.domain) {
      parts.push("", `Source: ${tweet.article_card.domain}`);
    }
    if (articleId) {
      parts.push("", `[[wzh-twitter/articles/${articleId}]]`);
    }
    return parts.join("\n");
  }

  function buildTweetBody(tweet, savedAssets = {}, articleId = "", headingLevel = 1) {
    const author = tweet.author_handle ? `@${tweet.author_handle.replace(/^@/, "")}` : "";
    const heading = [author, tweet.author_name].filter(Boolean).join(" - ");
    const parts = [
      `${"#".repeat(headingLevel)} ${heading || tweet.tweet_id}`,
      "",
      `[${timestampFromTweet(tweet)}](${tweet.tweet_url || ""})`,
      "",
      tweet.text || ""
    ];

    if (savedAssets.images && savedAssets.images.length) {
      parts.push("", "## Media", "", ...savedAssets.images.map(assetEmbed));
    }

    if (tweet.video_url || savedAssets.videoThumbnail) {
      parts.push("", "## Video", "");
      if (tweet.video_url) {
        parts.push(`[Video](${tweet.video_url})`);
      }
      if (savedAssets.videoThumbnail) {
        parts.push(assetEmbed(savedAssets.videoThumbnail));
      }
    }

    if (tweet.quote_tweet) {
      parts.push("", "## Quote Tweet", "");
      if (tweet.quote_tweet.unavailable) {
        parts.push("> Quoted tweet unavailable");
      } else {
        const quoteAuthor = tweet.quote_tweet.author_handle ? `@${tweet.quote_tweet.author_handle.replace(/^@/, "")}` : "";
        parts.push(`> **${quoteAuthor}**${tweet.quote_tweet.author_name ? ` - ${tweet.quote_tweet.author_name}` : ""}`);
        if (tweet.quote_tweet.text) {
          parts.push(">", ...tweet.quote_tweet.text.split("\n").map((line) => `> ${line}`));
        }
        if (tweet.quote_tweet.article_card) {
          const quoteArticle = buildArticleSection({
            article_card: tweet.quote_tweet.article_card,
            article_url: tweet.quote_tweet.article_card.url
          });
          if (quoteArticle) {
            parts.push(">", ...quoteArticle.split("\n").map((line) => `> ${line}`));
          }
        }
        if (savedAssets.quoteImages && savedAssets.quoteImages.length) {
          parts.push(">", ...savedAssets.quoteImages.map((asset) => `> ${assetEmbed(asset)}`));
        }
      }
    }

    if (tweet.reply_to) {
      const handle = tweet.reply_to.author_handle ? `@${tweet.reply_to.author_handle.replace(/^@/, "")}` : "tweet";
      const target = tweet.reply_to.url || "#";
      parts.push("", "## In Reply To", "", `Reply to [${handle}](${target})`);
    }

    if (articleId || tweet.article_card || tweet.article_url) {
      parts.push("", buildArticleSection(tweet, articleId));
    }

    return `${parts.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
  }

  function buildTweetMarkdown(tweet, savedAssets = {}, articleId = "") {
    const author = tweet.author_handle ? `@${tweet.author_handle.replace(/^@/, "")}` : "";
    return `${frontmatter({
      tweet_id: yamlString(tweet.tweet_id),
      author: yamlString(author),
      author_name: yamlString(tweet.author_name || ""),
      date: tweet.timestamp || "",
      url: tweet.tweet_url || "",
      type: "tweet",
      tags: ["twitter-like"]
    })}${buildTweetBody(tweet, savedAssets, articleId, 1)}`;
  }

  function buildMonthlyHeader(tweet) {
    const date = dateFromTweet(tweet);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    return `${frontmatter({
      month: yamlString(`${year}-${month}`),
      type: "twitter-like-monthly",
      tags: ["twitter-like"]
    })}# Twitter Likes ${year}-${month}\n`;
  }

  function buildMonthlyTweetEntry(tweet, savedAssets = {}, articleId = "") {
    return [
      `<!-- tweet_id: ${tweet.tweet_id} -->`,
      buildTweetBody(tweet, savedAssets, articleId, 2).trim(),
      ""
    ].join("\n");
  }

  function entryTweetId(entry) {
    const match = entry.match(/<!--\s*tweet_id:\s*([^>\s]+)\s*-->/);
    return match ? match[1] : "";
  }

  function entryTimestamp(entry) {
    const match = entry.match(/\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]\(/);
    const timestamp = match ? Date.parse(match[1]) : 0;
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function splitMonthlyEntries(markdown, tweet) {
    const base = markdown || buildMonthlyHeader(tweet);
    const firstEntryIndex = base.indexOf("<!-- tweet_id:");
    if (firstEntryIndex < 0) {
      return {
        header: buildMonthlyHeader(tweet).trimEnd(),
        entries: []
      };
    }

    const header = base.slice(0, firstEntryIndex).trimEnd();
    const body = base.slice(firstEntryIndex).trim();
    const normalizedBody = body.replace(/\n\s*---\s*\n(?=\s*<!-- tweet_id:)/g, "\n");
    return {
      header,
      entries: normalizedBody
        .split(/\n(?=<!-- tweet_id:)/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    };
  }

  function insertMonthlyEntry(existingMarkdown, tweet, entryMarkdown) {
    const trimmedEntry = entryMarkdown.trim();
    const separator = "---";
    const incomingId = entryTweetId(trimmedEntry);
    const { header, entries } = splitMonthlyEntries(existingMarkdown, tweet);
    const nextEntries = entries
      .filter((entry) => entryTweetId(entry) !== incomingId)
      .concat(trimmedEntry)
      .sort((a, b) => entryTimestamp(b) - entryTimestamp(a));

    return `${header}\n\n${nextEntries.join(`\n\n${separator}\n\n`)}\n`;
  }

  function findEntryRange(markdown, tweetId) {
    const marker = `<!-- tweet_id: ${tweetId} -->`;
    const start = markdown.indexOf(marker);
    if (start < 0) {
      return null;
    }

    const rest = markdown.slice(start + marker.length);
    const nextMarker = rest.search(/\n\s*---\s*\n\s*<!-- tweet_id:|\n<!-- tweet_id:/);
    const end = nextMarker >= 0 ? start + marker.length + nextMarker : markdown.length;
    return { start, end };
  }

  function findMonthlyEntry(markdown, tweetId) {
    const range = findEntryRange(markdown || "", tweetId);
    return range ? markdown.slice(range.start, range.end) : "";
  }

  function replaceBodyText(entry, text) {
    const bodyStartMatch = entry.match(/\[[^\]]+\]\([^)]+\)\n\n/);
    if (!bodyStartMatch || bodyStartMatch.index == null) {
      return entry;
    }

    const textStart = bodyStartMatch.index + bodyStartMatch[0].length;
    const afterDate = entry.slice(textStart);
    const nextSection = afterDate.search(/\n\n## (Media|Video|Quote Tweet|In Reply To|Article)\b/);
    const textEnd = nextSection >= 0 ? textStart + nextSection : entry.length;
    const currentText = entry.slice(textStart, textEnd).trim();
    const nextText = String(text || "").trim();

    if (!nextText || nextText.length <= currentText.length || currentText === nextText) {
      return entry;
    }

    return `${entry.slice(0, textStart)}${nextText}${entry.slice(textEnd)}`;
  }

  function replaceArticleSection(entry, tweet, articleId = "") {
    const nextSection = buildArticleSection(tweet, articleId);
    if (!nextSection) {
      return entry;
    }

    const articleStart = entry.search(/\n\n## Article\b/);
    if (articleStart >= 0) {
      const afterArticle = entry.slice(articleStart + 2);
      const nextHeading = afterArticle.slice("## Article".length).search(/\n\n## /);
      const end = nextHeading >= 0
        ? articleStart + 2 + "## Article".length + nextHeading
        : entry.length;
      const currentSection = entry.slice(articleStart + 2, end).trim();
      if (currentSection === nextSection.trim()) {
        return entry;
      }
      return `${entry.slice(0, articleStart + 2)}${nextSection}${entry.slice(end)}`;
    }

    const insertBefore = entry.search(/\n\n## In Reply To\b/);
    const insertAt = insertBefore >= 0 ? insertBefore : entry.length;
    const prefix = entry.slice(0, insertAt).trimEnd();
    const suffix = entry.slice(insertAt);
    return `${prefix}\n\n${nextSection}${suffix}`;
  }

  function replaceVideoSection(entry, tweet, savedAssets = {}) {
    if (!savedAssets.videoThumbnail && !tweet.video_url) {
      return entry;
    }

    const lines = ["## Video", ""];
    if (tweet.video_url) {
      lines.push(`[Video](${tweet.video_url})`);
    }
    if (savedAssets.videoThumbnail) {
      lines.push(assetEmbed(savedAssets.videoThumbnail));
    }
    const nextSection = lines.join("\n");

    const videoStart = entry.search(/\n\n## Video\b/);
    if (videoStart >= 0) {
      const afterVideo = entry.slice(videoStart + 2);
      const nextHeading = afterVideo.slice("## Video".length).search(/\n\n## /);
      const end = nextHeading >= 0
        ? videoStart + 2 + "## Video".length + nextHeading
        : entry.length;
      const currentSection = entry.slice(videoStart + 2, end).trim();
      if (currentSection === nextSection.trim()) {
        return entry;
      }
      return `${entry.slice(0, videoStart + 2)}${nextSection}${entry.slice(end)}`;
    }

    const insertBefore = entry.search(/\n\n## (Quote Tweet|In Reply To|Article)\b/);
    const insertAt = insertBefore >= 0 ? insertBefore : entry.length;
    const prefix = entry.slice(0, insertAt).trimEnd();
    const suffix = entry.slice(insertAt);
    return `${prefix}\n\n${nextSection}${suffix}`;
  }

  function replaceQuoteArticleSection(entry, tweet) {
    if (!tweet.quote_tweet?.article_card) {
      return entry;
    }

    const article = buildArticleSection({
      article_card: tweet.quote_tweet.article_card,
      article_url: tweet.quote_tweet.article_card.url
    });
    if (!article) {
      return entry;
    }

    const quotedArticle = article.split("\n").map((line) => `> ${line}`).join("\n");
    const quoteStart = entry.search(/\n\n## Quote Tweet\b/);
    if (quoteStart < 0) {
      return entry;
    }

    const afterQuote = entry.slice(quoteStart + 2);
    const nextHeading = afterQuote.slice("## Quote Tweet".length).search(/\n\n## /);
    const quoteEnd = nextHeading >= 0
      ? quoteStart + 2 + "## Quote Tweet".length + nextHeading
      : entry.length;
    const quoteSection = entry.slice(quoteStart, quoteEnd);
    if (quoteSection.includes("> ## Article") || quoteSection.includes(tweet.quote_tweet.article_card.title || "__never__")) {
      return entry;
    }

    return `${entry.slice(0, quoteEnd).trimEnd()}\n${quotedArticle}${entry.slice(quoteEnd)}`;
  }

  function replaceMonthlyEntryText(existingMarkdown, tweet, articleId = "", savedAssets = {}) {
    if (!existingMarkdown || !tweet || !tweet.tweet_id) {
      return existingMarkdown;
    }

    const range = findEntryRange(existingMarkdown, tweet.tweet_id);
    if (!range) {
      return existingMarkdown;
    }

    const entry = existingMarkdown.slice(range.start, range.end);
    const textEntry = replaceBodyText(entry, tweet.text || "");
    const videoEntry = replaceVideoSection(textEntry, tweet, savedAssets);
    const articleEntry = replaceArticleSection(videoEntry, tweet, articleId);
    const nextEntry = replaceQuoteArticleSection(articleEntry, tweet);
    if (nextEntry === entry) {
      return existingMarkdown;
    }
    return `${existingMarkdown.slice(0, range.start)}${nextEntry}${existingMarkdown.slice(range.end)}`;
  }

  function buildArticleMarkdown(article) {
    const author = article.author_handle ? `@${article.author_handle.replace(/^@/, "")}` : "";
    return `${frontmatter({
      article_id: yamlString(article.article_id),
      author: yamlString(author),
      author_name: yamlString(article.author_name || ""),
      date: article.date || "",
      url: article.url || "",
      type: "twitter-article",
      tags: ["twitter-article"]
    })}# ${article.title || "Twitter Article"}\n\n${article.content || ""}\n`;
  }

  self.TwitterLikesMarkdown = {
    buildTweetMarkdown,
    buildMonthlyHeader,
    buildMonthlyTweetEntry,
    insertMonthlyEntry,
    replaceMonthlyEntryText,
    findMonthlyEntry,
    buildArticleMarkdown
  };
})();
