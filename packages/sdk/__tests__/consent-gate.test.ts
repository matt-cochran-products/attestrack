import { describe, expect, it } from 'vitest'
import { destinationsAllowed, evaluateConsentGate } from '../src/consent-gate.js'

describe('evaluateConsentGate (P2.3 semantics)', () => {
  const optIn = { mechanism: 'opt-in' as const, gpc_honor: true }
  const optOut = { mechanism: 'opt-out' as const, gpc_honor: true }

  it('INV-B-03: SHADOW mode never blocks destinations but records the would-be decision', () => {
    const gate = evaluateConsentGate({
      mode: 'SHADOW',
      row: optIn,
      tokenDecision: null,
      gpcSignal: false
    })
    expect(gate.allowDestinations).toBe(true)
    expect(gate.wouldAllow).toBe(false)
  })

  it('ENFORCEMENT + opt-in requires an affirmative granted decision', () => {
    for (const [decision, expected] of [
      ['granted', true],
      ['declined', false],
      ['withdrawn', false],
      [null, false]
    ] as const) {
      const gate = evaluateConsentGate({
        mode: 'ENFORCEMENT',
        row: optIn,
        tokenDecision: decision,
        gpcSignal: false
      })
      expect(gate.allowDestinations, `opt-in ${String(decision)}`).toBe(expected)
    }
  })

  it('ENFORCEMENT + opt-out allows destinations absent a declined/withdrawn decision', () => {
    for (const [decision, expected] of [
      ['granted', true],
      [null, true],
      ['declined', false],
      ['withdrawn', false]
    ] as const) {
      const gate = evaluateConsentGate({
        mode: 'ENFORCEMENT',
        row: optOut,
        tokenDecision: decision,
        gpcSignal: false
      })
      expect(gate.allowDestinations, `opt-out ${String(decision)}`).toBe(expected)
    }
  })

  it('GPC is honored per row: declines when gpc_honor, ignored otherwise', () => {
    const honored = evaluateConsentGate({
      mode: 'ENFORCEMENT',
      row: optOut,
      tokenDecision: null,
      gpcSignal: true
    })
    expect(honored.gpcApplied).toBe(true)
    expect(honored.effectiveDecision).toBe('declined')
    expect(honored.allowDestinations).toBe(false)

    const notHonored = evaluateConsentGate({
      mode: 'ENFORCEMENT',
      row: { mechanism: 'opt-out', gpc_honor: false },
      tokenDecision: null,
      gpcSignal: true
    })
    expect(notHonored.gpcApplied).toBe(false)
    expect(notHonored.allowDestinations).toBe(true)
  })

  it('missing jurisdiction row behaves as opt-in (safest default)', () => {
    const gate = evaluateConsentGate({
      mode: 'ENFORCEMENT',
      row: null,
      tokenDecision: null,
      gpcSignal: false
    })
    expect(gate.mechanism).toBe('opt-in')
    expect(gate.allowDestinations).toBe(false)
  })
})

describe('destinationsAllowed', () => {
  it('consults the gate when present', () => {
    expect(
      destinationsAllowed({
        consentGate: {
          mode: 'SHADOW',
          mechanism: 'opt-in',
          tokenDecision: null,
          effectiveDecision: null,
          gpcApplied: false,
          wouldAllow: false,
          allowDestinations: true
        }
      })
    ).toBe(true)
  })

  it('falls back to strict opt-in token semantics when the gate has not run', () => {
    expect(destinationsAllowed({})).toBe(false)
    expect(
      destinationsAllowed({
        consent: {
          raw: 't',
          payload: {
            v: 1,
            siteId: 's',
            decision: 'granted',
            issuedAt: new Date().toISOString(),
            policyHash: 'h'
          }
        }
      })
    ).toBe(true)
  })
})
