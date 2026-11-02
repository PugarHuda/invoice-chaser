# PRD — Invoice Chaser

> An invoice tracker for freelancers paid in USDC on Sui that learns how each client pays, and chases them accordingly.

| | |
|---|---|
| Hackathon | Total Recall — Tatum × Walrus Memory (20 Oct – 10 Nov 2026) |
| Deadline | **10 Nov 2026, 17:00 UTC** (internal target: submit 8 Nov, polish via DM to organizer) |
| Track | **03 — Consumer Finance Apps** |
| Special award target | **Best Tatum AI Builder app** (primary) · Best Use of Agent Payments (stretch) |
| Working name | Invoice Chaser (final name TBD) |
| Status | Draft v1 — 2 Nov 2026 |

---

## 1. Summary

Freelancers and small agencies increasingly get paid in stablecoins. Sending an invoice is easy; **getting paid on time is not**. Every client has habits — Acme always pays 5 days late and only after a second nudge, Beta pays the same day if the tone is formal, Gamma tends to underpay. Today that knowledge lives only in the freelancer's head, and every invoicing tool treats every client the same.

Invoice Chaser:
1. Issues USDC invoices with a payment link.
2. Detects payment on **Sui Mainnet via Tatum's Sui gRPC gateway** and marks invoices paid automatically.
3. Writes every lifecycle event, correction, and learned profile to **Walrus Memory**.
4. Before every reminder, **recalls that client's history** and decides *when* to chase, *in what tone*, and *how hard* — and shows *why*, citing the memories it used.

The product gets visibly sharper with every invoice: payment-date predictions converge, reminders per invoice drop, and the freelancer's cash-flow forecast becomes per-client instead of naive.

## 2. Why this idea (competitive + judging rationale)

| Factor | Evidence |
|---|---|
| **Zero direct competitors** | ~35 public Total Recall repos reviewed (2 Nov). All finance entries handle *outgoing* money (budgets, spend review, payment guards). No one does receivables / invoice chasing. |
| **Measurable learning loop** | Organizer (Discord, 22 Oct): judges care about "the learning loop using Walrus Memory … learned patterns across runs rather than static hardcoded rule checks". Our loop has numbers: prediction error (days) and reminders/invoice, both trending down. |
| **Tatum is load-bearing** | Payment detection is impossible without reading chain state → satisfies "successful Tatum Sui RPC integration" (30% Technical). |
| **AI Builder-friendly** | CRUD + one chain watcher + one memory panel. Fits a single dense prompt. |
| **Web2-relatable, blockchain invisible** | Everyone understands "my client pays late". Freelancer sees "Paid ✓", not hashes (Track 03 brief). |
| **Natural x402 extension** | An invoice is a payable resource → `HTTP 402` endpoint a client's AP agent can pay on Sui Mainnet. |

Organizer ruling to respect: they "will probably reward more projects rather than multiple prizes to one" → optimise for **Track 03 1st + AI Builder**, treat Agent Payments as optional.

## 3. Users

**Primary — Maya, independent designer (persona).** 6–10 active clients across 3 countries, invoices 2–6 times/month, gets paid in USDC to a Sui wallet. Pain: spends hours each month chasing, feels awkward about tone, cannot predict next week's cash.

**Secondary — Client's AP agent (machine user).** An automated accounts-payable agent that can pay invoices via HTTP 402 (stretch feature).

**Judge (meta-user).** Has ~5 minutes. Must see the learning loop and the Mainnet proof without setup.

## 4. Goals & non-goals

### Goals
- G1. Learning loop visible in < 60 s of demo: same client, same situation, different behaviour before vs. after memory.
- G2. Every payment detection verified on Sui Mainnet through Tatum gRPC.
- G3. ≥ 10 meaningful memories on Walrus Mainnet (target: 40+ across 4 clients).
- G4. App generated from Tatum AI Builder, with the prompts and output committed in the repo.
- G5. "Total Recall mode": wipe the local DB → client profiles rebuilt purely from Walrus Memory.

