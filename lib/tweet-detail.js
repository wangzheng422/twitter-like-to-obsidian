(function () {
  const DETAIL_TIMEOUT_MS = 10000;

  function decodeHtmlEntities(text) {
    return String(text || "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, "/");
  }

  function decodeJsonString(raw) {
    try {
      return JSON.parse(`"${raw}"`);
    } catch (_) {
      return raw
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
  }

  function cleanText(text) {
    return decodeHtmlEntities(text)
      .replace(/\r\n/g, "\n")
      .replace(/\u2026$/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
  }

  function textPrefix(text) {
    return cleanText(text)
      .replace(/\s+/g, " ")
      .slice(0, 40);
  }

  function candidateScore(candidate, currentText) {
    const currentPrefix = textPrefix(currentText);
    const candidateFlat = candidate.replace(/\s+/g, " ");
    let score = candidate.length;
    if (currentPrefix && candidateFlat.includes(currentPrefix)) {
      score += 10000;
    }
    return score;
  }

  function pushCandidate(candidates, raw) {
    const text = cleanText(raw);
    if (!text || text.length < 2) {
      return;
    }
    if (/JavaScript is not available|Don.t miss what.s happening/i.test(text)) {
      return;
    }
    if (!candidates.includes(text)) {
      candidates.push(text);
    }
  }

  function htmlMetaCandidates(html, candidates) {
    const metaRegex = /<meta\s+[^>]*(?:name|property)=["'](?:description|og:description|twitter:description)["'][^>]*content=["']([^"']+)["'][^>]*>/gi;
    let match = metaRegex.exec(html);
    while (match) {
      pushCandidate(candidates, match[1]);
      match = metaRegex.exec(html);
    }
  }

  function jsonFieldCandidates(text, candidates) {
    const regexes = [
      /"full_text"\s*:\s*"((?:\\.|[^"\\])*)"/g,
      /"note_tweet_results"\s*:\s*\{[\s\S]{0,8000}?"text"\s*:\s*"((?:\\.|[^"\\])*)"/g,
      /"tweet_text"\s*:\s*"((?:\\.|[^"\\])*)"/g
    ];

    regexes.forEach((regex) => {
      let match = regex.exec(text);
      while (match) {
        pushCandidate(candidates, decodeJsonString(match[1]));
        match = regex.exec(text);
      }
    });
  }

  function relevantHtmlWindows(html, tweetId) {
    if (!tweetId || !html.includes(tweetId)) {
      return [html];
    }

    const windows = [];
    let index = html.indexOf(tweetId);
    while (index >= 0) {
      windows.push(html.slice(Math.max(0, index - 12000), Math.min(html.length, index + 12000)));
      index = html.indexOf(tweetId, index + tweetId.length);
    }
    return windows;
  }

  function extractFullTextFromHtml(html, tweet) {
    const candidates = [];
    htmlMetaCandidates(html, candidates);
    relevantHtmlWindows(html, tweet.tweet_id).forEach((windowText) => {
      jsonFieldCandidates(windowText, candidates);
    });

    if (!candidates.length) {
      return "";
    }

    candidates.sort((a, b) => candidateScore(b, tweet.text || "") - candidateScore(a, tweet.text || ""));
    const best = candidates[0];
    return best && best.length > String(tweet.text || "").trim().length ? best : "";
  }

  async function fetchText(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DETAIL_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...options,
        credentials: "include",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/json",
          ...(options.headers || {})
        }
      });
      if (!response.ok) {
        return "";
      }
      return response.text();
    } catch (_) {
      return "";
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchFullText(tweet) {
    if (!tweet.tweet_url || !tweet.tweet_id) {
      return "";
    }

    const html = await fetchText(tweet.tweet_url);
    const fullText = html ? extractFullTextFromHtml(html, tweet) : "";
    if (fullText) {
      return fullText;
    }

    const syndication = await fetchText(`https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(tweet.tweet_id)}&lang=en`, {
      headers: { Accept: "application/json" }
    });
    if (!syndication) {
      return "";
    }
    try {
      const data = JSON.parse(syndication);
      return cleanText(data.text || "");
    } catch (_) {
      return "";
    }
  }

  async function enrichTweet(tweet) {
    const currentText = String(tweet.text || "").trim();
    const likelyTruncated = Boolean(tweet.text_truncated) || /…$|\.\.\.$/.test(currentText);
    if (!likelyTruncated && currentText.length >= 280) {
      return tweet;
    }

    const fullText = await fetchFullText(tweet);
    if (fullText && fullText.length > currentText.length) {
      return { ...tweet, text: fullText, text_truncated: false };
    }
    return tweet;
  }

  self.TwitterTweetDetail = { enrichTweet, extractFullTextFromHtml };
})();
