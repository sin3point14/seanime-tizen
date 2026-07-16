import { QueuedSeekController } from "./seeking"

it("accumulates rapid presses while serializing firmware seeks", async () => {
  const resolvers: Array<() => void> = []
  const calls: number[] = []
  const previews: Array<[number, boolean]> = []
  const controller = new QueuedSeekController(async target => {
    calls.push(target)
    await new Promise<void>(resolve => resolvers.push(resolve))
    return target
  }, (seconds, committed) => previews.push([seconds, committed]))
  controller.enqueue(10, 100, 1000)
  controller.enqueue(10, 100, 1000)
  controller.enqueue(10, 100, 1000)
  controller.enqueue(10, 100, 1000)
  expect(controller.pending).toBe(140)
  expect(calls).toEqual([110])
  expect(previews.slice(0, 4)).toEqual([[110, false], [120, false], [130, false], [140, false]])
  resolvers.shift()?.(); await Promise.resolve(); await Promise.resolve()
  expect(calls).toEqual([110, 140])
  resolvers.shift()?.(); await Promise.resolve(); await Promise.resolve()
  expect(previews[previews.length - 1]).toEqual([140, true])
})

it("clamps previews to the playable range", () => {
  const values: number[] = []
  const controller = new QueuedSeekController(async target => target, value => values.push(value))
  expect(controller.enqueue(-20, 5, 100)).toBe(0)
  controller.reset()
  expect(controller.enqueue(20, 95, 100)).toBe(100)
  expect(values[0]).toBe(0)
})
