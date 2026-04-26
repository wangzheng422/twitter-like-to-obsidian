(function () {
  function pickBestMp4(variants = []) {
    return variants
      .map((variant) => ({
        url: variant.src || variant.url || "",
        contentType: variant.type || variant.content_type || "",
        bitrate: Number(variant.bitrate || 0)
      }))
      .filter((variant) => variant.url && /video\/mp4/i.test(variant.contentType))
      .sort((a, b) => b.bitrate - a.bitrate)[0]?.url || "";
  }

  function mediaDetailVariants(data) {
    return (data.mediaDetails || [])
      .filter((media) => media.type === "video" || media.type === "animated_gif")
      .flatMap((media) => media.video_info?.variants || []);
  }

  async function fetchVideo(tweet) {
    if (!tweet?.tweet_id) {
      return {};
    }

    const response = await fetch(
      `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(tweet.tweet_id)}&lang=en`,
      { headers: { Accept: "application/json" } }
    );
    if (!response.ok) {
      return {};
    }

    const data = await response.json();
    const directUrl = pickBestMp4(data.video?.variants || []) || pickBestMp4(mediaDetailVariants(data));
    if (!directUrl) {
      return {};
    }

    return {
      video_direct_url: directUrl,
      video_thumbnail: tweet.video_thumbnail || data.video?.poster || data.mediaDetails?.[0]?.media_url_https || "",
      video_duration_ms: data.video?.durationMs || data.mediaDetails?.[0]?.video_info?.duration_millis || 0
    };
  }

  self.TwitterVideo = { fetchVideo };
})();
