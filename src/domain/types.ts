export type MediaTitle = { english?: string; romaji?: string; native?: string; userPreferred?: string }
export type MediaImage = { large?: string; extraLarge?: string; medium?: string; color?: string }

export interface AnimeMedia {
  id: number
  title?: MediaTitle
  coverImage?: MediaImage
  bannerImage?: string
  description?: string
  episodes?: number
  duration?: number
  format?: string
  status?: string
  genres?: string[]
  synonyms?: string[]
  seasonYear?: number
}

export interface LocalFile {
  path: string
  name: string
  mediaId: number
  metadata?: { episode: number; aniDBEpisode: string; type: EpisodeType }
}

export type EpisodeType = "main" | "special" | "nc"

export interface Episode {
  type: EpisodeType
  displayTitle: string
  episodeTitle: string
  episodeNumber: number
  absoluteEpisodeNumber: number
  progressNumber: number
  aniDBEpisode?: string
  localFile?: LocalFile
  isDownloaded: boolean
  isInvalid: boolean
  episodeMetadata?: { image?: string; length?: number; summary?: string; overview?: string; title?: string }
  baseAnime?: AnimeMedia
}

export interface LibraryEntry {
  mediaId: number
  media?: AnimeMedia
  libraryData?: { unwatchedCount: number; mainFileCount: number; sharedPath: string }
  listData?: { progress?: number; status?: string; score?: number }
}

export interface LibraryCollection {
  continueWatchingList?: Episode[]
  lists?: Array<{ type?: string; status?: string; entries?: LibraryEntry[] }>
  stats?: { totalEntries: number; totalFiles: number; totalShows: number; totalMovies: number; totalSize: string }
}

export interface AnimeEntry extends LibraryEntry {
  episodes?: Episode[]
  nextEpisode?: Episode
  localFiles?: LocalFile[]
  currentEpisodeCount: number
}

export type ContinuityKind = "mediastream" | "onlinestream" | "external_player"
export interface WatchHistoryItem {
  kind: ContinuityKind
  filepath: string
  mediaId: number
  episodeNumber: number
  currentTime: number
  duration: number
  timeUpdated?: string
}
export type WatchHistory = Record<number, WatchHistoryItem>

export interface PlaybackSource {
  mediaId: number
  media: AnimeMedia
  episode: Episode
  localFile: LocalFile
  url: string
  resumePosition: number
  queue: Episode[]
}

export interface MediaSubtitleTrack {
  index: number
  title?: string
  language?: string
  codec: string
  extension?: string
  isDefault: boolean
  isForced: boolean
  isExternal: boolean
  link?: string
}

export interface MediaContainer {
  filePath: string
  hash: string
  streamType: "direct" | "transcode" | "optimized"
  streamUrl: string
  mediaInfo?: {
    extension: string
    size: number
    duration: number
    container?: string
    mimeCodec?: string
    video?: { codec: string; mimeCodec?: string; quality: string; width: number; height: number; bitrate: number; pixFmt: string; colorSpace: string; colorTransfer: string; colorPrimaries: string }
    audios?: Array<{ index: number; title?: string; language?: string; codec: string; mimeCodec?: string; channels: number }>
    subtitles?: MediaSubtitleTrack[]
  }
}

export interface SubtitleCue {
  start: number
  end: number
  text: string
}

export type TrackType = "AUDIO" | "TEXT"
export interface TrackDescriptor {
  index: number
  type: TrackType
  language: string
  title: string
  codec?: string
  source?: "avplay" | "server"
  url?: string
  raw: unknown
}
export interface TrackPreference {
  language: string
  title: string
}
