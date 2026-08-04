import React, { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  width?:       number     // logical px (default 600)
  height?:      number     // logical px (default 200)
  onChange:     (dataUrl: string | null) => void
  disabled?:    boolean
}

/**
 * SignaturePad — zone de signature tactile (souris / tactile / stylet).
 *
 * Émet `onChange(dataUrl | null)` à chaque trait / clear.
 * `dataUrl` est au format `data:image/png;base64,...` prêt à être POSTé.
 *
 * Haute résolution : le canvas interne est 2× la taille logique pour
 * un rendu net sur écran rétina.
 */
export function SignaturePad({ width = 600, height = 200, onChange, disabled = false }: Props) {
  const canvasRef       = useRef<HTMLCanvasElement | null>(null)
  const isDrawingRef    = useRef(false)
  const lastPosRef      = useRef<{ x: number; y: number } | null>(null)
  const hasContentRef   = useRef(false)
  const [hasContent, setHasContent] = useState(false)

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1

  // Initialise le canvas en haute résolution
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width  = width  * dpr
    canvas.height = height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.lineWidth   = 2.5
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
    ctx.strokeStyle = '#111827'
    ctx.fillStyle   = '#FFFFFF'
    ctx.fillRect(0, 0, width, height)
  }, [width, height, dpr])

  const localPos = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    e.preventDefault()
    ;(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId)
    isDrawingRef.current = true
    lastPosRef.current   = localPos(e)
  }, [disabled, localPos])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || disabled) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const pos  = localPos(e)
    const last = lastPosRef.current
    if (!last) {
      lastPosRef.current = pos
      return
    }
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()

    lastPosRef.current = pos

    if (!hasContentRef.current) {
      hasContentRef.current = true
      setHasContent(true)
      // différé pour éviter de re-render pendant le stroke
      queueMicrotask(() => onChange(canvas.toDataURL('image/png')))
    }
  }, [disabled, localPos, onChange])

  const finishStroke = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return
    isDrawingRef.current = false
    lastPosRef.current   = null
    ;(e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId)
    const canvas = canvasRef.current
    if (canvas && hasContentRef.current) {
      onChange(canvas.toDataURL('image/png'))
    }
  }, [onChange])

  const handleClear = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, width, height)
    hasContentRef.current = false
    setHasContent(false)
    onChange(null)
  }, [width, height, onChange])

  return (
    <div className="space-y-2">
      <div
        className={`relative w-full overflow-hidden rounded-2xl border-2 bg-white shadow-sm ${
          disabled
            ? 'border-gray-200 opacity-50'
            : hasContent
              ? 'border-[#C62828]'
              : 'border-gray-300'
        }`}
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            width:           '100%',
            height:          '100%',
            touchAction:     'none',
            cursor:          disabled ? 'not-allowed' : 'crosshair',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          onPointerLeave={finishStroke}
        />

        {/* Ligne de signature (repère visuel) */}
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-[20%] left-[8%] right-[8%] border-b border-dashed border-gray-300"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-[2%] left-0 right-0 text-center text-[10px] uppercase tracking-widest text-gray-400"
        >
          Signez ci-dessus
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {hasContent
            ? 'Signature capturée ✓'
            : 'Utilisez votre doigt, un stylet ou la souris'}
        </p>
        <button
          type="button"
          onClick={handleClear}
          disabled={disabled || !hasContent}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 active:bg-gray-50 disabled:opacity-50"
        >
          Effacer
        </button>
      </div>
    </div>
  )
}
