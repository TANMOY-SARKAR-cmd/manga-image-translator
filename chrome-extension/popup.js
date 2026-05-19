import { DEFAULT_SETTINGS } from "./utils.js";

const els = {
  enabled: document.getElementById("enabled"),
  targetLang: document.getElementById("targetLang"),
  inpainting: document.getElementById("inpainting"),
  maxWidth: document.getElementById("maxWidth"),
  removeTextMode: document.getElementById("removeTextMode"),
  translatePage: document.getElementById("translatePage"),
  clearCache: document.getElementById("clearCache"),
  status: document.getElementById("status")
};

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.style.color = isError ? "#b91c1c" : "#334155";
}

async function loadSettings() {
  const s = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  els.enabled.checked = !!s.enabled;
  els.targetLang.value = s.targetLang;
  els.inpainting.checked = !!s.inpainting;
  els.maxWidth.value = String(s.maxWidth);
  els.removeTextMode.value = s.removeTextMode || "remove";
}

async function saveSettings() {
  const next = {
    enabled: els.enabled.checked,
    targetLang: els.targetLang.value,
    inpainting: els.inpainting.checked,
    maxWidth: Number(els.maxWidth.value),
    removeTextMode: els.removeTextMode.value
  };
  await chrome.storage.sync.set(next);
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

for (const key of ["enabled", "targetLang", "inpainting", "maxWidth", "removeTextMode"]) {
  els[key].addEventListener("change", async () => {
    try {
      await saveSettings();
      setStatus("Settings saved.");
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  });
}

els.translatePage.addEventListener("click", async () => {
  try {
    const tabId = await getActiveTabId();
    await saveSettings();
    const resp = await chrome.runtime.sendMessage({ type: "MIT_POPUP_TRANSLATE_PAGE", tabId });
    if (!resp?.ok) throw new Error(resp?.error || "Unable to start translation.");
    setStatus("Started translation on this page.");
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
});

els.clearCache.addEventListener("click", async () => {
  try {
    const resp = await chrome.runtime.sendMessage({ type: "MIT_CLEAR_CACHES" });
    if (!resp?.ok) throw new Error(resp?.error || "Failed to clear cache.");
    setStatus("Cached models and outputs cleared.");
  } catch (error) {
    setStatus(error.message || String(error), true);
  }
});

loadSettings().catch((error) => setStatus(error.message || String(error), true));
