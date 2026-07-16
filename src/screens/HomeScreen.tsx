import type { LibraryCollection, LibraryEntry } from "../domain/types"
import { localContinueWatching, localEntries } from "../domain/library"
import { titleFor } from "../domain/search"
import { Focusable } from "../ui/Focusable"
import { MediaCard } from "../ui/MediaCard"

export function HomeScreen({ collection, onOpen, onRefresh, refreshing }: { collection: LibraryCollection; onOpen: (id: number) => void; onRefresh: () => void; refreshing: boolean }) {
  const entries = localEntries(collection)
  const continuing = localContinueWatching(collection)
  return <div className="screen home-screen">
    <div className="hero-row"><div><p className="eyebrow">YOUR LOCAL LIBRARY</p><h1>Welcome back.</h1><p>{entries.length} titles ready to play from this server.</p></div>
      <Focusable onEnter={onRefresh} disabled={refreshing}>{refreshing ? "Refreshing…" : "↻ Refresh library"}</Focusable></div>
    {continuing.length > 0 && <section><h2>Continue watching</h2><div className="horizontal-row continue-row">
      {continuing.map((episode, index) => {
        const media = episode.baseAnime
        const entry: LibraryEntry = { mediaId: media?.id ?? episode.localFile?.mediaId ?? 0, media }
        const image = episode.episodeMetadata?.image || media?.bannerImage || media?.coverImage?.large
        return <Focusable key={`${entry.mediaId}-${episode.episodeNumber}`} focusKey={index === 0 ? "HOME_FIRST" : undefined} className="continue-card" onEnter={() => onOpen(entry.mediaId)}>
          <div className="episode-image" style={image ? { backgroundImage: `url(${image})` } : undefined}><span className="play-mark">▶</span></div>
          <strong>{titleFor(entry)}</strong><small>{episode.displayTitle}</small>
        </Focusable>
      })}
    </div></section>}
    <section><h2>On this server</h2><div className="horizontal-row media-row">
      {entries.map((entry, index) => <MediaCard key={entry.mediaId} entry={entry} focusKey={!continuing.length && index === 0 ? "HOME_FIRST" : undefined} onOpen={() => onOpen(entry.mediaId)} />)}
    </div></section>
    {!entries.length && <div className="empty"><h2>No local anime found</h2><p>Scan your library in Seanime, then refresh this screen.</p></div>}
  </div>
}