### Non-goals (explicitly out of scope)
- Multi-tenant auth, teams, roles. One workspace, passcode-protected.
- Fiat rails, tax, accounting exports, multi-currency, multi-chain.
- Custody or sending funds on the freelancer's behalf.
- Legal collections / late fees enforcement.
- Mobile app.

## 5. Success metrics (shown in-app and in the blog)

| Metric | Definition | Target in demo data |
|---|---|---|
| Pay-date MAE | mean abs. error (days) of predicted vs. actual pay date, per invoice sequence | invoice #1: ~5 d → invoice #4: ≤ 1 d |
| Reminders per paid invoice | count of reminders sent before payment | drops ≥ 30% after profile exists |
| Tone hit-rate | % of reminders followed by payment within 3 days | per-client, shown with sample size |
| Memory citations | % of agent decisions that cite ≥ 1 recalled memory | 100% once history exists |

## 6. Scope

### MUST (MVP — required for submission)
- M1. **Clients**: create / list (alias, payer wallet optional, preferred contact, notes).
- M2. **Invoices**: create with amount (USDC), due date, line items; unique payable amount (see §8.3); status `draft → sent → overdue → paid | partial`.
- M3. **Public pay page** `/pay/:invoiceId`: amount, recipient, QR; connect Sui wallet and pay (dApp Kit) **or** paste a tx digest.
- M4. **Payment verification** via Tatum Sui gRPC (§8): digest verification + balance-change watcher.
- M5. **Memory writes** to Walrus Mainnet on every lifecycle event (§7.2).
- M6. **Client profile** computed from history: median delay, reminders needed, tone hit-rates, underpay rate, predicted pay date + confidence.
- M7. **Next-action engine** per open invoice: when to remind, which tone, draft text — with "Why?" panel listing cited memories.
- M8. **Freelancer feedback** captured as memory (e.g. "Never chase Acme before the 10th", "CC Jane at Acme") and obeyed afterwards.
- M9. **/proof page**: live Tatum calls (latest checkpoint, wallet USDC balance), memory count per namespace, sample memories, Walruscan/Suiscan links, relayer health.
- M10. **Judge path** on home page: "I'm a judge →" guided 5-stop tour over seeded data (seed disclosed).
- M11. README + architecture diagram + "what's real vs. seeded" table.

### SHOULD
- S1. **Total Recall mode** button: clears local profile cache and rebuilds from Walrus Memory (`recall` + `restore`), with a progress log.
- S2. **Learning chart**: pay-date prediction error per invoice # for each client.
- S3. **Cash-flow forecast**: expected USDC inflow next 7/30 days, per-client weighted.
- S4. Reminder **email send** (Resend) — otherwise "Copy reminder" button.

### COULD (stretch, only if MUST+SHOULD done by 7 Nov)
- C1. **x402 invoice endpoint** for AP agents (§9) + a tiny demo payer agent script → Best Use of Agent Payments.
- C2. Claude Code / MCP portability demo: ask "which clients are late?" from Claude Code using the same Walrus Memory account (MemWal plugin).
- C3. SuiNS name resolution for client wallets (`NameService`).

## 7. The learning loop (core)

### 7.1 Loop
```
 invoice event ──► write memory (Walrus) ──► recompute client profile ──► write profile snapshot (Walrus)
       ▲                                                                          │
       │                                                                          ▼
 payment detected (Tatum gRPC) ◄── reminder sent ◄── next-action engine ◄── recall(client history + prefs)
```
Principle: **AI proposes, code decides.** Statistics and scheduling are deterministic code; the LLM only drafts reminder text and parses free-text feedback into structured preferences.

### 7.2 Memory types (plain-text, JSON-tagged so they are both human-readable and parseable)

Every memory is a single line of prose followed by a JSON tag block, e.g.

