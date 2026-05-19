export const DEFAULT_SETTINGS = {
  enabled: true,
  targetLang: "eng_Latn",
  sourceLang: "jpn_Jpan",
  inpainting: true,
  inpaintMode: "auto",
  maxWidth: 1280,
  removeTextMode: "remove"
};

const IDB_NAME = "mit-local-cache";
const IDB_VERSION = 1;
const STORE_MODELS = "models";
const STORE_TRANSLATED = "translatedImages";

export async function getSettings() {
  const data = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...data };
}

export async function setSettings(next) {
  await chrome.storage.sync.set(next);
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MODELS)) {
        db.createObjectStore(STORE_MODELS, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORE_TRANSLATED)) {
        db.createObjectStore(STORE_TRANSLATED, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllCaches() {
  await Promise.all([idbClear(STORE_MODELS), idbClear(STORE_TRANSLATED)]);
  if (typeof caches !== "undefined") {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("mit-")).map(k => caches.delete(k)));
  }
}

export async function fetchAndCacheModel(url, cacheKey) {
  const modelKey = cacheKey || url;
  const existing = await idbGet(STORE_MODELS, modelKey);
  if (existing?.buffer) {
    return existing.buffer;
  }

  const res = await fetch(url, { cache: "force-cache", mode: "cors" });
  if (!res.ok) {
    throw new Error(`Failed model download (${res.status}): ${url}`);
  }
  const buffer = await res.arrayBuffer();
  await idbPut(STORE_MODELS, {
    key: modelKey,
    buffer,
    size: buffer.byteLength,
    updatedAt: Date.now(),
    url
  });
  return buffer;
}

export async function getCachedTranslation(hashKey) {
  const row = await idbGet(STORE_TRANSLATED, hashKey);
  return row?.dataUrl || null;
}

export async function setCachedTranslation(hashKey, dataUrl, meta = {}) {
  await idbPut(STORE_TRANSLATED, {
    key: hashKey,
    dataUrl,
    updatedAt: Date.now(),
    meta
  });
}

export async function hashString(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function likelyMangaImage(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return false;
  if (w < 320 || h < 320) return false;
  const ratio = h / w;
  return ratio > 1.05 && ratio < 2.6;
}

export async function dataUrlFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function imageBitmapFromBlob(blob) {
  return createImageBitmap(blob, { colorSpaceConversion: "none" });
}

export function drawImageFit(canvas, bitmap, maxWidth = 1280) {
  const scale = bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true, alpha: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { ctx, width, height, scale };
}

export function meanEdgeColor(ctx, box) {
  const { x, y, w, h } = box;
  const points = [];
  for (let i = 0; i < w; i += Math.max(1, Math.floor(w / 20))) {
    points.push([x + i, y], [x + i, y + h - 1]);
  }
  for (let j = 0; j < h; j += Math.max(1, Math.floor(h / 20))) {
    points.push([x, y + j], [x + w - 1, y + j]);
  }
  let r = 0, g = 0, b = 0, n = 0;
  const img = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data;
  for (const [px, py] of points) {
    if (px < 0 || py < 0 || px >= ctx.canvas.width || py >= ctx.canvas.height) continue;
    const idx = (py * ctx.canvas.width + px) * 4;
    r += img[idx];
    g += img[idx + 1];
    b += img[idx + 2];
    n++;
  }
  if (!n) return "rgba(255,255,255,0.95)";
  return `rgba(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)},0.95)`;
}

export function inpaintRegion(ctx, box, mode = "auto") {
  const { x, y, w, h } = box;
  if (mode === "overlay") return;

  const edgeFill = meanEdgeColor(ctx, box);
  if (mode === "solid" || mode === "auto") {
    ctx.save();
    ctx.fillStyle = edgeFill;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    if (mode === "solid") return;
  }

  const data = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  const out = data.data;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      let rs = 0, gs = 0, bs = 0, c = 0;
      const sample = [
        [clamp(px - w, 0, ctx.canvas.width - 1), py],
        [clamp(px + w, 0, ctx.canvas.width - 1), py],
        [px, clamp(py - h, 0, ctx.canvas.height - 1)],
        [px, clamp(py + h, 0, ctx.canvas.height - 1)]
      ];
      for (const [sx, sy] of sample) {
        const i = (sy * ctx.canvas.width + sx) * 4;
        rs += out[i];
        gs += out[i + 1];
        bs += out[i + 2];
        c++;
      }
      const idx = (py * ctx.canvas.width + px) * 4;
      out[idx] = Math.round(rs / c);
      out[idx + 1] = Math.round(gs / c);
      out[idx + 2] = Math.round(bs / c);
      out[idx + 3] = 255;
    }
  }
  ctx.putImageData(data, 0, 0);
}

