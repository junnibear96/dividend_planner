import { useEffect, useMemo, useRef, useState } from 'react'

type Props = {
  value: string
  onValueChange: (next: string) => void
  suggestions: string[]
  placeholder?: string
  disabled?: boolean
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
}

export default function SymbolAutocompleteInput({
  value,
  onValueChange,
  suggestions,
  placeholder,
  disabled,
  inputMode,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isFocused, setIsFocused] = useState(false)

  const items = useMemo(() => {
    const seen = new Set<string>()
    return suggestions
      .map((s) => String(s ?? '').trim().toUpperCase())
      .filter(Boolean)
      .filter((s) => {
        if (seen.has(s)) return false
        seen.add(s)
        return true
      })
      .slice(0, 10)
  }, [suggestions])

  const show = isFocused && value.trim().length > 0 && items.length > 0

  useEffect(() => {
    function onDocumentMouseDown(e: MouseEvent) {
      const target = e.target as Node | null
      const root = inputRef.current?.parentElement
      if (!root) return
      if (!target) return
      if (!root.contains(target)) setIsFocused(false)
    }

    document.addEventListener('mousedown', onDocumentMouseDown)
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown)
    }
  }, [])

  return (
    <div className="autocomplete">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        disabled={disabled}
        inputMode={inputMode}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          // Let option onMouseDown run first.
          window.setTimeout(() => setIsFocused(false), 0)
        }}
        aria-autocomplete="list"
        aria-expanded={show}
      />

      {show ? (
        <div className="autocompleteList" role="listbox" aria-label="Symbol suggestions">
          {items.map((s) => (
            <button
              key={s}
              type="button"
              className="autocompleteItem"
              onMouseDown={(e) => {
                e.preventDefault()
                onValueChange(s)
                setIsFocused(false)
                window.setTimeout(() => inputRef.current?.focus(), 0)
              }}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