```
Invoice INV-0012 to Acme (300.004217 USDC) due 2026-11-05 was paid in full on 2026-11-10 (+5 days) after 2 reminders; last reminder tone: formal. tx 7Hk…9pQ
#ic {"v":1,"type":"invoice_paid","client":"acme","invoice":"INV-0012","due":"2026-11-05","paid":"2026-11-10","delay_days":5,"reminders":2,"last_tone":"formal","amount":"300.004217","paid_amount":"300.004217","digest":"7Hk…9pQ"}
```

| type | Written when | Purpose |
|---|---|---|
| `invoice_sent` | invoice marked sent | baseline (amount, due) |
| `reminder_sent` | each reminder | tone, day offset, channel |
| `invoice_paid` / `invoice_partial` | payment verified | delay, reminders, last tone, amounts, digest |
| `preference` | freelancer gives feedback | hard constraints / style rules ("no chasing before 10th") |
| `profile_snapshot` | after each paid invoice | versioned learned profile (`supersedes: vN-1`) |
| `decision` | engine picks next action | what, when, why, `cites: [memory refs]` |

### 7.3 Namespaces
- `ic:<ws>:client:<clientId>` — events, preferences, snapshots for one client (keeps each under the 100-record read cap).
- `ic:<ws>:decisions` — engine decisions (audit trail).
- `ic:<ws>:workspace` — global freelancer preferences ("never send reminders on weekends").
- `ic:<ws>:test` — smoke tests (never shown in product).

### 7.4 Profile model (deterministic)
Per client, from `invoice_paid|partial` + `reminder_sent` events:
- **Delay**: EWMA of `delay_days` (α = 0.5) + median; confidence = `min(1, n/4)`.
- **Predicted pay date** = `due + round(EWMA delay)`; shown with ± range from MAD.
- **Reminders needed**: mean reminders before payment.
- **Tone hit-rate** per tone ∈ {friendly, formal, firm}: Beta(1+hits, 1+misses); hit = payment within 3 days of that reminder. Pick tone with highest posterior mean; if all have n < 2, explore in order friendly → formal → firm.
- **Underpay rate**: partial / total.

### 7.5 Next-action engine
For each open invoice:
1. Recall client namespace (`recall({query:"payment behaviour and preferences of <client>", limit: 20})`) + workspace prefs.
2. Parse `#ic` tags → events/preferences. Rebuild profile (or use cached snapshot if newer).
3. Schedule:
   - No history → default schedule: reminder at due+1 (friendly), due+5 (formal), due+10 (firm).
   - With history → first reminder at `predicted_pay_date − typical_reminder_lead` for clients that pay *after* a reminder; **skip** reminders for clients whose EWMA delay ≤ 1 and hit-rate of "no reminder" is high.
   - Hard constraints from `preference` memories always win (e.g. not before the 10th, not weekends).
4. Draft text via LLM with tone + preferences + client alias (no PII beyond alias).
5. Write a `decision` memory with `cites`.

### 7.6 "Before vs. after" demo contract
Same scenario rendered twice (toggle "Ignore memory"):
| | Ignore memory | With memory |
|---|---|---|
| Reminder date | due+1 | due+4 |
| Tone | friendly | formal (2/2 hits) |
| Prediction | — | "Likely paid 10 Nov (±1 d)" |
| Why panel | empty | 3 cited memories with Walruscan links |

## 8. Tatum / Sui integration

### 8.1 Endpoints & auth
- **Sui Mainnet gRPC**: `sui-mainnet-grpc.gateway.tatum.io:443`, TLS, metadata `x-api-key: $TATUM_API_KEY`. (JSON-RPC is deprecated — do not use.)
- Server-side only; the API key never reaches the browser. Optional: Tatum API key origin/IP allowlist.
- Cost: ~2 credits per gRPC call; free plan 100K lifetime credits, 3 rps → budget ~25K calls, rate-limit our watcher to ≤ 1 rps.

