import { useMemo, useState } from "react"
import type { LibraryCollection, LibraryEntry } from "../domain/types"
import { localEntries } from "../domain/library"
import { rankSearch } from "../domain/search"
import { storage } from "../lib/storage"
import { Focusable } from "../ui/Focusable"
import { Keyboard } from "../ui/Keyboard"
import { MediaCard } from "../ui/MediaCard"

export function SearchScreen({ collection, onOpen }: { collection: LibraryCollection; onOpen: (id: number) => void }) {
  const [query, setQuery] = useState("")
  const [recentIds, setRecentIds] = useState(storage.getRecentSearchTitles)
  const local = useMemo(() => localEntries(collection), [collection])
  const entries = useMemo(() => rankSearch(local, query), [local, query])
  const recent = useMemo(() => recentIds
    .map(id => local.find(entry => entry.mediaId === id))
    .filter((entry): entry is LibraryEntry => entry !== undefined), [local, recentIds])
  const open = (mediaId: number) => {
    storage.addRecentSearchTitle(mediaId)
    setRecentIds(storage.getRecentSearchTitles())
    onOpen(mediaId)
  }
  const clearRecent = () => { storage.clearRecentSearchTitles(); setRecentIds([]) }

  return <div className="screen search-screen">
    <div className="search-input"><span>⌕</span><strong>{query || "Search your local library"}</strong><i>{query.length}</i></div>
    <div className="search-layout"><Keyboard value={query} onChange={setQuery} /><section className="search-results">
      {!query && recent.length > 0 && <>
        <div className="section-heading"><h2>Recently opened</h2><Focusable className="clear-history" onEnter={clearRecent}>Clear</Focusable></div>
        <div className="result-grid recent-grid">{recent.map(entry => <MediaCard key={entry.mediaId} entry={entry} onOpen={() => open(entry.mediaId)} />)}</div>
      </>}
      <h2>{query ? `Results for “${query}”` : recent.length ? "Suggestions" : "Your library"}</h2>
      <div className="result-grid">{entries.map(entry => <MediaCard key={entry.mediaId} entry={entry} onOpen={() => open(entry.mediaId)} />)}</div>
      {!entries.length && <p className="empty">No local titles match this search.</p>}
    </section></div>
  </div>
}
