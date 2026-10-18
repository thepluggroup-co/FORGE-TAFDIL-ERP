import React, { useEffect, useState } from 'react'

export type NumberInputMode = 'integer' | 'decimal' | 'dimension'
export interface NumberInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'onBlur' | 'min' | 'max' | 'step'> {
  value?: string | number | null
  mode?: NumberInputMode
  min?: number | string
  max?: number | string
  step?: number | string
  onChange?: React.ChangeEventHandler<HTMLInputElement>
  onValueChange?: (value: string) => void
  onValueCommit?: (value: number | null) => void
  onBlur?: React.FocusEventHandler<HTMLInputElement>
  onValidationError?: (message: string | null) => void
}

const normalizeDraft = (raw: string, mode: NumberInputMode) => {
  let value = raw.replace(',', '.').replace(/[^0-9.]/g, '')
  const [whole = '', ...fraction] = value.split('.')
  const trimmed = whole.replace(/^0+(?=\d)/, '')
  return fraction.length ? `${trimmed || '0'}.${fraction.join('')}` : trimmed
}

const draftFromValue = (value: NumberInputProps['value']) =>
  value == null || value === 0 || value === '0' ? '' : String(value)

export function NumberInput({
  value, mode = 'integer', min, max, step: _step, onChange, onValueChange, onValueCommit, onBlur, onValidationError,
  required, inputMode, className, ...props
}: NumberInputProps) {
  const isRequired = required ?? (min != null && Number(min) > 0)
  const [draft, setDraft] = useState(() => draftFromValue(value))
  const [focused, setFocused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (!focused) setDraft(draftFromValue(value)) }, [value, focused])

  const change = (next: string) => {
    const clean = normalizeDraft(next, mode)
    setDraft(clean)
    setError(null)
    onValidationError?.(null)
    onValueChange?.(clean)
  }
  const commit = () => {
    if (draft === '') {
      const message = isRequired ? 'Ce champ est obligatoire.' : null
      setError(message)
      onValidationError?.(message)
      onValueCommit?.(null)
      return
    }
    const parsed = Number(draft.replace(',', '.'))
    if (!Number.isFinite(parsed) || (mode === 'integer' && !Number.isInteger(parsed))) {
      const message = mode === 'integer' ? 'Saisissez un nombre entier.' : 'Saisissez un nombre valide.'
      setError(message)
      onValidationError?.(message)
      onValueCommit?.(null)
      return
    }
    if ((min != null && parsed < Number(min)) || (max != null && parsed > Number(max))) {
      const message = min != null && parsed < Number(min)
        ? `La valeur doit être au moins ${min}.`
        : `La valeur doit être au plus ${max}.`
      setError(message)
      onValidationError?.(message)
      onValueCommit?.(null)
      return
    }
    setError(null)
    onValidationError?.(null)
    onValueCommit?.(parsed)
    setDraft(String(parsed))
  }
  const step = (direction: 1 | -1) => {
    const current = draft === '' ? 0 : Number(draft.replace(',', '.'))
    const next = Math.max(0, current + direction)
    change(String(next))
    onValueCommit?.(next)
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        {...props}
        type="text"
        inputMode={inputMode ?? (mode === 'integer' ? 'numeric' : 'decimal')}
        value={draft}
        required={isRequired}
        className={className}
        aria-invalid={!!error || undefined}
        onFocus={() => setFocused(true)}
        onChange={(event) => {
          change(event.target.value)
          event.currentTarget.value = normalizeDraft(event.target.value, mode)
          onChange?.(event)
        }}
        onWheel={(event) => { if (document.activeElement !== event.currentTarget) event.preventDefault() }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            step(event.key === 'ArrowUp' ? 1 : -1)
          }
        }}
        onBlur={(event) => { commit(); setFocused(false); onBlur?.(event) }}
      />
      <button type="button" aria-label="Diminuer de 1" onClick={() => step(-1)}>-</button>
      <button type="button" aria-label="Augmenter de 1" onClick={() => step(1)}>+</button>
      {error && <span role="alert" className="text-red-600">{error}</span>}
    </span>
  )
}