### 8.2 Calls used
| Purpose | Service / method | Notes |
|---|---|---|
| Verify a payment | `LedgerService.GetTransaction(digest)` with read mask incl. `effects.status`, `balance_changes`, `checkpoint`, `timestamp` | Success + `balance_changes` contains `+amount` USDC to freelancer address |
| Detect incoming funds | `StateService.GetBalance(owner, coin_type=USDC)` | Poll every 30 s (cron / on page view); a change triggers reconciliation |
| Proof page "live" | `LedgerService.GetCheckpoint()` (latest) | Shows checkpoint seq + latency |
| (C3) | `NameService.LookupName` | SuiNS → address |

USDC on Sui Mainnet: `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC` (6 decimals) — verify on day 1.

### 8.3 Payment matching (gRPC has no "transactions by address")
- Each invoice gets a **unique payable amount**: base amount + a 4–6 digit micro-suffix (e.g. 300 → `300.004217`). Matching key = exact micro-unit amount to the freelancer's address.
- **Primary path**: pay page with wallet → we receive the digest → `GetTransaction` verifies → paid.
- **Fallback path**: payer pays from elsewhere → pastes digest on pay page, or freelancer pastes it → same verification.
- **Watcher path**: balance increase detected but no digest yet → invoice flagged "payment likely received — awaiting confirmation"; amount delta matched to unique invoice amount.
- Partial payment: amount < expected → status `partial`, memory `invoice_partial`.
- Idempotency: a digest can settle at most one invoice (unique constraint).

### 8.4 Spike to do on day 1
Confirm in Node: `@mysten/sui` gRPC client over native gRPC transport (e.g. `@protobuf-ts/grpc-transport`) with `x-api-key` metadata works against Tatum; else fall back to `@grpc/grpc-js` + `sui-apis/proto` as in Tatum docs.

## 9. Agent Payments (stretch C1)
- `GET /api/x402/invoices/:id` → `402 Payment Required` with JSON terms: `{scheme:"exact", network:"sui:mainnet", asset: USDC, amount, payTo, invoiceId, nonce, expiresAt}`.
- Payer agent pays on Sui Mainnet, retries with header `X-PAYMENT: <digest>`.
- Server verifies via Tatum `GetTransaction` (success, payTo, amount, after nonce issue time, digest unused) → `200` with receipt; invoice → paid; memory `invoice_paid {channel:"x402"}`.
- Demo: `scripts/ap-agent.ts` pays one invoice end-to-end. Micro-amount (e.g. 0.05 USDC) is acceptable per organizers.

## 10. Walrus Memory integration
- SDK: `@mysten-incubation/memwal` (server-side), relayer `https://relayer.memory.walrus.xyz`, account created at `memory.walrus.xyz`.
- Config passed explicitly (SDK does not read env by itself): `key=MEMWAL_PRIVATE_KEY`, `accountId=MEMWAL_ACCOUNT_ID`, `serverUrl`, `namespace` per call/client instance.
- Writes: `remember` + `waitForRememberJob`; seed via bulk in chunks of ≤ 20.
- Reads: `recall({query, limit})` per client namespace; `restore(namespace, 100)` in Total Recall mode.
- Latency budget: recall ~4–5 s → never on hot UI paths; run in background jobs, cache profile snapshot in DB, show "recalled 3 s ago".
- Privacy: default relayer sees plaintext → memories contain **client alias only**, no emails/names/addresses of individuals; documented in README. (Optional upgrade: `MemWalManual` client-side encryption.)
- Failure mode: relayer down → queue writes in DB (`pending_memories`), retry; UI shows "memory pending", never fakes success. (Relayer had an outage 30–31 Oct.)

## 11. UX — screens

