# Chrome Extension: Local Manga Image Translator (MV3)

This folder contains a fully local-first Chrome extension architecture for manga image translation.

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `chrome-extension`

## What it does

- Uses **Manifest V3** service worker + **offscreen document** for canvas/WebGPU processing.
- Processes manga images locally (no cloud translation API).
- Caches model files in **IndexedDB** after first download.
- Caches translated outputs to avoid reprocessing identical images/settings.
- Runs one image at a time for iGPU memory safety.
- Supports idle model unload after 5 minutes of inactivity.

## Model URLs (editable in `offscreen.js`)

Default placeholders are set to:

- Detector: `https://huggingface.co/l0wgear/manga-ocr-2025-onnx/resolve/main/text-detector-tiny.onnx`
- OCR: `https://huggingface.co/l0wgear/manga-ocr-2025-onnx/resolve/main/manga-ocr-int8.onnx`
- Translation: `https://huggingface.co/Xenova/nllb-200-distilled-600M/resolve/main/onnx/model_quantized.onnx`

If URLs change, update `MODELS` in `offscreen.js`.

## Important runtime dependency

`offscreen.js` expects `onnxruntime-web` to be bundled in the extension package (MV3 disallows remote executable scripts).

Recommended approach:

1. Add `onnxruntime-web` to your local build pipeline.
2. Copy its extension-safe runtime assets into this extension package.
3. Expose `globalThis.ort` before `offscreen.js` session creation.

(Models are **not** bundled and are downloaded once, then cached.)

## WebGPU + fallback

- WebGPU is attempted first (`executionProviders: ['webgpu', 'wasm']`).
- If unavailable/fails, extension falls back to WASM and reports slower mode.

## iGPU / RAM guidance (4–8GB shared memory)

- Keep `maxWidth` to 1280 or below.
- Use quantized ONNX models (int8/q8).
- Keep single-image sequential processing enabled.
- Use popup button **Clear cached models** when disk usage should be reduced.

## Offline behavior

After first successful download:

- Cached models and translated image outputs are reused from local IndexedDB.
- Translation continues to run without network access for already cached resources.

## Files

- `manifest.json` – MV3 definition and permissions
- `background.js` – service worker orchestration, context menus, offscreen lifecycle
- `content.js` – image discovery, progress overlays, replace/revert on page
- `offscreen.html` + `offscreen.js` – local image pipeline (detect → OCR → translate → inpaint → overlay)
- `popup.html` + `popup.js` – user controls
- `styles.css` – popup and on-page progress styles
- `utils.js` – shared settings, caching, canvas and inpainting helpers
