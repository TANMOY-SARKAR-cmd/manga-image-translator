import { DEFAULT_SETTINGS, clearAllCaches } from "./utils.js";

const OFFSCREEN_URL = "offscreen.html";
const IDLE_MS = 5 * 60 * 1000;
let lastPipelineUseAt = 0;
let creatingOffscreen = null;

async function hasOffscreen() {
  if (!chrome.runtime.getContexts) return false;
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreen()) return;
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["BLOBS"],
    justification: "Need DOM canvas/WebGPU for local image translation pipeline."
  }).finally(() => {
    creatingOffscreen = null;
  });
  await creatingOffscreen;
}

async function closeOffscreenIfIdle() {
  const idle = Date.now() - lastPipelineUseAt > IDLE_MS;
  if (!idle) return;
  if (await hasOffscreen()) {
    await chrome.offscreen.closeDocument();
  }
}

async function sendToTab(tabId, payload) {
  try {
    await chrome.tabs.sendMessage(tabId, payload);
  } catch {
    // Ignore tabs that cannot receive messages.
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.sync.set(DEFAULT_SETTINGS);

  chrome.contextMenus.create({
    id: "mit-translate-image",
    title: "Translate this manga image",
    contexts: ["image"]
  });
  chrome.contextMenus.create({
    id: "mit-revert-image",
    title: "Revert translated image",
    contexts: ["image"]
  });
  chrome.contextMenus.create({
    id: "mit-translate-page",
    title: "Translate manga images on this page",
    contexts: ["page", "action"]
  });

  chrome.alarms.create("mit-offscreen-idle-check", { periodInMinutes: 1 });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  await sendToTab(tab.id, { type: "MIT_TRANSLATE_PAGE" });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === "mit-translate-page") {
    await sendToTab(tab.id, { type: "MIT_TRANSLATE_PAGE" });
    return;
  }
  if (info.menuItemId === "mit-translate-image" && info.srcUrl) {
    await sendToTab(tab.id, {
      type: "MIT_TRANSLATE_ONE_BY_URL",
      srcUrl: info.srcUrl
    });
    return;
  }
  if (info.menuItemId === "mit-revert-image" && info.srcUrl) {
    await sendToTab(tab.id, {
      type: "MIT_REVERT_ONE_BY_URL",
      srcUrl: info.srcUrl
    });
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "mit-offscreen-idle-check") {
    await closeOffscreenIfIdle();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "MIT_ENSURE_OFFSCREEN": {
        await ensureOffscreenDocument();
        sendResponse({ ok: true });
        return;
      }
      case "MIT_PIPELINE_USED": {
        lastPipelineUseAt = Date.now();
        sendResponse({ ok: true });
        return;
      }
      case "MIT_CLEAR_CACHES": {
        await clearAllCaches();
        if (await hasOffscreen()) {
          await chrome.offscreen.closeDocument();
        }
        sendResponse({ ok: true });
        return;
      }
      case "MIT_POPUP_TRANSLATE_PAGE": {
        if (!msg.tabId) {
          sendResponse({ ok: false, error: "No active tab." });
          return;
        }
        await sendToTab(msg.tabId, { type: "MIT_TRANSLATE_PAGE" });
        sendResponse({ ok: true });
        return;
      }
      case "MIT_OFFSCREEN_PROGRESS": {
        const tabId = msg.tabId ?? sender.tab?.id;
        if (tabId) {
          await sendToTab(tabId, {
            type: "MIT_IMAGE_PROGRESS",
            imageId: msg.imageId,
            stage: msg.stage,
            detail: msg.detail || ""
          });
        }
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
