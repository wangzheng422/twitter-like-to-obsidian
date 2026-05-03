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

  async function tweetExists(tweetId, apiKey) {
    return self.ObsidianApi.exists(`wzh-twitter/${tweetId}.md`, apiKey);
  }

  function monthPathFromTweet(tweet) {
    const date = dateFromTweet(tweet);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    return `wzh-twitter/monthly/${year}/${year}-${month}.md`;
  }

  async function monthlyTweetExists(tweet, apiKey) {
    const markdown = await self.ObsidianApi.getText(monthPathFromTweet(tweet), apiKey);
    if (!markdown) {
      return false;
    }
    const marker = `<!-- tweet_id: ${tweet.tweet_id} -->`;
    return markdown.includes(marker) || markdown.includes(`tweet_id: "${tweet.tweet_id}"`);
  }

  async function articleExists(articleId, apiKey) {
    return self.ObsidianApi.exists(`wzh-twitter/articles/${articleId}.md`, apiKey);
  }

  self.TwitterLikesDedup = { tweetExists, monthPathFromTweet, monthlyTweetExists, articleExists, dateFromTweet };
})();
