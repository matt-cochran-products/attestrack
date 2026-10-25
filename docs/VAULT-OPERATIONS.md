# Credential ownership and vault operations

Reviewed 2026-10-21 against `SELF-HOSTING.md` and the ClickHouse ingestion and
Explore implementations. This guide defines operating responsibilities, not
evidence that a particular installation is deployed.

## Ownership

Attestrack defines the required configuration and consumes runtime credentials.
The installation operator owns infrastructure, secret custody, access grants,
backups, deployment and recovery. No particular password manager is required.
Company-specific account IDs, vault bindings and live credentials do not belong
in this public repository.

If using OPV, distinguish the values boundary from the delivery target. A
boundary is the vault whose complete contents an identity can read. The target
is a deployment placement. Its state vault holds sensitive delivery evidence,
not a second authoritative password. Grant a deployment identity values read
and evidence read/write only for its own scope; never give it the entire
organization's infrastructure vault for convenience.

## Separate the identities

| Identity | Required responsibility | Must not receive |
| --- | --- | --- |
| Warehouse bootstrap administrator | Initialize users/schema; controlled maintenance and recovery | Browser exposure or use as routine ingestion identity |
| Site/environment ingestion | Insert events for its authorized scope | Administrative or unrestricted query access |
| Explore query service | Read only its authorized data | Insert or user-management authority |
| Portal server/proxy | Authenticate authorized portal requests | Credentials embedded in a client bundle |
| Deployment automation | Deliver declared runtime settings to the selected placement | Unrelated product/environment credentials |

Current ClickHouse ingestion and Explore both read `CLICKHOUSE_USER` and
`CLICKHOUSE_PASSWORD`. Different insert/query URLs alone do not create separate
identities. A deployment requiring separate read-only Explore authority must
implement and verify that separation in code or an authenticated gateway before
activation. Do not describe a shared bootstrap credential as read-only.

`CONSENT_TOKEN_SECRET` signs consent tokens; its documented previous-key window
supports rotation. `PORTAL_API_SHARED_SECRET` is server-side defense in depth:
never include it in the portal SPA. Protect both the real-data portal and its
Worker API. See [self-hosting](SELF-HOSTING.md) for required settings and topology.

## Setup and ordinary releases

1. Declare the environment, credential roles and deployment placement in the
   operator's infrastructure repository. Check existing store metadata before
   creating new vaults. Prefer one boundary per access population, not per file.
2. Review a structure-only plan; the owner applies store changes. Generate
   application-owned keys without displaying them. Preserve existing immutable
   keys and never replace an unknown value just to satisfy a setup check.
3. Configure target-scoped automation. Keep actual values out of Git, shell
   history, logs, build arguments, test artifacts and browser bundles.
4. Qualify with fictional data, then promote the same tested artifact. Deliver
   credentials through protected automation and verify target delivery.
5. Separately verify a uniquely tagged fictional event traverses ingestion,
   reaches the expected warehouse/site/environment and appears in the
   authenticated dashboard. A health check or delivery receipt cannot prove it.
6. Preserve consent, retention and applicable SHADOW controls during rollout.

## Diagnosis, rotation and recovery

Use status and redacted delivery metadata first. Missing bindings mean incomplete
setup; missing evidence means unverified delivery. Neither warrants duplicate
vaults or automatic password regeneration. Check endpoint reachability,
authentication, schema and per-site filters as separate stages.

Rotate one credential role at a time with a reviewed consumer inventory and
rollback plan. Updating an environment password does not necessarily update a
persisted database user. Verify the server-side credential change and all
consumers. Preserve consent signing-key overlap as documented. Recovery must
restore compatible data and keys, then prove a new fictional event end to end.

For MC Product Labs deployments, the private infra repository's
`docs/runbooks/vault-ownership.md` owns actual placement and bindings. This public
guide intentionally carries no private inventory. Marketing publication and
outbound permissions are separate from telemetry deployment permissions.

## How OPV manages these credentials

OPV is a CLI, not a runtime secret server. The operator's infrastructure
`secrets.toml` declares names, sources, rules, environments, boundaries and
targets. Adjacent `secrets.bindings.toml` records real vault/item IDs produced
by owner apply; `secrets.applied.json` records applied contract metadata.
Applications read delivered platform secrets, not 1Password on every request.

These OPV 0.14 inspection templates require the actual reviewed contract and
its declared environment/target. They do not establish a deployment binding:

```sh
opv --config <contract> contract
opv --config <contract> inventory --env <environment>
opv --config <contract> propose structure --project <project>
opv --config <contract> status <environment> --target <target>
opv --config <contract> plan <environment> --target <target>
opv --config <contract> delivery verify <environment> --target <target> --json
```

Only `contract` is offline. Other inspections require authorized access and
may inspect secret material internally: run them in the owner or protected
CI context, never an agent holding values. Only the owner runs the reviewed
`opv apply <plan-id> --project <project>`. Protected automation runs the approved
target `sync`. Structure creation, password generation, delivery verification
and live application acceptance are separate steps. Never infer a contract or
reuse the fleet boundary merely because the service needs a password.

See the versioned [OPV usage guide](https://github.com/matt-cochran/1password-vault/blob/v0.14.0/docs/usage.md).

Use the OPV version pinned by the operator's infra repository. Older examples
using `.opv`, `init`, `add` or `check` are not the 0.14 contract interface;
do not combine their setup steps with a current structure/apply plan.
