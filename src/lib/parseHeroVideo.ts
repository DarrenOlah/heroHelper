// Best-effort importer for the Hero Video tool: recover the editable fields from a
// block this tool generated. Pure string parsing (no DOM) — every value lives in a
// JS string literal (`var src = "…";`) or a single tag, so this sits beside
// parseDvidsInput and tests without jsdom.
//
// Only the current template is targeted; older blocks import whatever still matches.
// null means the paste isn't recognizable as a hero video block at all.

import { parseDvidsInput, CDN_HLS_SCRIPT_SRC, DNN_HLS_SCRIPT_SRC, type HlsSource } from './heroVideo'

export interface HeroVideoImport {
  videoId: string
  captionSrc: string
  posterUrl: string
  hlsSource: HlsSource
  includeFontAwesomeCdn: boolean
  // The HLS.js <script src> matched neither known source (hand-edited); hlsSource
  // then falls back to 'dnn'.
  unknownHlsSrc: string | null
}

// Reverse of heroVideo.ts escapeForJsString, plus any other simple JS escape a
// hand edit might have introduced.
function unescapeJsString(v: string): string {
  return v.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, e: string) => {
    if (e[0] === 'u' && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16))
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16))
    if (e === 'n') return '\n'
    if (e === 'r') return '\r'
    if (e === 't') return '\t'
    return e // \\ → \, \" → ", \' → '
  })
}

// The value of `var <name> = "…"` (double- or single-quoted).
function jsStringVar(js: string, name: string): string | undefined {
  const m = js.match(new RegExp('\\bvar\\s+' + name + '\\s*=\\s*(?:"((?:[^"\\\\\\n]|\\\\.)*)"|\'((?:[^\'\\\\\\n]|\\\\.)*)\')'))
  if (!m) return undefined
  return unescapeJsString(m[1] ?? m[2] ?? '')
}

export function parseHeroVideoHtml(html: string): HeroVideoImport | null {
  const m3u8 = jsStringVar(html, 'src')
  if (m3u8 == null) return null
  const dvids = parseDvidsInput(m3u8)
  if (!dvids) return null

  // HLS.js loader: the only external <script src> in the template.
  const hlsSrc = (html.match(/<script[^>]*\ssrc\s*=\s*["']([^"']*hls[^"']*)["']/i) || [])[1]?.trim()
  let hlsSource: HlsSource = 'dnn'
  let unknownHlsSrc: string | null = null
  if (hlsSrc === CDN_HLS_SCRIPT_SRC) hlsSource = 'cdn'
  else if (hlsSrc && hlsSrc !== DNN_HLS_SCRIPT_SRC) unknownHlsSrc = hlsSrc

  return {
    videoId: dvids.videoId,
    captionSrc: (jsStringVar(html, 'captionSrc') ?? '').trim(),
    posterUrl: (jsStringVar(html, 'posterUrl') ?? '').trim(),
    hlsSource,
    includeFontAwesomeCdn: /<link\b[^>]*font-?awesome[^>]*>/i.test(html),
    unknownHlsSrc,
  }
}
