import type { HostRuntime, HostKeyValue } from '@attestrack/host-contracts'

class MemoryKv implements HostKeyValue {
  private readonly m = new Map<string, string>()
  async get(key: string) {
    return this.m.get(key) ?? null
  }
  async put(key: string, value: string) {
    this.m.set(key, value)
  }
  async delete(key: string) {
    this.m.delete(key)
  }
}

export interface MockHostOptions {
  secrets?: Record<string, string | undefined>
  geoCountry?: string | null
  /** Simulated host bot score (P3.4); omit for hosts without bot management. */
  botScore?: number | null
}

const mockBackgroundQueues = new WeakMap<HostRuntime, Array<() => void | Promise<void>>>()

export function createMockHostRuntime(options: MockHostOptions = {}): HostRuntime {
  const kv = new MemoryKv()
  const secrets = options.secrets ?? {}
  const queue: Array<() => void | Promise<void>> = []
  const host: HostRuntime = {
    kv,
    geoCountry: (request: Request) => {
      void request
      return options.geoCountry ?? null
    },
    scheduleBackground(task) {
      queue.push(task)
    },
    getSecret(name) {
      return secrets[name]
    },
    botScore(request: Request) {
      void request
      return options.botScore ?? null
    }
  }
  mockBackgroundQueues.set(host, queue)
  return host
}

/** Runs all tasks scheduled via `scheduleBackground` on a mock host (for tests). */
export async function flushMockBackgroundTasks(host: HostRuntime): Promise<void> {
  const queue = mockBackgroundQueues.get(host)
  if (!queue?.length) return
  const pending = queue.splice(0, queue.length)
  for (const task of pending) {
    await task()
  }
}
