import { describe, it, expect } from 'vitest'
import { generateVideoHtml, type GenerateVideoHtmlInput } from './heroVideo'
import { parseHeroVideoHtml } from './parseHeroVideo'

const base: GenerateVideoHtmlInput = {
  m3u8Url: 'https://www.dvidshub.net/video/996624.m3u8',
  captionSrc: '/Portals/0/Video/captions.vtt?ver=2024-01-01',
  posterUrl: '/Portals/0/Images/poster.jpg',
  hlsSource: 'dnn',
  includeFontAwesomeCdn: false,
}

const roundTrip = (overrides: Partial<GenerateVideoHtmlInput> = {}) =>
  parseHeroVideoHtml(generateVideoHtml({ ...base, ...overrides }))

describe('parseHeroVideoHtml — round-trips generated HTML', () => {
  it('recovers the video, caption, poster, and default toggles', () => {
    expect(roundTrip()).toEqual({
      videoId: '996624',
      captionSrc: base.captionSrc,
      posterUrl: base.posterUrl,
      hlsSource: 'dnn',
      includeFontAwesomeCdn: false,
      unknownHlsSrc: null,
    })
  })

  it('recovers the CDN HLS source and the Font Awesome link', () => {
    const out = roundTrip({ hlsSource: 'cdn', includeFontAwesomeCdn: true })!
    expect(out.hlsSource).toBe('cdn')
    expect(out.includeFontAwesomeCdn).toBe(true)
  })

  it('reverses the JS-string escaping', () => {
    const out = roundTrip({ captionSrc: 'a"b\\c\nd', posterUrl: 'p q' })!
    expect(out.captionSrc).toBe('a"b\\c\nd')
    expect(out.posterUrl).toBe('p q')
  })

  it('reproduces identical output when regenerated', () => {
    const input = { ...base, hlsSource: 'cdn' as const, includeFontAwesomeCdn: true }
    const html = generateVideoHtml(input)
    const out = parseHeroVideoHtml(html)!
    expect(
      generateVideoHtml({
        m3u8Url: `https://www.dvidshub.net/video/${out.videoId}.m3u8`,
        captionSrc: out.captionSrc,
        posterUrl: out.posterUrl,
        hlsSource: out.hlsSource,
        includeFontAwesomeCdn: out.includeFontAwesomeCdn,
      }),
    ).toBe(html)
  })
})

describe('parseHeroVideoHtml — best-effort degradation', () => {
  it('flags a hand-edited HLS script src and falls back to DNN', () => {
    const html = generateVideoHtml(base).replace(
      /<script src="[^"]*hls[^"]*"><\/script>/,
      '<script src="/custom/hls.js"></script>',
    )
    const out = parseHeroVideoHtml(html)!
    expect(out.hlsSource).toBe('dnn')
    expect(out.unknownHlsSrc).toBe('/custom/hls.js')
  })

  it('accepts single-quoted values and missing caption/poster lines', () => {
    const out = parseHeroVideoHtml("<script>var src = 'https://www.dvidshub.net/video/42.m3u8';</script>")!
    expect(out.videoId).toBe('42')
    expect(out.captionSrc).toBe('')
    expect(out.posterUrl).toBe('')
  })

  it('returns null for non-video or non-DVIDS HTML', () => {
    expect(parseHeroVideoHtml('<p>hello</p>')).toBeNull()
    expect(parseHeroVideoHtml('<script>var src = "https://example.com/x.m3u8";</script>')).toBeNull()
    expect(parseHeroVideoHtml('')).toBeNull()
  })
})
