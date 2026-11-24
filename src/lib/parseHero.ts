// Best-effort importer for the Hero Image tool: recover the editable fields from a
// block this tool generated — or a partial paste (just the markup, no <style>), or
// markup copied from a rendered page. DOM-aware (DOMParser) so CKEditor's attribute
// reordering/quoting doesn't matter; lives apart from the pure hero.ts.
//
// Only the current generator's output is targeted; each field degrades to its
// default independently. null means no hero image markup was recognizable.

import { HEIGHT_PRESETS, type HeightPresetKey } from './hero'

export interface HeroImageImport {
  src: string
  alt: string
  focalX: number
  focalY: number
  heightPreset: HeightPresetKey
  customMin: number
  customVw: number
  customMax: number
  // Whether a hero `height: clamp(…)` was found (it lives in the <style> block).
  foundHeight: boolean
  // Whether the inline object-position was found.
  foundFocal: boolean
}

const DEFAULT_CUSTOM = { customMin: 350, customVw: 21, customMax: 700 }

const pct = (v: string) => Math.min(Math.max(Math.round(parseFloat(v)), 0), 100)

export function parseHeroImageHtml(html: string): HeroImageImport | null {
  if (typeof DOMParser === 'undefined') return null
  if (!/heroHelper-hero-/.test(html)) return null

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const img =
    doc.querySelector('img.heroHelper-hero-image') ?? doc.querySelector('.heroHelper-hero-container img')
  if (!img) return null

  // Focal point from the inline `object-position: X% Y%`.
  const pos = (img.getAttribute('style') ?? '').match(/object-position\s*:\s*(-?[\d.]+)%\s+(-?[\d.]+)%/i)

  // Height from the container's clamp(); the mobile media rule's `height: auto` is skipped.
  const css = Array.from(doc.querySelectorAll('style'))
    .map(s => s.textContent ?? '')
    .join('\n')
  const c = css.match(/height\s*:\s*clamp\(\s*([\d.]+)px\s*,\s*([\d.]+)vw\s*,\s*([\d.]+)px\s*\)/i)

  let heightPreset: HeightPresetKey = 'standard'
  let custom = { ...DEFAULT_CUSTOM }
  if (c) {
    const [min, vw, max] = [parseFloat(c[1]), parseFloat(c[2]), parseFloat(c[3])]
    const preset = HEIGHT_PRESETS.find(h => h.clamp === `clamp(${min}px, ${vw}vw, ${max}px)`)
    if (preset) heightPreset = preset.key
    else {
      heightPreset = 'custom'
      custom = { customMin: min, customVw: vw, customMax: max }
    }
  }

  return {
    src: (img.getAttribute('src') ?? '').trim(),
    // The alt field strips these on input; keep imported values consistent with it.
    alt: (img.getAttribute('alt') ?? '').replace(/[<>"]/g, '').trim(),
    focalX: pos ? pct(pos[1]) : 50,
    focalY: pos ? pct(pos[2]) : 50,
    heightPreset,
    ...custom,
    foundHeight: !!c,
    foundFocal: !!pos,
  }
}
