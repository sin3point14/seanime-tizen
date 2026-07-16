import type { LibraryEntry } from "../domain/types"
import { titleFor } from "../domain/search"
import { Focusable } from "./Focusable"

export function MediaCard({ entry, onOpen, focusKey }: { entry: LibraryEntry; onOpen: () => void; focusKey?: string }) {
  const image = entry.media?.coverImage?.extraLarge || entry.media?.coverImage?.large || entry.media?.coverImage?.medium
  return <Focusable onEnter={onOpen} focusKey={focusKey} className="media-card" label={titleFor(entry)}>
    <div className="poster" style={image ? { backgroundImage: `url(${image})` } : undefined}>
      {!image && <span>{titleFor(entry).slice(0, 1)}</span>}
      {(entry.libraryData?.unwatchedCount ?? 0) > 0 && <span className="badge">{entry.libraryData?.unwatchedCount}</span>}
    </div>
    <span className="card-title">{titleFor(entry)}</span>
    <span className="card-meta">{entry.media?.format?.replace(/_/g, " ") || "Anime"}</span>
  </Focusable>
}
