(() => {
  const state = {
    enabled: true,
    working: false,
    imageIndex: new Map(),
    translatedByOriginalUrl: new Map()
  };

  const CLASS_OVERLAY = "mit-progress";

  function normalizeImageUrl(url) {
    try {
      const u = new URL(url, location.href);
      u.hash = "";
      return u.toString();
    } catch {
      return url;
    }
  }

  function ensureImageId(img) {
    if (!img.dataset.mitImageId) {
      img.dataset.mitImageId = crypto.randomUUID();
    }
    state.imageIndex.set(img.dataset.mitImageId, img);
    return img.dataset.mitImageId;
  }

  function installOriginalSnapshot(img) {
    if (!img.dataset.mitOriginalSrc) {
      img.dataset.mitOriginalSrc = img.currentSrc || img.src;
    }
    const id = ensureImageId(img);
    const key = normalizeImageUrl(img.dataset.mitOriginalSrc);
    state.translatedByOriginalUrl.set(key, id);
  }

  function setProgress(img, text) {
    let overlay = img.parentElement?.querySelector(`.${CLASS_OVERLAY}[data-image-id="${img.dataset.mitImageId}"]`);
    const parent = img.parentElement;
    if (!parent) return;

    const computed = getComputedStyle(parent);
    if (computed.position === "static") {
      parent.style.position = "relative";
    }

    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = CLASS_OVERLAY;
      overlay.dataset.imageId = img.dataset.mitImageId;
      parent.appendChild(overlay);
    }
    overlay.textContent = text;
    overlay.hidden = false;
  }

  function clearProgress(img) {
    const overlay = img.parentElement?.querySelector(`.${CLASS_OVERLAY}[data-image-id="${img.dataset.mitImageId}"]`);
    if (overlay) overlay.hidden = true;
  }

  async function getUtils() {
    return import(chrome.runtime.getURL("utils.js"));
  }

  async function getSettings() {
    const utils = await getUtils();
    const raw = await chrome.storage.sync.get(utils.DEFAULT_SETTINGS);
    return { ...utils.DEFAULT_SETTINGS, ...raw };
  }

  async function ensureOffscreen() {
    await chrome.runtime.sendMessage({ type: "MIT_ENSURE_OFFSCREEN" });
  }

  async function translateOne(img) {
    installOriginalSnapshot(img);
    const imageId = ensureImageId(img);
    const settings = await getSettings();

    setProgress(img, "Preparing…");
    await ensureOffscreen();

    const url = img.currentSrc || img.src;
    const request = {
      type: "MIT_PROCESS_IMAGE",
      imageId,
      tabId: undefined,
      imageUrl: url,
      settings,
      pageUrl: location.href
    };

    const result = await chrome.runtime.sendMessage(request);
    if (!result?.ok || !result.dataUrl) {
      throw new Error(result?.error || "Translation failed");
    }

    img.dataset.mitTranslated = "1";
    img.dataset.mitTranslatedSrc = result.dataUrl;
    img.src = result.dataUrl;
    img.srcset = "";
    clearProgress(img);
  }

  async function translatePage() {
    if (state.working) return;
    const settings = await getSettings();
    if (!settings.enabled) return;

    state.working = true;
    const utils = await getUtils();
    const all = [...document.images].filter((img) => img.complete && utils.likelyMangaImage(img));
    for (const img of all) {
      try {
        await translateOne(img);
      } catch (error) {
        setProgress(img, `Error: ${error.message}`);
      }
    }
    state.working = false;
  }

  function imageByUrl(url) {
    const key = normalizeImageUrl(url);
    const id = state.translatedByOriginalUrl.get(key);
    if (id) return state.imageIndex.get(id) || null;

    const imgs = [...document.images];
    return imgs.find((img) => normalizeImageUrl(img.currentSrc || img.src) === key) || null;
  }

  function revertImage(img) {
    if (!img?.dataset?.mitOriginalSrc) return false;
    img.src = img.dataset.mitOriginalSrc;
    img.srcset = "";
    img.dataset.mitTranslated = "0";
    clearProgress(img);
    return true;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      switch (msg?.type) {
        case "MIT_TRANSLATE_PAGE":
          await translatePage();
          sendResponse({ ok: true });
          return;
        case "MIT_TRANSLATE_ONE_BY_URL": {
          const img = imageByUrl(msg.srcUrl);
          if (!img) {
            sendResponse({ ok: false, error: "Image not found on page." });
            return;
          }
          await translateOne(img);
          sendResponse({ ok: true });
          return;
        }
        case "MIT_REVERT_ONE_BY_URL": {
          const img = imageByUrl(msg.srcUrl);
          sendResponse({ ok: revertImage(img) });
          return;
        }
        case "MIT_IMAGE_PROGRESS": {
          const img = state.imageIndex.get(msg.imageId);
          if (img) setProgress(img, `${msg.stage}${msg.detail ? `: ${msg.detail}` : ""}`);
          sendResponse({ ok: true });
          return;
        }
        default:
          sendResponse({ ok: false, ignored: true });
      }
    })().catch((error) => {
      sendResponse({ ok: false, error: error.message || String(error) });
    });
    return true;
  });
})();
