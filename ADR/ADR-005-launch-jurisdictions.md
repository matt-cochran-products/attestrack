# ADR-005: Regulation Matrix Launch Rows (Five Regulations / Mapping Set)

**Status:** Accepted (amended)  
**Date:** 2026-03-24  
**Amended:** 2026-03-25 — **Regulation-first naming**; **ADR-010** (matrix rules apply only with Privacy Consent extension)  
**Closes:** Q5 (Architecture Assessment)  
**Former title:** Five Jurisdictions at Launch

## Context

Launch needs a concrete **regulation matrix**: rows for California (CCPA/CPRA), EU (GDPR), Virginia (VCDPA), Colorado (CPA), and **DEFAULT**. **Jurisdiction** in payloads remains the **technical mapping key** from geo/signal → row (CONSENT-ARCHITECTURE). Operator UI uses **regulation** language (ADR-010).

## Decision

Five rows at launch: **US-CA**, **EU-GDPR**, **US-VA**, **US-CO**, **DEFAULT**. Two `ConsentConfig` fields: `precedence` and `profile_floor`.

**Scope (ADR-010):** DEFAULT existence, KV expansion, and Worker **refusal to start** if DEFAULT is missing apply **only** when the **Privacy Consent** extension is **active**. **Bare Attestrack** does not load this matrix.

## Structural Assertions

1. When **Privacy Consent** is active, the Worker SHALL verify **DEFAULT** exists in KV before serving consent-gated traffic; if missing, SHALL refuse to start.  
2. When the extension is active, adding a row SHALL be a data write without Worker code redeploy.  
3. Overlapping applicability: highest `precedence` wins; ties → most-restrictive union.  
4. `profile_floor` SHALL NOT be lowerable by client configuration.  
5. Unmapped geo/signal SHALL fall back to **DEFAULT**.

## FMECA Cross-References

- **FM-PD-05:** DEFAULT provides conservative fallback.
