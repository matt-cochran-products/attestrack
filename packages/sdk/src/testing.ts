import type { HostRuntime, HostKeyValue } from '@attestrue/host-contracts'

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
}

export function createMockHostRuntime(options: MockHostOptions = {}): HostRuntime {
  const kv = new MemoryKv()
  const secrets = options.secrets ?? {}
  const backgrounds: (() => void | Promise<void>)[] = []
  return {
    kv,
    geoCountry: () => options.geoCountry ?? null,
    scheduleBackground(task) {
      backgrounds.push(task)
    },
    getSecret(name) {
      return secrets[name]
    }
  }
}
