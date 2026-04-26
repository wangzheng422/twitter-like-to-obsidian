const apiKeyInput = document.querySelector("#apiKey");
const form = document.querySelector("#apiKeyForm");
const statusPill = document.querySelector("#statusPill");
const savedCount = document.querySelector("#savedCount");
const capturedCount = document.querySelector("#capturedCount");
const queuedCount = document.querySelector("#queuedCount");
const retryButton = document.querySelector("#retryButton");
const scanButton = document.querySelector("#scanButton");
const resetStatsButton = document.querySelector("#resetStatsButton");
const settingsLink = document.querySelector("#settingsLink");
const pageState = document.querySelector("#pageState");
const pageDetail = document.querySelector("#pageDetail");

function message(payload) {
  return chrome.runtime.sendMessage(payload);
}

async function refresh() {
  const status = await message({ type: "status:get" });
  statusPill.textContent = status.connected ? "Connected" : "Disconnected";
  statusPill.classList.toggle("connected", status.connected);
  statusPill.classList.toggle("disconnected", !status.connected);
  savedCount.textContent = status.stats?.saved || 0;
  capturedCount.textContent = status.stats?.captured || 0;
  queuedCount.textContent = status.queued || 0;
  retryButton.disabled = !status.queued;
  apiKeyInput.placeholder = status.apiKeySet ? "API key saved" : "Paste API key";

  if (status.content?.active && status.content.likesPage) {
    pageState.textContent = "Likes page detected";
    pageDetail.textContent = `Found ${status.content.lastScanCount || 0} visible tweet(s), processed ${status.content.processed || 0}.`;
  } else if (status.content?.active) {
    pageState.textContent = "Page script active";
    pageDetail.textContent = "Open an X/Twitter likes page to start capturing.";
  } else {
    pageState.textContent = "Page script inactive";
    pageDetail.textContent = "Click Scan Page, or reload the X likes tab after updating the extension.";
  }

  if (status.content?.lastError) {
    pageDetail.textContent = status.content.lastError;
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function injectAndScan() {
  const tab = await activeTab();
  if (!tab?.id || !/^https:\/\/(x|twitter)\.com\//.test(tab.url || "")) {
    pageState.textContent = "Open X first";
    pageDetail.textContent = "Scan works on x.com or twitter.com likes pages.";
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["lib/extractor.js", "content.js"]
  });

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "content:scan" });
  } catch (_) {
    // The injected content script also scans on startup.
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const apiKey = apiKeyInput.value.trim();
  if (apiKey) {
    await chrome.storage.sync.set({ apiKey });
    apiKeyInput.value = "";
  }
  await refresh();
});

retryButton.addEventListener("click", async () => {
  retryButton.disabled = true;
  await message({ type: "queue:retry" });
  await refresh();
});

resetStatsButton.addEventListener("click", async () => {
  resetStatsButton.disabled = true;
  await message({ type: "stats:reset" });
  await refresh();
  resetStatsButton.disabled = false;
});

scanButton.addEventListener("click", async () => {
  scanButton.disabled = true;
  try {
    await injectAndScan();
  } finally {
    window.setTimeout(async () => {
      scanButton.disabled = false;
      await refresh();
    }, 600);
  }
});

settingsLink.addEventListener("click", (event) => {
  event.preventDefault();
  pageState.textContent = "Settings are inline";
  pageDetail.textContent = "API key, retry, and scan controls are managed in this popup.";
});

refresh();
window.setInterval(refresh, 3000);
