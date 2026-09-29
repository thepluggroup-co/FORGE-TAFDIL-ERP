// FORGE — Téléversement d'images vers Supabase Storage
//
// Le type d'un fichier est déterminé par sa SIGNATURE (premiers octets), jamais
// par l'extension ni par le type MIME déclaré par le navigateur (brief §46) :
// un fichier renommé en .jpg ou envoyé avec un Content-Type forgé est refusé.

import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export const TAILLE_MAX_IMAGE = 5 * 1024 * 1024
export const NOMBRE_MAX_IMAGES = 12

const EXTENSION_PAR_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/gif':  'gif',
  'image/webp': 'webp',
  'image/bmp':  'bmp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

function commencePar(buf: Uint8Array, octets: number[], decalage = 0): boolean {
  return octets.every((o, i) => buf[decalage + i] === o)
}

function ascii(buf: Uint8Array, debut: number, fin: number): string {
  return String.fromCharCode(...buf.subarray(debut, fin))
}

/** Type MIME réel d'une image d'après sa signature, ou null si ce n'est pas une image acceptée. */
export function detecterTypeImage(buf: Uint8Array): string | null {
  if (buf.length < 12) return null
  if (commencePar(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (commencePar(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (ascii(buf, 0, 6) === 'GIF87a' || ascii(buf, 0, 6) === 'GIF89a') return 'image/gif'
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'image/webp'
  if (ascii(buf, 0, 2) === 'BM') return 'image/bmp'
  // HEIC / HEIF (photos iPhone) : boîte ISO « ftyp » à l'octet 4, marque à l'octet 8
  if (ascii(buf, 4, 8) === 'ftyp') {
    const marque = ascii(buf, 8, 12)
    if (['heic', 'heix', 'hevc', 'hevx'].includes(marque)) return 'image/heic'
    if (['mif1', 'msf1', 'heif'].includes(marque)) return 'image/heif'
  }
  return null
}

export interface ResultatTeleversement {
  urls:   string[]
  errors: Array<{ file: string; error: string }>
}

/**
 * Téléverse jusqu'à NOMBRE_MAX_IMAGES images dans `bucket/dossier/…` et renvoie
 * leurs URL publiques. Chaque fichier refusé est listé dans `errors` avec sa raison.
 */
export async function televerserImages(
  db: SupabaseClient,
  bucket: string,
  dossier: string,
  files: File[],
): Promise<ResultatTeleversement> {
  await db.storage.createBucket(bucket, { public: true }).catch(() => {})

  const urls: string[] = []
  const errors: Array<{ file: string; error: string }> = []

  for (const file of files.slice(0, NOMBRE_MAX_IMAGES)) {
    if (file.size > TAILLE_MAX_IMAGE) {
      errors.push({ file: file.name, error: 'Image trop lourde, maximum 5 Mo' })
      continue
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const contentType = detecterTypeImage(buffer)
    if (!contentType) {
      errors.push({ file: file.name, error: 'Seuls les fichiers image (JPG, PNG, GIF, WEBP, BMP, HEIC) sont acceptes' })
      continue
    }

    const path = `${dossier}/${Date.now()}-${randomUUID()}.${EXTENSION_PAR_TYPE[contentType]}`
    const { error } = await db.storage.from(bucket).upload(path, buffer, { contentType, upsert: false })
    if (error) {
      console.error('[images] upload:', error)
      errors.push({ file: file.name, error: error.message })
      continue
    }

    urls.push(db.storage.from(bucket).getPublicUrl(path).data.publicUrl)
  }

  return { urls, errors }
}

// ── Documents privés (demandes de devis : plans, photos, PDF — Phase 6, §46) ──

export const TAILLE_MAX_DOCUMENT = 10 * 1024 * 1024
export const NOMBRE_MAX_DOCUMENTS = 5

/** Type réel d'un document accepté : image (voir detecterTypeImage) ou PDF. */
export function detecterTypeDocument(buf: Uint8Array): string | null {
  if (buf.length >= 5 && ascii(buf, 0, 5) === '%PDF-') return 'application/pdf'
  return detecterTypeImage(buf)
}

export interface DocumentTeleverse {
  nomFichier: string
  typeMime: string
  tailleOctets: number
  storagePath: string
}

/**
 * Téléverse des documents dans un bucket PRIVÉ (aucune URL publique) : ils ne
 * sont consultables que via des liens signés temporaires émis par l'API.
 */
export async function televerserDocumentsPrives(
  db: SupabaseClient,
  bucket: string,
  dossier: string,
  files: File[],
): Promise<{ documents: DocumentTeleverse[]; errors: Array<{ file: string; error: string }> }> {
  await db.storage.createBucket(bucket, { public: false }).catch(() => {})

  const documents: DocumentTeleverse[] = []
  const errors: Array<{ file: string; error: string }> = []

  for (const file of files.slice(0, NOMBRE_MAX_DOCUMENTS)) {
    if (file.size > TAILLE_MAX_DOCUMENT) {
      errors.push({ file: file.name, error: 'Fichier trop lourd, maximum 10 Mo' })
      continue
    }
    const buffer = Buffer.from(await file.arrayBuffer())
    const typeMime = detecterTypeDocument(buffer)
    if (!typeMime) {
      errors.push({ file: file.name, error: 'Seuls les PDF et les images (JPG, PNG, WEBP, HEIC…) sont acceptés' })
      continue
    }

    const extension = typeMime === 'application/pdf' ? 'pdf' : EXTENSION_PAR_TYPE[typeMime]
    const storagePath = `${dossier}/${Date.now()}-${randomUUID()}.${extension}`
    const { error } = await db.storage.from(bucket).upload(storagePath, buffer, { contentType: typeMime, upsert: false })
    if (error) {
      console.error('[documents] upload:', error)
      errors.push({ file: file.name, error: error.message })
      continue
    }
    documents.push({ nomFichier: file.name.slice(0, 200), typeMime, tailleOctets: file.size, storagePath })
  }

  return { documents, errors }
}
