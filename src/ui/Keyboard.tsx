import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation"
import { Focusable } from "./Focusable"

const ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
  [".", ":", "/", "-", "SPACE", "⌫", "CLEAR"],
]

export function Keyboard({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { ref, focusKey } = useFocusable({ trackChildren: true })
  const press = (key: string) => {
    if (key === "⌫") onChange(value.slice(0, -1))
    else if (key === "CLEAR") onChange("")
    else if (key === "SPACE") onChange(`${value} `)
    else onChange(value + key.toLocaleLowerCase())
  }
  return <FocusContext.Provider value={focusKey}><div ref={ref} className="keyboard">
    {ROWS.map((row, rowIndex) => <div className="keyboard-row" key={rowIndex}>
      {row.map(key => <Focusable key={key} className={`key key-${key.toLocaleLowerCase()}`} onEnter={() => press(key)}>{key}</Focusable>)}
    </div>)}
  </div></FocusContext.Provider>
}
