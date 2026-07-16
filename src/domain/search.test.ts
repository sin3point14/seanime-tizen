import { rankSearch } from "./search"
import type { LibraryEntry } from "./types"

const entry = (id: number, userPreferred: string, synonyms: string[] = []): LibraryEntry => ({ mediaId: id, media: { id, title: { userPreferred }, synonyms } })

it("ranks exact, prefix, word-prefix, then substring", () => {
  const values = [entry(4, "Superhero Academy"), entry(3, "My Hero Academia"), entry(2, "Hero Academia"), entry(1, "Hero")]
  expect(rankSearch(values, "hero").map(value => value.mediaId)).toEqual([1, 2, 3, 4])
})

it("searches synonyms and limits suggestions", () => {
  const values = [entry(1, "Boku no Hero", ["My Hero Academia"]), ...Array.from({ length: 10 }, (_, i) => entry(i + 2, `Hero ${i}`))]
  expect(rankSearch(values, "my hero")[0].mediaId).toBe(1)
  expect(rankSearch(values, "hero")).toHaveLength(8)
})
