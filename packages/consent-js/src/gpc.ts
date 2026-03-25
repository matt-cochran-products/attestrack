/** Detect Global Privacy Control (Chromium / Firefox). */
export function readGlobalPrivacyControl(): boolean {
  if (typeof navigator === 'undefined') return false
  return !!(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl
}
