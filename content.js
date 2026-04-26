(function () {
  if (window.__TwitterLikesObsidianRunning) {
    window.__TwitterLikesObsidianScan?.();
    return;
  }
  window.__TwitterLikesObsidianRunning = true;

  const processedTweetIds = new Set();
  let observer = null;
  let scanTimer = null;
  let lastScanCount = 0;
  const startupScanDelays = [300, 1000, 2500, 5000];
  const expandingTweetElements = new WeakSet();

  function isLikesPage() {
    return /^\/[^/]+\/likes\/?$/.test(window.location.pathname) ||
      /\/likes\/?$/.test(window.location.pathname);
  }

  function findTimelineRoot() {
    return document.querySelector('[aria-label*="Timeline"]') ||
      document.querySelector('main [data-testid="primaryColumn"]') ||
      document.querySelector("main") ||
      document.body;
  }

  function safeSendMessage(message, callback) {
    try {
      if (!chrome?.runtime?.id) {
        return;
      }

      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          callback?.(undefined, error);
          return;
        }
        callback?.(response, null);
      });
    } catch (_) {
      // Old content scripts can survive extension reloads; ignore stale contexts.
    }
  }

  function sendTweet(tweet) {
    safeSendMessage({ type: "stats:captured" });
    safeSendMessage({ type: "tweet:captured", tweet }, (response, error) => {
      if (error) {
        safeSendMessage({
          type: "content:error",
          error: error.message
        });
        return;
      }
      if (response && response.error) {
        safeSendMessage({ type: "content:error", error: response.error });
      }
    });
  }

  function extractNewTweet(tweetElement) {
    if (!expandingTweetElements.has(tweetElement) &&
      window.TwitterLikesExtractor.expandTweetText(tweetElement)) {
      expandingTweetElements.add(tweetElement);
      window.setTimeout(() => scanForTweets(document), 800);
      return null;
    }

    const tweet = window.TwitterLikesExtractor.extractTweet(tweetElement);
    if (!tweet || !tweet.tweet_id || processedTweetIds.has(tweet.tweet_id)) {
      return null;
    }
    processedTweetIds.add(tweet.tweet_id);
    return tweet;
  }

  function scanForTweets(root = document) {
    if (!isLikesPage()) {
      reportState();
      return;
    }
    const tweets = [];
    const tweetSelector = '[data-testid="tweet"], article[role="article"]';
    if (root.nodeType === Node.ELEMENT_NODE && root.matches?.(tweetSelector)) {
      tweets.push(root);
    }
    root.querySelectorAll?.(tweetSelector).forEach((tweetElement) => tweets.push(tweetElement));
    lastScanCount = tweets.length;
    tweets
      .map(extractNewTweet)
      .filter(Boolean)
      .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0))
      .forEach(sendTweet);
    reportState();
  }

  window.__TwitterLikesObsidianScan = () => scanForTweets(document);

  function scheduleScan(root) {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => scanForTweets(root || document), 150);
  }

  function scheduleStartupScans() {
    startupScanDelays.forEach((delay) => {
      window.setTimeout(() => {
        if (isLikesPage()) {
          scanForTweets(document);
        }
      }, delay);
    });
  }

  function startObserver() {
    if (!isLikesPage()) {
      stopObserver();
      return;
    }

    const root = findTimelineRoot();
    if (!root || observer) {
      scanForTweets();
      return;
    }

    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            scheduleScan(node);
          }
        }
      }
    });

    observer.observe(root, { childList: true, subtree: true });
    scanForTweets(root);
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function reportState() {
    safeSendMessage({
      type: "content:active",
      url: window.location.href,
      likesPage: isLikesPage(),
      processed: processedTweetIds.size,
      lastScanCount
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "content:scan") {
      scanForTweets(document);
      sendResponse({
        ok: true,
        likesPage: isLikesPage(),
        processed: processedTweetIds.size,
        lastScanCount
      });
    }
    return false;
  });

  let lastPath = window.location.pathname;
  window.setInterval(() => {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      if (isLikesPage()) {
        startObserver();
        scheduleStartupScans();
      } else {
        stopObserver();
      }
    }
  }, 1000);

  window.setInterval(reportState, 5000);
  window.setInterval(() => {
    if (isLikesPage()) {
      scanForTweets(document);
    }
  }, 3000);
  window.addEventListener("scroll", () => {
    if (isLikesPage()) {
      scheduleScan(document);
    }
  }, { passive: true });
  window.addEventListener("focus", () => {
    if (isLikesPage()) {
      scheduleScan(document);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && isLikesPage()) {
      scheduleScan(document);
    }
  });
  startObserver();
  scheduleStartupScans();
  reportState();
})();