1. **Home / Today** — "Expected this week: 1,240 USDC" · overdue list · next actions ("Remind Acme on Thu — formal") · judge-path CTA.
2. **Clients** — list with reliability badge, predicted delay, last paid.
3. **Client detail** — profile card (median delay, tone hit-rates, underpay), **learning chart**, memory timeline (each item links to Walruscan), feedback box ("Tell me something about this client…").
4. **Invoice detail** — status, pay link/QR, reminder plan with **Why?** panel, "Ignore memory" toggle (before/after).
5. **Pay page** (public) — amount, copy address, connect wallet & pay, paste digest; success screen with Suiscan link.
6. **/proof** — live Tatum + Walrus checks, counts, links, seed disclosure.
7. **Total Recall mode** (settings) — wipe cache → rebuild from Walrus, streaming log.

Design: clean, finance-tool feel (light/dark), no crypto jargon on product screens; hashes only on /proof and in "Why?" links.

## 12. Architecture

```
Browser (Next.js UI, dApp Kit on /pay only)
   │
Next.js server (route handlers / server actions)
   ├── Tatum Sui gRPC  (verify, balance, checkpoint)      ← x-api-key, server only
   ├── Walrus Memory relayer (remember/recall/restore)   ← delegate key, server only
   ├── LLM (reminder drafting, feedback → preference)    ← via AI Gateway
   ├── Postgres (invoices, clients, cache, pending_memories)
   └── Cron (every 1 min: balance watcher, reminder scheduler, memory retry)
```
- Hosting: Vercel (organizer-recommended for AI Builder output). DB: Neon Postgres (free). Email (S4): Resend.
- Stack follows whatever Tatum AI Builder generates; above is the target if we must choose.

### Data model (minimal)
- `clients(id, alias, payer_address?, contact?, created_at)`
- `invoices(id, client_id, number, amount, pay_amount UNIQUE, due_date, status, sent_at, paid_at, paid_amount, digest UNIQUE)`
- `reminders(id, invoice_id, tone, scheduled_for, sent_at, channel)`
- `profiles(client_id, snapshot_json, version, updated_at)` — cache only, rebuildable from Walrus
- `pending_memories(id, namespace, text, attempts, last_error)`

### Env
`TATUM_API_KEY, SUI_PAYEE_ADDRESS, USDC_COIN_TYPE, MEMWAL_PRIVATE_KEY, MEMWAL_ACCOUNT_ID, MEMWAL_SERVER_URL, DATABASE_URL, AI_GATEWAY_API_KEY, RESEND_API_KEY (opt), APP_PASSCODE`

## 13. Tatum AI Builder plan (3 free prompts)

| Prompt | Content | Goal |
|---|---|---|
| **P1 (the big one)** | Full product: screens §11, data model §12, Tatum Sui gRPC verification + balance watcher, Walrus Memory write/recall module, pay page | Working shell + Tatum wiring |
| P2 | Fix what P1 broke / missing pieces (usually env + gRPC transport) | Running build |
| P3 | Reserve (learning chart or /proof) | — |

Then: export to GitHub → continue in Claude Code (allowed by organizer as long as AI Builder origin is in the repo).
Evidence to commit: `docs/ai-builder/prompts.md` (verbatim prompts), screenshots of builder sessions, the initial generated commit tagged `ai-builder-v0`.

## 14. Demo data & Mainnet evidence
- 4 seeded clients with distinct behaviours: **Acme** (late +5, needs 2 reminders, formal works), **Beta** (on time, no reminders), **Gamma** (underpays ~10%), **Delta** (new — no history, shows default behaviour).
- 12–16 historical invoices generated by running **the real engine** over a scripted timeline and writing to Walrus Mainnet (seed disclosed on /proof and README).
- **Live Mainnet payments**: ≥ 3 real USDC payments (micro amounts) from our second wallet during the demo period, verified via Tatum.
- Target ≥ 40 memories on Mainnet (requirement: ≥ 10).

## 15. Timeline (today = Mon 2 Nov)