export function drawTextInBox(ctx, text, box, vertical = false) {
  const { x, y, w, h } = box;
  ctx.save();
  const baseSize = Math.max(12, Math.min(52, Math.floor(Math.min(w, h) * 0.35)));
  const fontStack = '"Noto Sans JP", "Roboto", "Arial", sans-serif';
  let size = baseSize;
  let lines = splitLines(ctx, text, w * 0.9, size, fontStack, vertical);

  while (size > 10) {
    const lineHeight = size * 1.2;
    const needHeight = vertical ? size * Math.max(...lines.map(l => l.length), 1) : lines.length * lineHeight;
    if (needHeight <= h * 0.95) break;
    size -= 1;
    lines = splitLines(ctx, text, w * 0.9, size, fontStack, vertical);
  }

  ctx.font = `${size}px ${fontStack}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.92)";
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = Math.max(2, Math.ceil(size * 0.12));

  if (vertical) {
    const chars = lines.join("").split("");
    const step = h / (chars.length + 1);
    chars.forEach((ch, i) => {
      const tx = x + w / 2;
      const ty = y + step * (i + 1);
      ctx.strokeText(ch, tx, ty);
      ctx.fillText(ch, tx, ty);
    });
  } else {
    const lineHeight = size * 1.2;
    const startY = y + (h - lineHeight * lines.length) / 2 + lineHeight / 2;
    lines.forEach((line, i) => {
      const tx = x + w / 2;
      const ty = startY + i * lineHeight;
      ctx.strokeText(line, tx, ty);
      ctx.fillText(line, tx, ty);
    });
  }

  ctx.restore();
}

function splitLines(ctx, text, maxWidth, fontSize, fontStack, vertical = false) {
  if (vertical) return [text.replace(/\s+/g, "")];
  ctx.font = `${fontSize}px ${fontStack}`;
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [text];
  const lines = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

export function estimateTextBoxes(ctx) {
  const { width, height } = ctx.canvas;
  const gray = ctx.getImageData(0, 0, width, height);
  const d = gray.data;
  const boxes = [];
  const stride = Math.max(36, Math.floor(Math.min(width, height) / 18));
  const cell = stride;

  for (let y = 0; y + cell < height; y += Math.floor(cell * 0.75)) {
    for (let x = 0; x + cell < width; x += Math.floor(cell * 0.75)) {
      let dark = 0;
      let n = 0;
      for (let py = y; py < y + cell; py += 2) {
        for (let px = x; px < x + cell; px += 2) {
          const i = (py * width + px) * 4;
          const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          if (l < 96) dark++;
          n++;
        }
      }
      const ratio = dark / Math.max(1, n);
      if (ratio > 0.08 && ratio < 0.42) {
        boxes.push({ x, y, w: cell, h: cell });
      }
    }
  }
  return mergeBoxes(boxes, width, height);
}

function mergeBoxes(boxes, maxW, maxH) {
  const out = [];
  for (const box of boxes) {
    let merged = false;
    for (const cur of out) {
      if (intersects(expand(cur, 8), box)) {
        const nx = Math.min(cur.x, box.x);
        const ny = Math.min(cur.y, box.y);
        const ex = Math.max(cur.x + cur.w, box.x + box.w);
        const ey = Math.max(cur.y + cur.h, box.y + box.h);
        cur.x = nx;
        cur.y = ny;
        cur.w = Math.min(maxW - nx, ex - nx);
        cur.h = Math.min(maxH - ny, ey - ny);
        merged = true;
        break;
      }
    }
    if (!merged) out.push({ ...box });
  }
  return out
    .filter(b => b.w * b.h > 1200)
    .slice(0, 36);
}

function expand(b, p) {
  return { x: b.x - p, y: b.y - p, w: b.w + p * 2, h: b.h + p * 2 };
}

function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
