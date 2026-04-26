(function () {
  function textFrom(element) {
    return element ? element.innerText.trim() : "";
  }

  function absoluteUrl(href) {
    try {
      return new URL(href, "https://x.com").toString();
    } catch (_) {
      return "";
    }
  }

  function getStatusLink(tweetElement) {
    const anchors = Array.from(tweetElement.querySelectorAll('a[href*="/status/"]'));
    return anchors.find((anchor) => /\/status\/\d+/.test(anchor.getAttribute("href") || "")) || null;
  }

  function parseTweetId(url) {
    const match = String(url || "").match(/\/status\/(\d+)/);
    return match ? match[1] : "";
  }

  function parseHandleFromStatusUrl(url) {
    const match = String(url || "").match(/(?:x\.com|twitter\.com|^)\/?([^/?#]+)\/status\/\d+/);
    return match ? match[1] : "";
  }

  function normalizeImageUrl(src) {
    if (!src) {
      return "";
    }
    try {
      const url = new URL(src);
      if (url.hostname === "pbs.twimg.com" && url.pathname.includes("/media/")) {
        const format = url.searchParams.get("format") || "jpg";
        url.search = "";
        url.searchParams.set("format", format);
        url.searchParams.set("name", "large");
      }
      return url.toString();
    } catch (_) {
      return src;
    }
  }

  function extractAuthor(tweetElement, statusUrl) {
    const handle = parseHandleFromStatusUrl(statusUrl);
    const userNameBlock = tweetElement.querySelector('[data-testid="User-Name"]');
    const lines = textFrom(userNameBlock).split("\n").map((line) => line.trim()).filter(Boolean);
    const visibleHandle = lines.find((line) => line.startsWith("@"));
    const authorName = lines.find((line) => !line.startsWith("@") && !line.match(/^\d+[smhd]$/i)) || "";

    return {
      author_handle: (handle || (visibleHandle ? visibleHandle.slice(1) : "")).replace(/^@/, ""),
      author_name: authorName
    };
  }

  function extractText(tweetElement) {
    const textElement = tweetElement.querySelector('[data-testid="tweetText"]');
    if (!textElement) {
      return "";
    }

    const clone = textElement.cloneNode(true);
    clone.querySelectorAll("a").forEach((anchor) => {
      const expanded = anchor.getAttribute("title") || anchor.getAttribute("aria-label") || anchor.textContent;
      anchor.textContent = expanded || "";
    });
    return clone.innerText.trim();
  }

  function isTextTruncated(tweetElement) {
    return Array.from(tweetElement.querySelectorAll("button, [role='button']"))
      .some((button) => /Show more|显示更多|もっと見る|さらに表示/i.test(button.textContent || ""));
  }

  function expandTweetText(tweetElement) {
    const button = Array.from(tweetElement.querySelectorAll("button, [role='button']"))
      .find((candidate) => /Show more|显示更多|もっと見る|さらに表示/i.test(candidate.textContent || ""));
    if (!button) {
      return false;
    }
    button.click();
    return true;
  }

  function extractImages(tweetElement) {
    const images = [];
    const seen = new Set();
    tweetElement.querySelectorAll('img[src*="pbs.twimg.com/media/"]').forEach((img) => {
      const url = normalizeImageUrl(img.currentSrc || img.src);
      if (url && !seen.has(url)) {
        seen.add(url);
        images.push(url);
      }
    });
    return images.slice(0, 4);
  }

  function extractVideoThumbnail(tweetElement) {
    const img = tweetElement.querySelector('[data-testid="videoPlayer"] img, [data-testid="videoComponent"] img');
    if (img) {
      return normalizeImageUrl(img.currentSrc || img.src);
    }

    const video = tweetElement.querySelector("video[poster]");
    return video ? normalizeImageUrl(video.getAttribute("poster")) : "";
  }

  function hasVideo(tweetElement) {
    return Boolean(
      tweetElement.querySelector('[data-testid="videoPlayer"], [data-testid="videoComponent"], video') ||
      Array.from(tweetElement.querySelectorAll("[aria-label]"))
        .some((element) => /embedded video|play video|video/i.test(element.getAttribute("aria-label") || ""))
    );
  }

  function extractReplyTo(tweetElement) {
    const replying = Array.from(tweetElement.querySelectorAll("span"))
      .find((span) => /Replying to/i.test(span.textContent || ""));
    if (!replying) {
      return null;
    }
    const link = replying.closest("div")?.querySelector('a[href*="/status/"], a[href^="/"]');
    const href = link ? absoluteUrl(link.getAttribute("href")) : "";
    const handle = textFrom(replying.closest("div")).match(/@[\w_]+/)?.[0] || "";
    return handle || href ? { author_handle: handle.replace(/^@/, ""), url: href } : null;
  }

  function extractArticleUrl(tweetElement) {
    return extractArticleCard(tweetElement)?.url || "";
  }

  function cleanCardLine(line) {
    return String(line || "")
      .replace(/^From\s+/i, "")
      .trim();
  }

  function uniqueLines(text) {
    const seen = new Set();
    return String(text || "")
      .split("\n")
      .map(cleanCardLine)
      .filter(Boolean)
      .filter((line) => {
        const key = line.toLowerCase();
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }

  function isArticleCardLink(anchor) {
    const href = anchor.getAttribute("href") || "";
    if (/\/i\/article\//.test(href)) {
      return true;
    }
    if (anchor.closest('[data-testid="tweetText"], [data-testid="User-Name"]')) {
      return false;
    }
    if (/\/status\/\d+|\/photo\/\d+|\/analytics|\/compose\//.test(href)) {
      return false;
    }
    const lines = uniqueLines(textFrom(anchor));
    return lines.length >= 2 && lines.some((line) => /\.[a-z]{2,}\b/i.test(line));
  }

  function extractArticleCard(tweetElement) {
    const link = Array.from(tweetElement.querySelectorAll('a[href], [role="link"]'))
      .find((candidate) => {
        const href = candidate.getAttribute("href") || "";
        return href && isArticleCardLink(candidate);
      });
    if (!link) {
      return null;
    }

    const url = absoluteUrl(link.getAttribute("href"));
    const lines = uniqueLines(textFrom(link));
    const domain = lines.find((line) => /\.[a-z]{2,}\b/i.test(line)) || "";
    const title = lines.find((line) => line !== domain && !/^Article$/i.test(line)) || "";
    const description = lines
      .filter((line) => line !== domain && line !== title && !/^Article$/i.test(line))
      .join("\n");

    return {
      url,
      title,
      description,
      domain
    };
  }

  function extractQuoteTweet(tweetElement) {
    const quoteContainer = Array.from(tweetElement.querySelectorAll('[role="link"]'))
      .find((element) => element.querySelector('[data-testid="tweetText"]') && !element.closest('[data-testid="tweetText"]'));
    const articleQuoteContainer = quoteContainer || Array.from(tweetElement.querySelectorAll('[role="link"]'))
      .find((element) => {
        if (element.closest('[data-testid="tweetText"]')) {
          return false;
        }
        const text = textFrom(element);
        return /\bArticle\b|文章|Article cover image/i.test(text) && /@\w+/.test(text);
      });

    if (!articleQuoteContainer) {
      const unavailable = Array.from(tweetElement.querySelectorAll("span"))
        .some((span) => /unavailable/i.test(span.textContent || ""));
      return unavailable ? { unavailable: true } : null;
    }

    const statusLink = articleQuoteContainer.querySelector('a[href*="/status/"]') ||
      (articleQuoteContainer.matches?.('a[href*="/status/"]') ? articleQuoteContainer : null);
    const quoteUrl = statusLink ? absoluteUrl(statusLink.getAttribute("href")) : "";
    const author = extractAuthor(articleQuoteContainer, quoteUrl);
    const articleCard = extractArticleCard(articleQuoteContainer) || extractArticleLikeCard(articleQuoteContainer, quoteUrl);
    return {
      ...author,
      text: extractText(articleQuoteContainer),
      images: extractImages(articleQuoteContainer),
      article_card: articleCard,
      url: quoteUrl
    };
  }

  function extractArticleLikeCard(container, fallbackUrl = "") {
    const lines = uniqueLines(textFrom(container))
      .filter((line) => !/^Quote$|^引用$|^Article cover image$/i.test(line));
    const articleIndex = lines.findIndex((line) => /^Article$|^文章$/i.test(line));
    if (articleIndex < 0) {
      return null;
    }

    const title = lines[articleIndex + 1] || "";
    const description = lines.slice(articleIndex + 2).join("\n");
    if (!title && !description) {
      return null;
    }

    return {
      url: fallbackUrl,
      title,
      description,
      domain: "x.com"
    };
  }

  function extractTweet(tweetElement) {
    const statusLink = getStatusLink(tweetElement);
    if (!statusLink) {
      return null;
    }

    const tweetUrl = absoluteUrl(statusLink.getAttribute("href"));
    const tweetId = parseTweetId(tweetUrl);
    if (!tweetId) {
      return null;
    }

    const author = extractAuthor(tweetElement, tweetUrl);
    const timestamp = tweetElement.querySelector("time")?.getAttribute("datetime") || "";
    const videoThumbnail = extractVideoThumbnail(tweetElement);
    const videoPresent = hasVideo(tweetElement) || Boolean(videoThumbnail);
    const articleCard = extractArticleCard(tweetElement);
    const quoteTweet = extractQuoteTweet(tweetElement);
    const quoteImages = new Set((quoteTweet?.images || []).map(normalizeImageUrl));

    return {
      tweet_id: tweetId,
      ...author,
      timestamp,
      text: extractText(tweetElement),
      text_truncated: isTextTruncated(tweetElement),
      images: extractImages(tweetElement).filter((url) => !quoteImages.has(normalizeImageUrl(url))),
      video_thumbnail: videoThumbnail,
      video_url: videoPresent ? tweetUrl : "",
      quote_tweet: quoteTweet,
      reply_to: extractReplyTo(tweetElement),
      article_url: articleCard?.url || "",
      article_card: articleCard,
      tweet_url: tweetUrl || `https://x.com/${author.author_handle}/status/${tweetId}`
    };
  }

  window.TwitterLikesExtractor = { extractTweet, normalizeImageUrl, expandTweetText };
})();
