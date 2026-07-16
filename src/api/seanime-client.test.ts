import { SeanimeClient } from "./seanime-client"

describe("SeanimeClient", () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

  it("unwraps API envelopes and sends the web platform", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }))
    const client = new SeanimeClient({ url: "192.168.1.2:43211", passwordHash: "hash" })
    await expect(client.request("/test")).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith("http://192.168.1.2:43211/test", expect.objectContaining({ headers: expect.objectContaining({ "X-Seanime-Client-Platform": "web", "X-Seanime-Token": "hash" }) }))
  })

  it("throws the server error from an envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "UNAUTHENTICATED" }), { status: 401 }))
    await expect(new SeanimeClient({ url: "http://server", passwordHash: "bad" }).request("/test")).rejects.toThrow("UNAUTHENTICATED")
  })

  it("uses Seanime's POST route when marking an episode complete", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: true }), { status: 200 }))
    const client = new SeanimeClient({ url: "http://server", passwordHash: "" })
    await client.updateProgress(1, 3, 12)
    expect(fetchMock).toHaveBeenCalledWith("http://server/api/v1/library/anime-entry/update-progress", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ mediaId: 1, episodeNumber: 3, totalEpisodes: 12 }),
    }))
  })
})
