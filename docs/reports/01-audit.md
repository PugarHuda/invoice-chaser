# 01 · Audit (Tech Lead)

Date: 2026-11-08 · commit `cc9ea1f` (live on production) · Hackathon: Total Recall (Tatum × Walrus Memory), Track 03 Consumer Finance · Sui Mainnet

## Summary

Submission readiness: **~95%**. The form is submitted, and the app, video, deck and README are live. The rest needs the owner's accounts or keys (see `docs/REPORT.md`, Blockers).

Fresh checks on this run:

| Check | Result |
|---|---|
| `npm run lint` / `npm run typecheck` | clean / clean |
| `npm test` (node:test) | 40 pass, 0 fail |
| `npm audit` | 0 high/critical. 2 moderate in `mppx` (no fix upstream, EVM-only path). A new `minimatch` advisory (GHSA-g3hv-75wg-m249, dev dependency via `typescript-eslint`) was fixed in this pass with an override to `minimatch@11.0.5` |
| Production `/api/version` | `cc9ea1f`, env production |
| `/proof` gateway | `connected` (Tatum Sui gRPC), latest checkpoint 342838294 |
| Memory-chain audit (live) | 7/7 payment memories match the chain, 1 Tatum call; chain→memory 7/7 recorded, 0 unrecorded (117 transactions scanned) |
| CI (GitHub Actions) | last 3 runs on `main` green (run 42397856573: checks + E2E against prod) |

## Contracts

The project deploys **no custom Move contract**, on purpose. Payments go through Mysten's audited **Sui Payment Kit** shared registry (`process_registry_payment`, nonce = invoice id), so the chain refuses a duplicate payment. The function shape is checked live on `/proof` (`MovePackageService.GetFunction`). Mainnet tx proof is listed in `docs/reports/03-kontrak.md`.

## Inventory: claimed vs working

Every feature in the README was exercised against production or Mainnet in earlier rounds, with tx links in the README. Nothing in the UI is a mock. The placeholder grep (`TODO|FIXME|lorem|coming soon|mock|dummy` over `src/` and `server/`) returns **0 hits**.

Seeded data is disclosed: 38 history memories (Aug–Oct 2026) carry `"seed": true` and are labelled in the UI and on `/proof`. They are not mocks. They are real Walrus memories written in the app's own format.

## Sponsor integration depth

| Sponsor tool | Depth | Bounty requirement met |
|---|---|---|
| Walrus Memory (MemWal) | **Deep**: system of record (state rebuilt from Walrus on boot), `remember`/`recall`/`analyze`/`restore`/`listMemories`, sharding, incremental sync, durability audit | yes, it is the learning loop |
| Tatum Sui gRPC gateway | **Deep**: 17 methods across Ledger/State/Subscription/MovePackage/NameService/SignatureVerification/TransactionExecution | yes, every payment is verified through Tatum |
| Tatum Data API | Medium: USD rates on `/proof` and fees | — |
| Tatum Malicious Address API | Medium: every payer screened | — |
| Tatum AI Builder | Origin of the app (tag `ai-builder-v0`, `docs/ai-builder/prompts.md`) | yes |

## Findings in this pass

| ID | Category | Severity | Location | Description | Status |
|---|---|---|---|---|---|
| A-1 | Dependency | Medium | `package.json` | `minimatch` <11.0.1 (ReDoS-style DoS) through `typescript-eslint`, dev only | fixed (override) |
| A-2 | Docs | Low | `README.md` §Factur-X | still said the demo seller is a placeholder; prod now serves `Pugar Huda Mantoro` | fixed |
| A-3 | Process | Low | repo | per-phase reports were missing from the repo | fixed (this folder) |

Earlier audit rounds (passcode oracle, lockout order, double submit, array amount, FailedTransaction settle, CSV injection and more) are fixed and listed in `05-keamanan.md` and `06-qa.md`.
