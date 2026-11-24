import { useState, useRef, useCallback, useEffect, type ChangeEvent, type MouseEvent, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  HEIGHT_PRESETS,
  PRESETS,
  resolveHeight,
  safeImageUrl,
  generateHtml,
  computeCropOverlay,
  splitSitePath,
  normalizeSiteOrigin,
  type HeightPresetKey,
  type SimPresetKey,
} from '../lib/hero'
import { parseHeroImageHtml, type HeroImageImport } from '../lib/parseHero'
import { SectionLabel } from './SectionLabel'
import { ImportButton, type ImportParseResult } from './ImportButton'

type Mode = 'pc' | 'url'

interface State {
  mode: Mode
  previewUrl: string
  dnnFolder: string
  dnnFile: string
  urlInput: string
  src: string
  alt: string
  focalX: number
  focalY: number
  simPreset: SimPresetKey
  imgNatural: { w: number; h: number }
  heightPreset: HeightPresetKey
  customMin: number
  customVw: number
  customMax: number
}

type CustomKey = 'customMin' | 'customVw' | 'customMax'

const STORAGE_KEY = 'heroHelper-dnn-folder'
// The live site's origin (e.g. https://www.army.edu), used to load an imported
// site-path image for the focal-point picker.
const SITE_STORAGE_KEY = 'heroHelper-site-origin'

// Same allowlist as the folder field's input handler.
const sanitizeFolder = (val: string) => val.replace(/[^a-zA-Z0-9/_\-. ]/g, '')

