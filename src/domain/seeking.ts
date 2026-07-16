export class QueuedSeekController {
  private pendingTarget: number | null = null
  private inFlight = false
  private generation = 0

  constructor(
    private perform: (targetSeconds: number) => Promise<number>,
    private update: (seconds: number, committed: boolean) => void,
  ) {}

  enqueue(deltaSeconds: number, currentSeconds: number, durationSeconds: number) {
    const base = this.pendingTarget ?? currentSeconds
    const upper = durationSeconds > 0 ? durationSeconds : Number.POSITIVE_INFINITY
    this.pendingTarget = Math.max(0, Math.min(upper, base + deltaSeconds))
    this.update(this.pendingTarget, false)
    void this.drain(this.generation)
    return this.pendingTarget
  }

  reset() {
    this.generation += 1
    this.pendingTarget = null
    this.inFlight = false
  }

  get pending() { return this.pendingTarget }

  private async drain(generation: number) {
    if (this.inFlight || this.pendingTarget === null) return
    const requested = this.pendingTarget
    this.inFlight = true
    let actual = requested
    try { actual = await this.perform(requested) } catch { /* Keep the optimistic target on a failed firmware seek. */ }
    if (generation !== this.generation) return
    this.inFlight = false
    if (this.pendingTarget !== requested) { void this.drain(generation); return }
    this.pendingTarget = null
    this.update(actual, true)
  }
}
