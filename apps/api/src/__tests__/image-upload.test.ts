/**
 * image-upload.test.ts — type d'image déterminé par signature (brief §46)
 */

import { describe, it, expect } from 'vitest'
import { detecterTypeImage } from '../services/image-upload.service'

const avecRemplissage = (debut: number[]) => new Uint8Array([...debut, ...new Array(16).fill(0)])
const texte = (s: string) => new Uint8Array([...Buffer.from(s.padEnd(16, ' '))])

describe('detecterTypeImage', () => {
  it('reconnaît JPEG, PNG, GIF, WEBP, BMP', () => {
    expect(detecterTypeImage(avecRemplissage([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(detecterTypeImage(avecRemplissage([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(detecterTypeImage(texte('GIF89a'))).toBe('image/gif')
    expect(detecterTypeImage(texte('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
    expect(detecterTypeImage(texte('BM'))).toBe('image/bmp')
  })

  it('reconnaît les photos iPhone HEIC / HEIF', () => {
    expect(detecterTypeImage(texte('\0\0\0\x18ftypheic'))).toBe('image/heic')
    expect(detecterTypeImage(texte('\0\0\0\x18ftypmif1'))).toBe('image/heif')
  })

  it('refuse un fichier non image, quel que soit son nom ou son type annoncé', () => {
    expect(detecterTypeImage(texte('<?php echo 1; ?>'))).toBeNull()
    expect(detecterTypeImage(texte('%PDF-1.7 document'))).toBeNull()
    expect(detecterTypeImage(new Uint8Array([0xff, 0xd8]))).toBeNull() // trop court
  })
})