| Date | Deliverable |
|---|---|
| **Mon 2 Nov** | PRD ✓ · Tatum account + API key · Walrus Memory account + delegate key · AI Builder P1 |
| Tue 3 Nov | P2 · repo export · gRPC spike (§8.4) · MemWal smoke test on Mainnet |
| Wed 4 Nov | Payment verification end-to-end on Mainnet (pay page → digest → paid) · memory writes |
| Thu 5 Nov | Profile model + next-action engine + Why panel · feedback → preference |
| Fri 6 Nov | Seed script on Mainnet · /proof · judge path · learning chart |
| Sat 7 Nov | Total Recall mode · polish · (stretch) x402 |
| Sun 8 Nov | Demo video (2–3 min) · blog post · README · **submit** |
| Mon 9 Nov | Social posts (X + LinkedIn, tag @Tatum_io @WalrusProtocol @WalrusFoundation) · DM Ted for feedback · fixes |
| Tue 10 Nov | Buffer — final swap of video/links before 17:00 UTC |

## 16. Demo video script (≈ 2:30)
1. 0:00 Hook — "Maya chases 8 clients a month. Her tools treat every client the same."
2. 0:15 Create invoice for Delta (new) → default plan.
3. 0:35 Open Acme invoice → toggle **Ignore memory** on/off → plan shifts to due+4, formal; Why panel cites memories (click → Walruscan).
4. 1:05 Client pays on Mainnet via pay page → Tatum verifies → "Paid ✓" → new memory + profile v5 appears; learning chart drops.
5. 1:30 Freelancer types "Never chase Acme before the 10th" → next plan obeys it.
6. 1:50 Total Recall mode → wipe → rebuilt from Walrus.
7. 2:10 /proof — live checkpoint, memory counts. (Stretch: AP agent pays via 402.)
8. 2:25 Close — "Every invoice makes the next one easier."

## 17. Submission checklist
- [ ] Walrus Memory writing on Mainnet; ≥ 10 memories (target 40+)
- [ ] Tatum Sui gRPC used in product paths (verify, balance, checkpoint)
- [ ] Public repo with detailed README, architecture, real-vs-seeded table, AI Builder evidence
- [ ] Live demo URL (Vercel)
- [ ] Demo video 2–3 min (YouTube unlisted)
- [ ] Blog post (dev.to) — what it does / how it uses Tatum + Walrus / how it learned over time (with the MAE chart) — also posted in Tatum `#hall-of-posts`
- [ ] Form: Tatum ID, SUI address, Account ID (SUI), MEMWAL_AGENT_ID (fill per form + list both IDs in description), LinkedIn
- [ ] Feedback fields incl. one Walrus Memory friction point; AI Builder experience
- [ ] Social post links (extra points)

## 18. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| AI Builder output unusable / credits exhausted | High | One dense P1; keep P2/P3 for fixes; continue in Claude Code (allowed) |
| Tatum gRPC transport issues in Node/Vercel | High | Day-1 spike; fallback `@grpc/grpc-js`; worst case route via Node runtime function |
| Tatum free credits exhausted | Med | ≤ 1 rps watcher, cache; fallback public RPC + README note (organizer: no penalty) |
| Walrus relayer outage / latency | Med | `pending_memories` queue; recall off hot paths; record video early |
| Mainnet USDC payment UX (wallet issues) | Med | Paste-digest fallback; test with 2 wallets early |
| "Memory is decorative" perception | High | Before/after toggle, Why panel with citations, MAE chart, Total Recall mode |
| Seeded data looks fake | Low | Seed via real engine, disclosed; plus ≥ 3 live Mainnet payments |

## 19. Open questions
1. Final product name.
2. Email sending (Resend) in MVP or "copy reminder" only?
3. Which wallets act as freelancer / client in the demo (need ~1 USDC + a little SUI for gas on Mainnet).
4. Go for x402 stretch? Decide on 7 Nov based on progress.
