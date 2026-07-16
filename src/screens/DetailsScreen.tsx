import { FocusContext, setFocus, useFocusable } from "@noriginmedia/norigin-spatial-navigation"
import { useEffect, useMemo, useState } from "react"
import type { SeanimeClient } from "../api/seanime-client"
import { availableEpisode } from "../domain/library"
import { resumePosition } from "../domain/playback"
import { titleFor } from "../domain/search"
import type { AnimeEntry, Episode, PlaybackSource, WatchHistoryItem } from "../domain/types"
import type { PlayerSettings } from "../domain/settings"
import { Focusable } from "../ui/Focusable"

export function DetailsScreen({ mediaId, client, settings, onBack, onPlay }: { mediaId: number; client: SeanimeClient; settings: PlayerSettings; onBack: () => void; onPlay: (source: PlaybackSource) => void }) {
  const [entry, setEntry] = useState<AnimeEntry | null>(null)
  const [history, setHistory] = useState<WatchHistoryItem | undefined>()
  const [error, setError] = useState("")
  const { ref, focusKey } = useFocusable({ focusKey: "DETAILS", trackChildren: true })
  useEffect(() => {
    Promise.all([client.getAnimeEntry(mediaId), client.getHistoryItem(mediaId).catch(() => ({ found: false, item: undefined }))])
      .then(([nextEntry, nextHistory]) => { setEntry(nextEntry); setHistory(nextHistory.item) })
      .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [client, mediaId])
  const episodes = useMemo(() => (entry?.episodes ?? []).filter(ep => ep.type === "main" || availableEpisode(ep)), [entry])

  const play = async (episode: Episode) => {
    if (!entry?.media || !episode.localFile) return
    let saved = history?.episodeNumber === episode.progressNumber ? resumePosition(history, settings.resumeEnabled) : 0
    if (!saved) try {
      const latest = await client.getHistoryItem(mediaId)
      if (latest.item?.episodeNumber === episode.progressNumber) saved = resumePosition(latest.item, settings.resumeEnabled)
    } catch { /* Resume is optional; playback should still start. */ }
    onPlay({ mediaId, media: entry.media, episode, localFile: episode.localFile, url: client.mediaUrl(episode.localFile.path), resumePosition: saved, queue: episodes })
  }

  if (error) return <div className="screen state-screen"><h1>Could not load this title</h1><p className="error">{error}</p><Focusable focusKey="DETAILS_BACK" onEnter={onBack}>Go back</Focusable></div>
  if (!entry) return <div className="screen state-screen"><div className="spinner" /><h2>Loading episodes…</h2></div>
  const media = entry.media
  const title = titleFor(entry)
  const banner = media?.bannerImage || media?.coverImage?.extraLarge
  const description = (media?.description ?? "No description available.").replace(/<[^>]+>/g, "")
  const inProgress = history && resumePosition(history, settings.resumeEnabled) > 0
    ? episodes.find(episode => episode.progressNumber === history.episodeNumber && availableEpisode(episode))
    : undefined
  const nextAvailable = entry.nextEpisode && availableEpisode(entry.nextEpisode)
    ? episodes.find(episode => episode.progressNumber === entry.nextEpisode?.progressNumber)
    : undefined
  const featuredEpisode = inProgress ?? nextAvailable ?? episodes.find(availableEpisode)
  return <FocusContext.Provider value={focusKey}><div ref={ref} className="details-screen">
    <div className="details-backdrop" style={banner ? { backgroundImage: `url(${banner})` } : undefined} />
    <div className="details-gradient" />
    <div className="details-content">
      <Focusable focusKey="DETAILS_BACK" className="back-button" onEnter={onBack}>← Back</Focusable>
      <p className="eyebrow">{media?.format?.replace(/_/g, " ") || "ANIME"} · {media?.seasonYear || ""}</p>
      <h1>{title}</h1>
      <div className="chips"><span>{media?.episodes || episodes.length} episodes</span>{media?.duration && <span>{media.duration} min</span>}{media?.status && <span>{media.status.replace(/_/g, " ")}</span>}</div>
      <p className="description">{description}</p>
      {featuredEpisode && <Focusable className="primary play-button" onEnter={() => play(featuredEpisode)}>▶ {inProgress ? "Resume" : "Play"} {featuredEpisode.displayTitle}</Focusable>}
      <section className="episodes"><h2>Episodes</h2><div className="episode-grid">
        {episodes.map(episode => {
          const available = availableEpisode(episode)
          return <Focusable key={`${episode.type}-${episode.episodeNumber}`} disabled={!available} className="episode-tile" onEnter={() => play(episode)}>
            <span className="episode-number">{episode.episodeNumber}</span><span><strong>{episode.episodeTitle || episode.displayTitle}</strong><small>{available ? (episode.localFile?.name || "Ready to play") : "Unavailable on server"}</small></span>{available && <b>▶</b>}
          </Focusable>
        })}
      </div></section>
    </div>
  </div></FocusContext.Provider>
}
