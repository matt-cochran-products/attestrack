# Security Policy

## Status

This repository is currently **private / pre-launch**. The policy below applies now and after the repository becomes public.

## Reporting a vulnerability

Please report vulnerabilities **privately** via GitHub Security Advisories:

**[Report a vulnerability](https://github.com/matt-cochran/attestrack/security/advisories/new)** (repository **Security** tab → *Report a vulnerability*).

Please do **not** open public issues or pull requests for security problems, and do not disclose details publicly before a fix is released.

What to include:

- Affected package(s) (e.g. `@attestrack/worker-core`, `@attestrack/sdk`) and commit/version
- Reproduction steps or a proof of concept
- Impact assessment (what an attacker gains)

## Threat model

The maintained threat model (assets, adversaries, data flows, findings register, and the CI gates that guard it) lives at [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

## Scope of particular interest

- Consent token forgery, expiry/rotation bypass (`packages/sdk/src/consent-token.ts`)
- Explore SQL gate bypass — read access beyond the allowlisted tables (`packages/schema/src/explore-sql.ts`, INV-B-14/15)
- CORS / consent-cookie issues that leak tokens across origins (`packages/worker-core/src/cors.ts`, ADR-012)
- Secrets handling in the deploy CLI (`packages/deploy`)

## What to expect

- Acknowledgement as soon as practical (this is a maintainer-run open-source project; please allow up to 7 days)
- Coordinated disclosure: we will work with you on a fix and credit you in the advisory if you wish

## No bug bounty

There is **no bug bounty program**. Reports are appreciated and credited, but no monetary reward is offered.

## Supported versions

Pre-1.0: only the latest state of the default branch is supported. No packages are published to npm yet; once publishing begins, the latest published minor of each `@attestrack/*` package will be the supported line.
