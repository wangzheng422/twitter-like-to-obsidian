(function () {
  const BASE_URL = "http://127.0.0.1:27123";

  function headers(apiKey, contentType) {
    const result = {};
    if (apiKey) {
      result.Authorization = `Bearer ${apiKey}`;
    }
    if (contentType) {
      result["Content-Type"] = contentType;
    }
    return result;
  }

  function vaultUrl(path) {
    return `${BASE_URL}/vault/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  async function health(apiKey) {
    const response = await fetch(`${BASE_URL}/`, { headers: headers(apiKey) });
    return response.ok;
  }

  async function exists(path, apiKey) {
    const response = await fetch(vaultUrl(path), { headers: headers(apiKey) });
    if (response.status === 200) {
      return true;
    }
    if (response.status === 404) {
      return false;
    }
    throw new Error(`Obsidian exists check failed: ${response.status}`);
  }

  async function getText(path, apiKey) {
    const response = await fetch(vaultUrl(path), { headers: headers(apiKey) });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Obsidian text fetch failed: ${response.status}`);
    }
    return response.text();
  }

  async function putMarkdown(path, markdown, apiKey) {
    const response = await fetch(vaultUrl(path), {
      method: "PUT",
      headers: headers(apiKey, "text/markdown"),
      body: markdown
    });
    if (!response.ok) {
      throw new Error(`Obsidian markdown save failed: ${response.status}`);
    }
  }

  async function putBinary(path, data, contentType, apiKey) {
    const response = await fetch(vaultUrl(path), {
      method: "PUT",
      headers: headers(apiKey, contentType || "application/octet-stream"),
      body: data
    });
    if (!response.ok) {
      throw new Error(`Obsidian asset save failed: ${response.status}`);
    }
  }

  self.ObsidianApi = { health, exists, getText, putMarkdown, putBinary };
})();