export function HeroImageTool() {
  const fileRef = useRef<HTMLInputElement | null>(null)
  // Picker size lives in state (kept current by a ResizeObserver) so the crop
  // overlay never reads a ref during render and re-renders when the picker resizes.
  const [pickerSize, setPickerSize] = useState<{ w: number; h: number } | null>(null)
  const pickerRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const measure = () => setPickerSize({ w: el.offsetWidth, h: el.offsetHeight })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      ro.disconnect()
      setPickerSize(null)
    }
  }, [])

  const [state, setState] = useState<State>({
    mode: 'pc',
    previewUrl: '',
    dnnFolder: localStorage.getItem(STORAGE_KEY) ?? '',
    dnnFile: '',
    urlInput: '',
    src: '',
    alt: '',
    focalX: 50,
    focalY: 50,
    simPreset: '1080p',
    imgNatural: { w: 0, h: 0 },
    heightPreset: 'standard',
    customMin: 350,
    customVw: 21,
    customMax: 700,
  })
  const [altWarned, setAltWarned] = useState(false)
  const [copied, setCopied] = useState(false)
  // Loading an imported site-path image from the live site (PC mode, no local file).
  const [siteInput, setSiteInput] = useState(() => localStorage.getItem(SITE_STORAGE_KEY) ?? '')
  const [previewFromSite, setPreviewFromSite] = useState(false)
  const [siteLoadFailed, setSiteLoadFailed] = useState<string | null>(null)
  // App's right-aligned nav-row portal target (holds the Import button).
  const [navSlot, setNavSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNavSlot(document.getElementById('tool-nav-slot'))
  }, [])

  const { mode, previewUrl, dnnFolder, dnnFile, urlInput, alt, focalX, focalY, simPreset, imgNatural, heightPreset, customMin, customVw, customMax } = state

  const dnnPath = dnnFolder && dnnFile
    ? dnnFolder.replace(/\/?$/, '/') + dnnFile
    : dnnFolder + dnnFile

  const srcForOutput = mode === 'url' ? safeImageUrl(urlInput) : dnnPath
  const hasImage = mode === 'url' ? urlInput.trim() !== '' : (previewUrl !== '' && dnnPath.trim() !== '')
  const hasAlt = alt.trim() !== ''
  const isComplete = hasImage && hasAlt

  const html = isComplete ? generateHtml({ src: srcForOutput, alt, focalX, focalY, heightPreset, customMin, customVw, customMax }) : ''

  const currentPreset = PRESETS.find(p => p.key === simPreset) ?? PRESETS[2]
  const currentHeight = resolveHeight(heightPreset, customMin, customVw, customMax)
  const isMobile = simPreset === 'mobile'
  const showSizeWarning = !isMobile && imgNatural.w > 0 && currentPreset.width !== null && currentPreset.width > imgNatural.w

  const cropOverlay = previewUrl && pickerSize && !isMobile && currentPreset.width !== null
    ? computeCropOverlay({
        imgNatural,
        pickerW: pickerSize.w,
        pickerH: pickerSize.h,
        simWidth: currentPreset.width,
        heroHeight: currentHeight.calcH(currentPreset.width),
        focalX,
        focalY,
      })
    : null

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const objectUrl = URL.createObjectURL(file)
    setState(s => ({ ...s, previewUrl: safeImageUrl(objectUrl), dnnFile: file.name, imgNatural: { w: 0, h: 0 } }))
    setPreviewFromSite(false)
    setSiteLoadFailed(null)
  }

  const handleDnnFolder = (val: string) => {
    const clean = sanitizeFolder(val)
    localStorage.setItem(STORAGE_KEY, clean)
    setState(s => ({ ...s, dnnFolder: clean }))
  }

  const handleModeChange = (newMode: Mode) => {
    setState(s => ({ ...s, mode: newMode, previewUrl: '', urlInput: '', dnnFile: '', imgNatural: { w: 0, h: 0 } }))
    if (fileRef.current) fileRef.current.value = ''
    setPreviewFromSite(false)
    setSiteLoadFailed(null)
  }

  // Load the PC-mode site path from the live site so the focal point can be set
  // without the local file. The output still uses the site path (dnnPath).
  const loadFromSite = (originInput: string, path: string) => {
    const origin = normalizeSiteOrigin(originInput)
    const url = origin ? safeImageUrl(origin + path) : ''
    if (!url) {
      setSiteLoadFailed('Enter the site’s address, e.g. www.army.edu.')
      return
    }
    localStorage.setItem(SITE_STORAGE_KEY, origin)
    setSiteInput(origin)
    setSiteLoadFailed(null)
    setPreviewFromSite(true)
    setState(s => ({ ...s, previewUrl: url, imgNatural: { w: 0, h: 0 } }))
  }

  // ---- import (parse pasted HTML back into the editor) ----
  // The DNN folder is a saved default, not work; everything else counts.
  const isPristine = !hasImage && !alt.trim() && focalX === 50 && focalY === 50 && heightPreset === 'standard'

  const parseImport = (raw: string): ImportParseResult<HeroImageImport> => {
    const out = parseHeroImageHtml(raw)
    if (!out) {
      return {
        ok: false,
        error: "Couldn't recognize a hero image in that HTML. Paste the code this tool generated (the whole block, or at least the image markup).",
      }
    }
    const notes: string[] = []
    if (!out.src) notes.push('No image source was found.')
    else if (out.src.startsWith('/') && !out.src.startsWith('//') && !normalizeSiteOrigin(siteInput)) {
      notes.push('The image is a path on your site, so it can’t be previewed yet. After importing, enter the site’s address in step 1 (or choose the local file) to set the focal point.')
    }
    if (!out.alt) notes.push('No alt text was found — add it before copying.')
    if (!out.foundFocal) notes.push('No focal point was found, so it was centered.')
    if (!out.foundHeight) notes.push('No <style> block was found, so the hero height defaulted to Standard.')
    return { ok: true, value: out, summary: 'Imported the hero image.', notes }
  }

  const applyImport = (v: HeroImageImport) => {
    const common = {
      alt: v.alt,
      focalX: v.focalX,
      focalY: v.focalY,
      heightPreset: v.heightPreset,
      customMin: v.customMin,
      customVw: v.customVw,
      customMax: v.customMax,
      imgNatural: { w: 0, h: 0 },
    }
    if (fileRef.current) fileRef.current.value = ''
    setAltWarned(false)
    setCopied(false)
    setPreviewFromSite(false)
    setSiteLoadFailed(null)

    // Absolute (or protocol-relative) URLs load directly: URL mode.
    const absolute = /^https?:\/\//i.test(v.src) ? v.src : v.src.startsWith('//') ? `https:${v.src}` : ''
    if (absolute) {
      setState(s => ({ ...s, ...common, mode: 'url', urlInput: absolute, previewUrl: safeImageUrl(absolute), dnnFile: '' }))
      return
    }

    // A site path: PC mode, split into folder + filename. The folder becomes the
    // saved default (same as typing it). With a known site address, preview it live.
    const { folder, file } = splitSitePath(v.src)
    const cleanFolder = sanitizeFolder(folder)
    localStorage.setItem(STORAGE_KEY, cleanFolder)
    setState(s => ({ ...s, ...common, mode: 'pc', urlInput: '', previewUrl: '', dnnFolder: cleanFolder, dnnFile: file }))
    if (file && v.src.startsWith('/') && normalizeSiteOrigin(siteInput)) loadFromSite(siteInput, cleanFolder + file)
  }

  const handleUrlInput = (val: string) => {
    setState(s => ({ ...s, urlInput: val, previewUrl: safeImageUrl(val), imgNatural: { w: 0, h: 0 } }))
  }

  const handleFocalClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setState(s => ({ ...s, focalX: Math.round(x), focalY: Math.round(y) }))
  }, [])

  const handleNaturalLoad = useCallback((e: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget
    if (w && h) setState(s => ({ ...s, imgNatural: { w, h } }))
  }, [])

  const handleCopy = () => {
    navigator.clipboard.writeText(html).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleReset = () => {
    setState({
      mode: 'pc',
      previewUrl: '',
      dnnFolder: localStorage.getItem(STORAGE_KEY) ?? '',
      dnnFile: '',
      urlInput: '',
      src: '',
      alt: '',
      focalX: 50,
      focalY: 50,
      simPreset: '1080p',
      imgNatural: { w: 0, h: 0 },
      heightPreset: 'standard',
      customMin: 350,
      customVw: 21,
      customMax: 700,
    })
    setAltWarned(false)
    if (fileRef.current) fileRef.current.value = ''
    setPreviewFromSite(false)
    setSiteLoadFailed(null)
  }

  // An imported site path with nothing to preview yet: offer the live-site load.
  const offerSiteLoad = mode === 'pc' && !previewUrl && dnnFile !== '' && dnnPath.startsWith('/') && !dnnPath.startsWith('//')

  const customFields: { label: string; key: CustomKey; value: number; min: number; max: number }[] = [
    { label: 'Min (px)', key: 'customMin', value: customMin, min: 50, max: customMax - 1 },
    { label: 'Preferred (vw)', key: 'customVw', value: customVw, min: 1, max: 100 },
    { label: 'Max (px)', key: 'customMax', value: customMax, min: customMin + 1, max: 2000 },
  ]

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">

      {navSlot &&
        createPortal(
          <ImportButton
            title="Import from generated HTML"
            intro="Paste a hero image block this tool generated to recover the image, alt text, focal point, and height. A partial paste (just the markup, no <style>) works too — the height then defaults to Standard."
            parse={parseImport}
            replaceWarning={isPristine ? null : 'This replaces the image and settings currently in the editor.'}
            onApply={applyImport}
          />,
          navSlot,
        )}

      {/* ── LEFT: Inputs ── */}
      <div className="w-full lg:w-80 xl:w-96 shrink-0 space-y-4">

        {/* Section 1: Image source */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <SectionLabel number={1} title="Choose your image" done={hasImage} />

          {/* Mode toggle */}
          <div className="flex gap-2 mb-4">
            {([
              { id: 'pc', label: 'Image on this PC' },
              { id: 'url', label: 'Image at a URL' },
            ] as { id: Mode; label: string }[]).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => handleModeChange(id)}
                className={`flex-1 px-3 py-1.5 rounded-lg border-2 text-xs font-medium transition-colors
                  ${mode === id
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* PC upload */}
          {mode === 'pc' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Choose an image file
                </label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml,image/avif"
                  onChange={handleFileChange}
                  className="block w-full text-xs text-gray-600
                    file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0
                    file:text-xs file:font-medium file:bg-blue-50 file:text-blue-700
                    hover:file:bg-blue-100 cursor-pointer"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  File path on server
                </label>
                <div className="flex items-stretch rounded-lg border border-gray-300 overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
                  <input
                    type="text"
                    value={dnnFolder}
                    onChange={e => handleDnnFolder(e.target.value)}
                    placeholder="/Portals/0/Images/"
                    className="flex-1 min-w-0 px-2 py-1.5 text-xs focus:outline-none"
                  />
                  <div className="flex items-center px-2 py-1.5 bg-gray-50 border-l border-gray-300 text-xs text-gray-500 font-mono whitespace-nowrap max-w-[40%] overflow-hidden text-ellipsis">
                    {dnnFile || <span className="text-gray-300 italic font-sans">filename</span>}
                  </div>
                </div>
                {dnnPath
                  ? <p className="mt-1 text-xs text-gray-400 font-mono truncate">→ {dnnPath}</p>
                  : <p className="mt-1 text-xs text-gray-400">Enter the folder where you will upload this image.</p>
                }
                {previewFromSite && previewUrl && (
                  <p className="mt-1 text-xs text-gray-400">Previewing from <span className="font-mono">{normalizeSiteOrigin(siteInput)}</span>.</p>
                )}
              </div>

              {offerSiteLoad && (
                <div className="rounded-lg bg-blue-50 border border-blue-200 p-2.5 space-y-2">
                  <p className="text-xs text-blue-800">
                    Is this image already on the live site? Enter the site’s address to load it for the focal-point
                    picker, or choose the local file above.
                  </p>
                  <form
                    className="flex gap-2"
                    onSubmit={e => {
                      e.preventDefault()
                      loadFromSite(siteInput, dnnPath)
                    }}
                  >
                    <input
                      type="text"
                      value={siteInput}
                      onChange={e => setSiteInput(e.target.value)}
                      placeholder="www.army.edu"
                      aria-label="Live site address"
                      className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="submit"
                      disabled={!siteInput.trim()}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Load
                    </button>
                  </form>
                  {siteLoadFailed && <p className="text-xs text-red-600">{siteLoadFailed}</p>}
                </div>
              )}
            </div>
          )}

          {/* URL input */}
          {mode === 'url' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Image URL</label>
              <input
                type="url"
                value={urlInput}
                onChange={e => handleUrlInput(e.target.value)}
                placeholder="https://example.com/images/campus.jpg"
                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}
        </div>

        {/* Section 2: Alt text */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <SectionLabel number={2} title="Alt text" done={hasAlt} />
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Describe the image <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={alt}
            onChange={e => {
              const clean = e.target.value.replace(/[<>"]/g, '')
              setState(s => ({ ...s, alt: clean }))
              if (clean.trim()) setAltWarned(false)
            }}
            onBlur={() => { if (!alt.trim()) setAltWarned(true) }}
            placeholder="e.g. Aerial view of the main campus on a sunny day"
            className={`w-full px-2 py-1.5 border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500
              ${altWarned ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
          />
          {altWarned && (
            <p className="mt-1 text-xs text-red-500 font-medium">Alt text is required.</p>
          )}
          <p className="mt-1 text-xs text-gray-400">
            Required for accessibility. Avoid starting with "Image of…"
          </p>
        </div>

        {/* Section 3: Focal point picker */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <SectionLabel number={3} title="Set focal point" done={hasImage} />

          {previewUrl ? (
            <>
              <p className="text-xs text-gray-500 mb-2">
                Click the most important part of the image. It should remain visible on all screen sizes.
              </p>
              <div
                ref={pickerRef}
                className="relative rounded-lg overflow-hidden border-2 border-dashed border-blue-300 bg-gray-50 cursor-crosshair select-none"
                onClick={handleFocalClick}
              >
                <img
                  src={previewUrl}
                  alt="Click to set focal point"
                  className="w-full object-cover block pointer-events-none"
                  style={{ maxHeight: '300px' }}
                  draggable={false}
                  onLoad={handleNaturalLoad}
                  onError={() => {
                    if (previewFromSite) {
                      setSiteLoadFailed(`Couldn’t load ${previewUrl}. Check the site address, or choose the local file above.`)
                      setPreviewFromSite(false)
                    }
                    setState(s => ({ ...s, previewUrl: '' }))
                  }}
                />
                {/* Focal point marker */}
                <div
                  className="absolute pointer-events-none"
                  style={{ left: `${focalX}%`, top: `${focalY}%`, transform: 'translate(-50%, -50%)' }}
                >
                  <div className="w-8 h-8 rounded-full border-4 border-white shadow-lg flex items-center justify-center bg-blue-600/70">
                    <div className="w-2 h-2 rounded-full bg-white" />
                  </div>
                </div>
                {/* Crop overlay */}
                {cropOverlay && (
                  <div
                    className="absolute pointer-events-none border-2 border-dashed border-yellow-400"
                    style={{
                      left:   `${cropOverlay.left}%`,
                      top:    `${cropOverlay.top}%`,
                      width:  `${cropOverlay.width}%`,
                      height: `${cropOverlay.height}%`,
                    }}
                  />
                )}
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Focal point: <span className="font-mono text-gray-500">{focalX}% from left, {focalY}% from top</span>.<br/>
                {cropOverlay && <> Yellow box = crop at <span className="font-medium text-gray-500">{currentPreset.label}</span>.</>}
              </p>
            </>
          ) : (
            <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center h-32">
              <p className="text-xs text-gray-400">Image preview will appear here</p>
            </div>
          )}
        </div>

        {/* Section 4: Options */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 bg-blue-600 text-white">
              4
            </div>
            <h2 className="text-base font-semibold text-gray-800">Options</h2>
          </div>

          {/* Hero height */}
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1.5">Hero height</label>
            <div className="flex gap-1 flex-wrap">
              {HEIGHT_PRESETS.map(h => (
                <button
                  key={h.key}
                  onClick={() => setState(s => ({ ...s, heightPreset: h.key }))}
                  className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors
                    ${heightPreset === h.key
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
                >
                  {h.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-400">
              {heightPreset === 'short'      ? <>Compact banner. Only for very flat/wide subjects, like the horizon.<span className="block font-mono mt-0.5">clamp(220px, 13vw, 440px)</span></> :
               heightPreset === 'standard'   ? <>Default height. Requires a not-too-tall subject.<span className="block font-mono mt-0.5">clamp(350px, 21vw, 700px)</span></> :
               heightPreset === 'tall'       ? <>Taller banner. Shows more of a tall subject.<span className="block font-mono mt-0.5">clamp(450px, 28vw, 850px)</span></> :
               heightPreset === 'extra-tall' ? <>Very tall banner. Significant vertical coverage.<span className="block font-mono mt-0.5">clamp(600px, 38vw, 1100px)</span></> :
                                               <>
                                                 <span className="block">Set each clamp value manually.</span>
                                                 <span className="block mt-1"><span className="font-mono">Min</span> and <span className="font-mono">Max</span> are the shortest and tallest the hero can ever be, in pixels.</span>
                                                 <span className="block mt-1"><span className="font-mono">Preferred (vw)</span> is the hero's height as a percentage of the page width — wider browser window, taller hero, so it always looks proportional.</span>
                                               </>}
            </p>

            {/* Custom clamp inputs */}
            {heightPreset === 'custom' && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {customFields.map(({ label, key, value, min, max }) => (
                  <div key={key}>
                    <label className="block text-[10px] text-gray-500 mb-0.5">{label}</label>
                    <input
                      type="number"
                      value={value}
                      min={min}
                      max={max}
                      onChange={e => {
                        const n = parseInt(e.target.value, 10)
                        if (!isNaN(n)) setState(s => ({ ...s, [key]: Math.min(Math.max(n, min), max) }))
                      }}
                      className="w-full px-2 py-1 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                  </div>
                ))}
                <div className="col-span-3 flex items-center justify-between">
                  <p className="text-[10px] text-gray-400 font-mono">
                    → clamp({customMin}px, {customVw}vw, {customMax}px)
                  </p>
                  <button
                    onClick={() => setState(s => ({ ...s, customMin: 350, customVw: 21, customMax: 700 }))}
                    className="text-[10px] text-blue-500 hover:text-blue-700 underline"
                  >
                    Reset to default
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* ── RIGHT: preview + HTML (stacked on lg, side-by-side on xl) ── */}
      <div className="w-full flex-1 min-w-0 flex flex-col xl:flex-row gap-4 items-start">

        {/* ── MIDDLE: Crop preview ── */}
        <div className="w-full xl:flex-1 min-w-0">

        {/* Crop preview */}
        {previewUrl ? (
          <div className="rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">
            {/* Toolbar */}
            <div className="bg-gray-100 px-3 py-1.5 border-b border-gray-200 flex items-center gap-3 flex-wrap">
              <span className="text-xs text-gray-500 font-medium shrink-0">
                Preview
              </span>
              <div className="flex gap-1 flex-wrap">
                {PRESETS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => setState(s => ({ ...s, simPreset: p.key }))}
                    className={`px-2 py-0.5 rounded text-xs font-medium transition-colors
                      ${simPreset === p.key
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-500 hover:bg-gray-200 border border-gray-300'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {isMobile ? (
              <div className="w-full bg-gray-50">
                <img
                  src={previewUrl}
                  alt="Mobile preview"
                  className="w-full block"
                  style={{ objectFit: 'contain', height: 'auto' }}
                />
                <p className="text-center text-xs text-gray-400 py-1.5">Mobile — image is not cropped</p>
              </div>
            ) : currentPreset.width !== null ? (
              <div
                className="w-full overflow-hidden"
                style={{ aspectRatio: `${currentPreset.width} / ${currentHeight.calcH(currentPreset.width)}` }}
              >
                <img
                  src={previewUrl}
                  alt="Crop preview"
                  className="w-full h-full object-cover block"
                  style={{ objectPosition: `${focalX}% ${focalY}%` }}
                  onLoad={handleNaturalLoad}
                />
              </div>
            ) : null}

            {showSizeWarning && (
              <div className="px-3 py-1.5 bg-amber-50 border-t border-amber-200 text-xs text-amber-700 flex items-center gap-1.5">
                <span>⚠</span>
                <span>Image is only {imgNatural.w}px wide — may appear blurry at {currentPreset.label}.</span>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white flex items-center justify-center" style={{ height: '200px' }}>
            <p className="text-xs text-gray-400">Crop preview will appear here</p>
          </div>
        )}

        </div>{/* ── END MIDDLE ── */}

        {/* ── RIGHT: HTML output ── */}
        <div className="w-full xl:w-96 shrink-0">
          <div className={`bg-white rounded-xl shadow-sm border p-4 transition-opacity
            ${isComplete ? 'border-gray-100 opacity-100' : 'border-gray-100 opacity-50 pointer-events-none'}`}>
            <SectionLabel number={5} title="Your HTML code" done={false} />

            {isComplete ? (
              <>
                <p className="text-xs text-gray-500 mb-3">
                  Copy and paste into your HTML.
                </p>
                <div className="bg-gray-900 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
                    <span className="text-xs text-gray-400 font-medium">HTML</span>
                    <button
                      onClick={handleCopy}
                      className={`text-xs font-medium px-3 py-1 rounded-md transition-colors
                        ${copied ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
                    >
                      {copied ? '✓ Copied!' : 'Copy to clipboard'}
                    </button>
                  </div>
                  <pre className="p-3 text-xs text-green-300 overflow-x-auto overflow-y-auto whitespace-pre font-mono leading-relaxed">
                    {html}
                  </pre>
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={handleReset}
                    className="px-4 py-1.5 bg-gray-800 text-white rounded-lg font-medium text-xs hover:bg-gray-700 transition-colors"
                  >
                    Start over
                  </button>
                </div>
              </>
            ) : (
              <p className="text-xs text-gray-400">
                Fill in your image source and alt text to generate the code.
              </p>
            )}
          </div>
        </div>{/* ── END RIGHT ── */}

      </div>{/* ── END RIGHT WRAPPER ── */}
    </div>
  )
}
