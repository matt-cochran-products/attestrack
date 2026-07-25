/**
 * Credential masking (BEH CLI.5 / INV-B-10).
 *
 * Every secret value the CLI ever holds is registered here; every string the
 * CLI writes to stdout/stderr — including echoed child-process output and
 * thrown error messages — is passed through `maskSecrets` first, so a secret
 * can never reach the terminal or a log even when a subprocess misbehaves and
 * echoes it back.
 */

const MASK = '***'

/** Secrets shorter than this are not registered (masking 1–5 chars would corrupt arbitrary output). */
const MIN_SECRET_LENGTH = 6

const registeredSecrets = new Set<string>()

export function registerSecret(value: string | undefined | null): void {
  if (typeof value === 'string' && value.length >= MIN_SECRET_LENGTH) {
    registeredSecrets.add(value)
  }
}

/** Replace every registered secret occurrence with `***`. */
export function maskSecrets(text: string): string {
  let out = text
  for (const secret of registeredSecrets) {
    if (out.includes(secret)) {
      out = out.split(secret).join(MASK)
    }
  }
  return out
}

/** Test helper — clears the registry between test cases. */
export function clearRegisteredSecretsForTest(): void {
  registeredSecrets.clear()
}
