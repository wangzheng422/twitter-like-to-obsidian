(function () {
  const STORAGE_KEY = "pendingTweets";

  function storageGet(keys) {
    return chrome.storage.local.get(keys);
  }

  function storageSet(values) {
    return chrome.storage.local.set(values);
  }

  async function all() {
    const data = await storageGet({ [STORAGE_KEY]: [] });
    return data[STORAGE_KEY] || [];
  }

  async function add(tweet) {
    const queue = await all();
    if (!queue.some((item) => item.tweet_id === tweet.tweet_id)) {
      queue.push({
        tweet_id: tweet.tweet_id,
        data: tweet,
        queued_at: new Date().toISOString(),
        retry_count: 0
      });
      await storageSet({ [STORAGE_KEY]: queue });
    }
    return queue.length;
  }

  async function replace(queue) {
    await storageSet({ [STORAGE_KEY]: queue });
    return queue.length;
  }

  async function count() {
    return (await all()).length;
  }

  self.TwitterLikesQueue = { all, add, replace, count };
})();
