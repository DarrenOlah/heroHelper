// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { generateHtml, splitSitePath, normalizeSiteOrigin, type GenerateHtmlInput } from './hero'
import { parseHeroImageHtml } from './parseHero'

const base: GenerateHtmlInput = {
  src: '/Portals/0/Images/campus.jpg',
  alt: 'Aerial view of campus',
  focalX: 30,
  focalY: 70,
  heightPreset: 'standard',
  customMin: 350,
  customVw: 21,
  customMax: 700,
}

const roundTrip = (overrides: Partial<GenerateHtmlInput> = {}) =>
  parseHeroImageHtml(generateHtml({ ...base, ...overrides }))

describe('parseHeroImageHtml — round-trips generated HTML', () => {
  it('recovers src, alt, focal point, and preset height', () => {
    expect(roundTrip()).toEqual({ ...base, foundHeight: true, foundFocal: true })
  })

  it('recovers every height preset', () => {
    for (const key of ['short', 'standard', 'tall', 'extra-tall'] as const) {
      expect(roundTrip({ heightPreset: key })!.heightPreset).toBe(key)
    }
  })

  it('recovers a custom clamp', () => {
    expect(roundTrip({ heightPreset: 'custom', customMin: 300, customVw: 25, customMax: 900 })).toMatchObject({
      heightPreset: 'custom',
      customMin: 300,
      customVw: 25,
      customMax: 900,
    })
  })

  it('a custom clamp equal to a preset imports as that preset', () => {
    expect(roundTrip({ heightPreset: 'custom', customMin: 450, customVw: 28, customMax: 850 })!.heightPreset).toBe('tall')
  })

  it('reproduces identical output when regenerated', () => {
    const html = generateHtml({ ...base, heightPreset: 'custom', customMin: 280, customVw: 18, customMax: 640 })
    expect(generateHtml(parseHeroImageHtml(html)!)).toBe(html)
  })
})

describe('parseHeroImageHtml — best-effort degradation', () => {
  it('markup-only paste: src/alt/focal recovered, height defaults to Standard', () => {
    const html = generateHtml({ ...base, heightPreset: 'tall' })
    const out = parseHeroImageHtml(html.slice(html.indexOf('<div')))!
    expect(out.foundHeight).toBe(false)
    expect(out.heightPreset).toBe('standard')
    expect(out.src).toBe(base.src)
    expect(out.focalX).toBe(30)
  })

  it('rendered-page copy with reordered attributes and no inline style', () => {
    const out = parseHeroImageHtml(
      '<div class="heroHelper-hero-container"><img alt="A &quot;view&quot;" src="https://x.mil/a.jpg" class="heroHelper-hero-image"></div>',
    )!
    expect(out).toMatchObject({ src: 'https://x.mil/a.jpg', alt: 'A view', focalX: 50, focalY: 50, foundFocal: false })
  })

  it('returns null for non-hero HTML', () => {
    expect(parseHeroImageHtml('<img src="a.jpg">')).toBeNull()
    expect(parseHeroImageHtml('<div class="heroHelper-hero-container"></div>')).toBeNull()
    expect(parseHeroImageHtml('')).toBeNull()
  })
})

describe('splitSitePath', () => {
  it('splits folder and file, keeping a query on the file', () => {
    expect(splitSitePath('/Portals/0/Images/hero.jpg')).toEqual({ folder: '/Portals/0/Images/', file: 'hero.jpg' })
    expect(splitSitePath('/Portals/0/a.jpg?ver=1')).toEqual({ folder: '/Portals/0/', file: 'a.jpg?ver=1' })
    expect(splitSitePath('hero.jpg')).toEqual({ folder: '', file: 'hero.jpg' })
  })
})

describe('normalizeSiteOrigin', () => {
  it('accepts a host, an origin, or a full URL', () => {
    expect(normalizeSiteOrigin('www.army.edu')).toBe('https://www.army.edu')
    expect(normalizeSiteOrigin('https://www.army.edu/')).toBe('https://www.army.edu')
    expect(normalizeSiteOrigin('https://www.army.edu/Portals/0/a.jpg')).toBe('https://www.army.edu')
    expect(normalizeSiteOrigin('http://localhost.test:8080/x')).toBe('http://localhost.test:8080')
  })

  it('rejects unusable input', () => {
    expect(normalizeSiteOrigin('')).toBe('')
    expect(normalizeSiteOrigin('javascript:alert(1)')).toBe('')
    expect(normalizeSiteOrigin('not a host')).toBe('')
  })
})
