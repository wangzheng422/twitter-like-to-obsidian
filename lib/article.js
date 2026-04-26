(function () {
  function articleIdFromUrl(url) {
    const match = String(url || "").match(/\/i\/article\/([^/?#]+)/);
    return match ? match[1] : "";
  }

  function decodeEntities(text) {
    return String(text || "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  function stripTags(html) {
    return decodeEntities(String(html || "").replace(/<[^>]+>/g, " "))
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  function firstMatch(html, pattern) {
    const match = String(html || "").match(pattern);
    return match ? stripTags(match[1]) : "";
  }

  function htmlToMarkdown(html) {
    const blocks = [];
    const blockPattern = /<(h1|h2|h3|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let match;

    while ((match = blockPattern.exec(html))) {
      const tagName = match[1].toUpperCase();
      const text = stripTags(match[2]);
      if (!text) {
        continue;
      }
      if (tagName === "H1") {
        blocks.push(`# ${text}`);
      } else if (tagName === "H2") {
        blocks.push(`## ${text}`);
      } else if (tagName === "H3") {
        blocks.push(`### ${text}`);
      } else if (tagName === "LI") {
        blocks.push(`- ${text}`);
      } else {
        blocks.push(text);
      }
    }

    return blocks.join("\n\n");
  }

  async function fetchArticle(url) {
    const article_id = articleIdFromUrl(url);
    if (!article_id) {
      return null;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Article fetch failed: ${response.status}`);
    }
    const html = await response.text();
    const cleanHtml = html
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "");
    const articleHtml = cleanHtml.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] || cleanHtml;
    const title = firstMatch(cleanHtml, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ||
      firstMatch(cleanHtml, /<title\b[^>]*>([\s\S]*?)<\/title>/i) ||
      "Twitter Article";

    return {
      article_id,
      title,
      author_handle: "",
      author_name: "",
      date: cleanHtml.match(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/i)?.[1] || "",
      url,
      content: htmlToMarkdown(articleHtml)
    };
  }

  self.TwitterArticle = { articleIdFromUrl, fetchArticle };
})();
