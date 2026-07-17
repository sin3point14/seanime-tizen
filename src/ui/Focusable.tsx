import { useFocusable } from "@noriginmedia/norigin-spatial-navigation"
import type { CSSProperties, MouseEvent, PropsWithChildren } from "react"

interface Props extends PropsWithChildren {
  onEnter?: () => void
  onFocus?: () => void
  disabled?: boolean
  focusKey?: string
  className?: string
  style?: CSSProperties
  label?: string
  onArrowPress?: (direction: string) => boolean
}

export function Focusable({ children, onEnter, onFocus, onArrowPress, disabled, focusKey, className = "", style, label }: Props) {
  const { ref, focused } = useFocusable({
    focusKey,
    focusable: !disabled,
    onEnterPress: onEnter,
    onArrowPress: direction => onArrowPress?.(direction) ?? true,
    onFocus: () => {
      onFocus?.()
      // Smooth scroll animations repeatedly repaint large TV backdrops and
      // fight rapid D-pad focus changes. An immediate nearest-edge reveal is
      // substantially steadier on Samsung's browser engine.
      requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" }))
    },
  })
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    // Enter/Select is already dispatched by spatial navigation. Browsers also
    // synthesize a click with detail=0 for that key, which used to run actions twice.
    // Real mouse/pointer clicks have a positive detail and remain useful in dev mode.
    if (event.detail > 0) onEnter?.()
  }
  return (
    <button ref={ref} type="button" aria-label={label} disabled={disabled} onClick={handleClick}
      className={`focusable ${focused ? "is-focused" : ""} ${className}`} style={style}>
      {children}
    </button>
  )
}
