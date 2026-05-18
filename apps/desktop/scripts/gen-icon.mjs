// Generates assets/forge.ico (multi-size) + assets/forge.png (256px)
// from the Tafdil SVG logo using `sharp`.
// Run: node scripts/gen-icon.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT  = resolve(__dir, '..')

// ── Load sharp ─────────────────────────────────────────────────────────────────
let sharp
try {
  const sharpMod = await import('sharp')
  sharp = sharpMod.default
} catch {
  // Try monorepo node_modules
  const { default: s } = await import(
    resolve(__dir, '../../../node_modules/sharp/lib/index.js')
  )
  sharp = s
}

// ── SVG source ─────────────────────────────────────────────────────────────────
// Embed the Tafdil gear+circuit icon inline (same design as tafdil-icon.svg
// but optimised for small sizes: thicker strokes, simpler orbit).
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="14" fill="#212121"/>
  <path d="M 70 70 A 38 38 0 1 0 30 22" fill="none" stroke="#C62828" stroke-width="7" stroke-linecap="round"/>
  <path fill-rule="evenodd" fill="#ffffff"
    d="M73.47,45.01 L81.76,46.1 L81.76,53.9 L73.47,54.99
       L72.83,57.42 L79.46,62.5 L75.56,69.26 L67.83,66.06
       L66.06,67.83 L69.26,75.56 L62.5,79.46 L57.42,72.83
       L54.99,73.47 L53.9,81.76 L46.1,81.76 L45.01,73.47
       L42.58,72.83 L37.5,79.46 L30.74,75.56 L33.94,67.83
       L32.17,66.06 L24.44,69.26 L20.54,62.5 L27.17,57.42
       L26.53,54.99 L18.24,53.9 L18.24,46.1 L26.53,45.01
       L27.17,42.58 L20.54,37.5 L24.44,30.74 L32.17,33.94
       L33.94,32.17 L30.74,24.44 L37.5,20.54 L42.58,27.17
       L45.01,26.53 L46.1,18.24 L53.9,18.24 L54.99,26.53
       L57.42,27.17 L62.5,20.54 L69.26,24.44 L66.06,32.17
       L67.83,33.94 L75.56,30.74 L79.46,37.5 L72.83,42.58 Z
       M50,39 A11,11,0,0,1,50,61 A11,11,0,0,1,50,39 Z"/>
  <circle cx="30" cy="22" r="6" fill="none" stroke="#C62828" stroke-width="3.5"/>
</svg>`

const svgBuf = Buffer.from(SVG)

// ── Render PNGs at required ICO sizes ─────────────────────────────────────────
const SIZES = [16, 24, 32, 48, 64, 128, 256]

console.log('Rendering PNG sizes:', SIZES.join(', '))

const pngs = await Promise.all(
  SIZES.map(s =>
    sharp(svgBuf, { density: Math.ceil((s / 100) * 96 * 3) })
      .resize(s, s)
      .png({ compressionLevel: 9 })
      .toBuffer()
  )
)

// ── Save forge.png (256px) ─────────────────────────────────────────────────────
const assetsDir = resolve(ROOT, 'assets')
mkdirSync(assetsDir, { recursive: true })
writeFileSync(resolve(assetsDir, 'forge.png'), pngs[SIZES.indexOf(256)])
console.log('✓ assets/forge.png (256px)')

// ── Build ICO binary (PNG-embedded, Vista+ compatible) ─────────────────────────
// Format: ICONDIR (6B) + N × ICONDIRENTRY (16B) + N × PNG data
function buildIco(images) {
  const N = images.length

  // Compute offsets: header(6) + N*16 entries + data
  const headerSize = 6 + N * 16
  const offsets = []
  let offset = headerSize
  for (const buf of images) {
    offsets.push(offset)
    offset += buf.length
  }

  const total = offset
  const out = Buffer.alloc(total, 0)

  // ICONDIR
  out.writeUInt16LE(0, 0)  // reserved
  out.writeUInt16LE(1, 2)  // type = ICO
  out.writeUInt16LE(N, 4)  // count

  // ICONDIRENTRY per image
  images.forEach((buf, i) => {
    const size   = SIZES[i]
    const base   = 6 + i * 16
    out.writeUInt8(size >= 256 ? 0 : size, base)      // bWidth  (0 = 256)
    out.writeUInt8(size >= 256 ? 0 : size, base + 1)  // bHeight
    out.writeUInt8(0,  base + 2)   // bColorCount
    out.writeUInt8(0,  base + 3)   // bReserved
    out.writeUInt16LE(1, base + 4) // wPlanes
    out.writeUInt16LE(32, base + 6)// wBitCount
    out.writeUInt32LE(buf.length, base + 8)     // dwBytesInRes
    out.writeUInt32LE(offsets[i],  base + 12)   // dwImageOffset
  })

  // PNG data blocks
  images.forEach((buf, i) => { buf.copy(out, offsets[i]) })

  return out
}

const ico = buildIco(pngs)
writeFileSync(resolve(assetsDir, 'forge.ico'), ico)
console.log(`✓ assets/forge.ico (${SIZES.length} sizes: ${SIZES.join(',')}px) — ${(ico.length / 1024).toFixed(1)} KB`)
console.log('\nDone. Run  pnpm dist:win  in apps/desktop to rebuild the installer.')
