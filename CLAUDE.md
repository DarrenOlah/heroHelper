# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start Vite dev server (localhost:5173)
npm run build    # Production build → dist/
npm run preview  # Serve the dist/ build locally
npm run test:run # Vitest (run after touching src/lib/* generators or importers)
npm run lint
```

## Architecture

React + TypeScript SPA. Two tools share one shell:

- [src/App.tsx](src/App.tsx) — thin shell: header, pipe-separated nav (`Hero Image | Hero Video`), conditional render, footer.
- [src/components/HeroImageTool.tsx](src/components/HeroImageTool.tsx) — the original image generator.
- [src/components/HeroVideoTool.tsx](src/components/HeroVideoTool.tsx) — DVIDS hero-video generator.
- [src/components/SectionLabel.tsx](src/components/SectionLabel.tsx) — shared numbered-section header.
- [src/components/ImportButton.tsx](src/components/ImportButton.tsx) — shared **Import** UI (nav button + modal + "Imported …" flash). Each tool portals it into App's right-aligned `#tool-nav-slot` and supplies `parse` → `{ ok, value, summary, notes }` and `onApply`. A clean import into an untouched editor applies on paste; `notes` (defaulted fields) or a `replaceWarning` (work in the editor) show a review step first. **Copied from componentHelper** — keep the two copies in sync.
- [src/lib/useHashRoute.ts](src/lib/useHashRoute.ts) — minimal hash router (`#/image` default, `#/video`). Bookmarkable, GitHub Pages friendly, no dependency.

Each tool owns its own `useState` (no global store). Pure helpers live in `src/lib/` and are unit-tested.

### Hero Image tool flow
5 sections + live preview + HTML output:
1. **Image source** — PC file upload (with DNN server path field) or URL
2. **Alt text** — required-field validation
3. **Focal point** — click-to-set on a live image preview; yellow dashed overlay shows the hero crop region for the selected simulation width
4. **Options** — Hero height preset (Short / Standard / Tall / Extra Tall / Custom); Custom exposes editable `clamp(min, vw, max)` inputs
5. **HTML output** — displays and copies the generated snippet

### Hero Video tool flow
4 input sections + live preview iframe + HTML output:
1. **DVIDS source** — accepts iframe embed code, dvidshub.net URL, or bare numeric ID; parsed by `parseDvidsInput()` into a `.m3u8` URL.
2. **Closed captions** — DNN VTT path (required, phase 1).
3. **Poster image** — DNN poster path (required, phase 1).
4. **Options** — HLS.js source toggle: DNN bundled (default, `/desktopmodules/sharedlibrary/validatedplugins/hls.js/hls.min.js`) or public CDN (`cdn.jsdelivr.net`). Affects the *output* only.
5. **HTML output** — full reference template with the three values substituted.

The live preview is a sandboxed `<iframe srcDoc>` rendering the actual generated module at 16:9 aspect ratio (matches the reference's `height: 56.25vw`), capped at 70vh. The preview **always** uses the CDN HLS.js (since heroHelper itself is not running inside DNN); the generated output respects the user's HLS toggle.

### Key constants / helpers (image)
- `HEIGHT_PRESETS` — array of `{ key, label, clamp, calcH }`. `calcH(vw)` mirrors the CSS `clamp()` for use in JS crop math.
- `resolveHeight(heightPreset, customMin, customVw, customMax)` — returns `{ clamp, calcH }` for both preset and custom modes. Used by `generateHtml`, `getCropOverlay`, and the preview aspect-ratio.
- `PRESETS` — simulation widths (4K → Tablet → Mobile). Mobile shows full image uncropped.

### Key constants / helpers (video)
- [src/lib/heroVideo.ts](src/lib/heroVideo.ts):
  - `parseDvidsInput(raw)` — returns `{ videoId, m3u8Url } | null`. Tries iframe `src=` first, then any dvidshub.net URL, then a bare numeric ID.
  - `generateVideoHtml({ m3u8Url, captionSrc, posterUrl, hlsSource })` — substitutes 4 tokens into the template (the three user values plus the HLS.js script src).
  - `generateVideoPreviewHtml(opts)` — wrapper that forces `hlsSource: 'cdn'`.
  - `escapeForJsString` (private) — escapes `\`, `"`, CR/LF, and U+2028/U+2029 so user input cannot break out of `var x = "...";` lines.
- [src/templates/heroVideo.html](src/templates/heroVideo.html) — verbatim copy of [reference.html](reference.html) with `__M3U8_URL__`, `__CAPTION_SRC__`, `__POSTER_URL__`, `__HLS_SCRIPT_SRC__` placeholders. Imported via Vite's `?raw` suffix.

### Import (both tools)
Recovers editable fields from previously generated HTML. Targets the current generator's output only (best effort for older blocks). **When a generator's output changes, update its importer and round-trip test too.**
- [src/lib/parseHero.ts](src/lib/parseHero.ts) — `parseHeroImageHtml`: src, alt, focal point (inline `object-position`), height (the container `clamp()` → matching `HEIGHT_PRESETS` entry, else Custom). DOM-aware (`DOMParser`), so its test sets `// @vitest-environment jsdom` (`jsdom` is a devDependency).
- [src/lib/parseHeroVideo.ts](src/lib/parseHeroVideo.ts) — `parseHeroVideoHtml`: pure regex over the template's `var src/captionSrc/posterUrl = "…"` lines (reverses `escapeForJsString`), the HLS.js `<script src>` (unknown → `dnn` + note), and the Font Awesome `<link>`.
- Imported folder / caption / poster paths overwrite their saved localStorage defaults, same as typing them.
- Image: an absolute src imports into URL mode. A site path (`/Portals/…`) imports into PC mode split into folder + filename (`splitSitePath`); there's no local file, so step 1 offers **Load from the live site** — the user's site address (`normalizeSiteOrigin`, saved as `heroHelper-site-origin`) + the path feeds the focal-point picker while the output keeps the site path. If it fails to load, they re-select the local file.

### Crop overlay math (image tool)
Uses CSS `object-position` semantics: `heroLeft = (1 - heroVisW) * (focalX / 100)`. The picker image is always centered at 50/50 (default object-position), so picker offsets use `0.5 - pickerVisW/2`. The overlay is positioned in picker-display-space by mapping the hero's image-space rect through the picker's visible image-space rect.

### Output format
- **Image**: `generateHtml()` produces an inline `style="object-position: X% Y%;"` on the `<img>` (never preset classes). The `height` property on `.heroHelper-hero-container` uses a `clamp()` value from the active height preset. Self-contained `<style>` + `<div>`/`<img>` for one-paste use in a DNN Text/HTML module.
- **Video**: `generateVideoHtml()` returns the full reference template (CSS + markup + IIFE JS, ~1450 lines) ready for one-paste use in a DNN Text/HTML module.

### CSS class naming
- Image module uses `heroHelper-` prefix (`heroHelper-hero-container`, `heroHelper-hero-image`).
- Video module preserves the reference's `hero-` prefix and `#heroWrap` ID (matches existing AFPIMS conventions).

## Deploy
`vite.config.ts` sets `base: '/heroHelper/'` for GitHub Pages. Build `dist/` and push to the `gh-pages` branch. Hash routing (`#/image`, `#/video`) keeps both pages bookmarkable on a static host without server rewrites.
