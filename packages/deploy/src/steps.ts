import { maskSecrets } from './mask.js'

/**
 * Sequential step announcer (BEH CLI.3): every deploy step prints
 * `[step k/N] label` before it runs, so the user always knows which step they
 * are on and how many remain.
 */
export type StepPrinter = {
  step(label: string): void
  readonly total: number
  readonly current: number
}

export function createStepPrinter(
  total: number,
  write: (s: string) => void = (s) => process.stdout.write(s)
): StepPrinter {
  let current = 0
  return {
    get total() {
      return total
    },
    get current() {
      return current
    },
    step(label: string) {
      current += 1
      write(maskSecrets(`\n[step ${current}/${total}] ${label}\n`))
    }
  }
}
