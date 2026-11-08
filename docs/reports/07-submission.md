# 07 · Deploy, submission and pitch (DevOps & Submission)

## Build and CI

- `.github/workflows/ci.yml` runs on every push and PR: lint, typecheck, unit tests, build, `npm audit --audit-level=high`.
- On `main` the workflow then waits for production `/api/version` to equal the commit and runs Playwright against it.
- On PRs Playwright runs against a local server built from repository secrets (not set yet; see Blockers in `docs/REPORT.md`).
- The HTML report is uploaded as an artifact.

## Deployment

- Production: https://invoice-chaser-sigma.vercel.app (Vercel, Git auto-deploy from `main`), serving `cc9ea1f` on 2026-11-08.
- Vercel spend budget: $60, with pause on.
- `.env.example` lists every variable and how to get it.

## Materials

| Item | Link |
|---|---|
| Demo video (2:08) | https://youtu.be/nCpQtlcQF-0 |
| Pitch deck | GitHub release `demo-v4` (PPTX/PDF) |
| Blog | dev.to/hudapugar |
| Social | X, LinkedIn, Tatum Discord #hall-of-posts |
| Form | **submitted** (Total Recall site modal: "Congrats, your project has been submitted!") |
| Tatum Ecosystem developer profile | filled; waiting for the owner's wallet signature |

## Final checklist

- [x] Live demo on Sui Mainnet
- [x] Walrus Memory as the learning loop
- [x] Tatum Sui gRPC
- [x] AI Builder origin committed
- [x] Video 2–3 min
- [x] Deck
- [x] README with positioning, competitors, sponsor sections, architecture, tx proof
- [x] Form submitted
- [ ] `PRIVATE_READS=1` after judging (owner)
