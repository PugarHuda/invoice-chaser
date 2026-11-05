// Landing page at "/". Every number on it is read live from the production API (/proof, /summary);
// nothing here is sample copy. The dashboard lives at /?app, a pay link at /?pay=<id>.
import { useEffect, useState } from 'react';
import { Activity, ArrowRight, Bot, Database, ExternalLink, ShieldCheck } from 'lucide-react';

type Proof = {
  tatumSuiGrpc: { gatewayStatus: string; latestCheckpoint: string | null; latencyMs: number | null; network: string };
  walrusMemory: { totalMemories: number; namespaceCount: number; relayerStatus: string; durability?: { daysToEarliestExpiry?: number } };
};
type Summary = { learning: { clients: number; firstError: number; latestError: number; predictions: number } | null; expectedInflow30Days?: string };

const EXPLORER = 'https://suiscan.xyz/mainnet/tx';
const PROOFS = [
  { label: 'Gasless USDC payment', note: 'Payer held no SUI and nobody sponsored gas (Address Balances, gas price 0)', digest: '7oaYHYj24aBSLs8QxTHg7zebAiZycCKkCF6vFPSMcLYA' },
  { label: 'Plain transfer, reconciled', note: 'No nonce and nothing reported to the app: matched by Tatum gRPC ListTransactions', digest: 'CzFhbHnEY6ug3dauaPqmp6CsNkuwfTMtJEGPqRArqkqU' },
];
const STEPS = [
  { icon: Database, title: 'Remembers every client', body: 'Each invoice, reminder, payment and rule is a memory in Walrus Memory. The profile (typical delay, the tone that works, rules like "never before the 10th") is rebuilt from those memories, and every plan cites the memories it used.' },
  { icon: ShieldCheck, title: 'Verifies on Sui through Tatum', body: "Payments are checked on Sui mainnet through Tatum's gRPC gateway: a live checkpoint stream on the pay page, exact-amount matching, Payment Kit nonces, and malicious-address screening of the payer." },
  { icon: Bot, title: 'Gets paid by people and agents', body: 'A wallet, a gasless USDC transfer, or a plain transfer from an exchange. Agents pay over x402 or MPP and read the learned memory through MCP.' },
];

const fmt = (n: number | null | undefined, d = 0) => (n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d }));

export default function Landing() {
  const [proof, setProof] = useState<Proof | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const get = (p: string) => fetch(p).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
    get('/api/chaser/proof').then(setProof).catch(() => setFailed(true));
    get('/api/chaser/summary').then(setSummary).catch(() => setFailed(true));
  }, []);

  const g = proof?.tatumSuiGrpc;
  const w = proof?.walrusMemory;
  const l = summary?.learning;
  const live = g?.gatewayStatus === 'connected';
  const stats = [
    { k: 'Prediction error, first → latest invoice', v: l ? `${l.firstError} → ${l.latestError} days` : '—', sub: l ? `${l.predictions} predictions across ${l.clients} clients` : 'learned from payment memories' },
    { k: 'Memories on Walrus', v: fmt(w?.totalMemories), sub: w ? `${w.namespaceCount} client namespaces · relayer ${w.relayerStatus}` : 'Walrus Memory relayer' },
    { k: 'Latest Sui checkpoint', v: fmt(g?.latestCheckpoint ? Number(g.latestCheckpoint) : null), sub: g ? `${live ? 'via Tatum gRPC' : 'via public fullnode fallback'} · ${g.latencyMs ?? '—'} ms` : 'Tatum Sui gRPC gateway' },
    { k: 'Expected in the next 30 days', v: summary?.expectedInflow30Days != null ? `${fmt(Number(summary.expectedInflow30Days), 2)} USDC` : '—', sub: 'predicted from each client\'s learned delay' },
  ];

  return (
    <div className="min-h-screen bg-primary text-primary font-sans">
      <header className="border-b border-secondary">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-md px-xl py-md lg:px-4xl">
          <div className="flex items-center gap-md">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-solid text-sm font-bold text-primary-on-brand shadow-xs" aria-hidden="true">IC</div>
            <span className="text-sm font-semibold text-primary">Invoice Chaser</span>
          </div>
          <nav aria-label="Main" className="flex items-center gap-lg">
            <a href="/?tab=proof" className="text-sm font-semibold text-secondary hover:text-primary focus-visible:ring-2 focus-visible:ring-focus-ring">Proof</a>
            <a href="/llms.txt" className="hidden text-sm font-semibold text-secondary hover:text-primary focus-visible:ring-2 focus-visible:ring-focus-ring sm:inline">For agents</a>
            <a href="/?app" className="rounded-lg border border-primary bg-primary px-lg py-sm text-sm font-semibold text-secondary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">Dashboard</a>
          </nav>
        </div>
      </header>

      <main>
        <section className="py-6xl lg:py-8xl">
          <div className="mx-auto flex max-w-6xl flex-col gap-4xl px-xl lg:flex-row lg:items-center lg:px-4xl">
            <div className="flex flex-col gap-xl lg:w-1/2">
              <span className="inline-flex w-fit items-center gap-sm rounded-full border border-secondary bg-primary px-md py-xxs text-xs font-medium text-secondary shadow-xs" role="status">
                <span className={`size-2 rounded-full ${live ? 'bg-brand-solid' : 'bg-warning-primary'}`} aria-hidden="true" />
                {g ? `Live on Sui ${g.network} · checkpoint ${fmt(Number(g.latestCheckpoint))}` : failed ? 'Live status unavailable right now' : 'Connecting to Sui mainnet…'}
              </span>
              <h1 className="text-heading-md font-semibold text-primary lg:text-heading-xl">Invoices that learn how each client pays</h1>
              <p className="max-w-lg text-lg text-tertiary">
                For freelancers paid in USDC on Sui. Invoice Chaser remembers every payment in Walrus Memory, verifies it on Sui through Tatum, and times each reminder to the client: when they really pay, which tone works, and the rules they asked for.
              </p>
              <div className="flex flex-col gap-sm sm:flex-row sm:items-center">
                <a href="/?app" className="inline-flex items-center justify-center gap-sm rounded-lg border border-transparent bg-brand-solid px-xl py-md text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring">
                  Open live dashboard <ArrowRight size={16} className="shrink-0" aria-hidden="true" />
                </a>
                <a href="/?pay=inv-101" className="inline-flex items-center justify-center gap-sm px-md py-md text-sm font-semibold text-brand-primary hover:underline focus-visible:ring-2 focus-visible:ring-focus-ring">
                  See a client's pay page
                </a>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-secondary bg-primary shadow-sm lg:w-1/2">
              <div className="flex items-center gap-sm border-b border-secondary px-xl py-md">
                <Activity size={16} className="shrink-0 text-fg-brand-primary" aria-hidden="true" />
                <span className="text-sm font-semibold text-primary">Production, right now</span>
                <span className="ml-auto hidden text-xs text-tertiary sm:inline">read from /proof and /summary</span>
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2">
                {stats.map((s) => (
                  <div key={s.k} className="flex flex-col gap-xxs border-b border-secondary px-xl py-lg sm:odd:border-r">
                    <dt className="text-xs font-medium text-tertiary">{s.k}</dt>
                    <dd className="text-heading-xs font-semibold text-primary">{s.v}</dd>
                    <dd className="text-xs text-tertiary">{s.sub}</dd>
                  </div>
                ))}
              </dl>
              <p className="px-xl py-md text-xs text-tertiary">
                {w?.durability?.daysToEarliestExpiry != null ? `Every memory is stored on Walrus mainnet; the earliest expires in ${w.durability.daysToEarliestExpiry} days.` : 'Memories are stored on Walrus mainnet.'}
              </p>
            </div>
          </div>
        </section>

        <section className="border-t border-secondary bg-secondary py-6xl">
          <div className="mx-auto max-w-6xl px-xl lg:px-4xl">
            <h2 className="text-heading-xs font-semibold text-primary lg:text-heading-sm">How it works</h2>
            <div className="mt-3xl grid grid-cols-1 gap-xl md:grid-cols-3">
              {STEPS.map(({ icon: Icon, title, body }) => (
                <div key={title} className="flex flex-col gap-md rounded-xl border border-secondary bg-primary p-xl shadow-xs">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-secondary bg-primary shadow-xs">
                    <Icon size={20} className="shrink-0 text-fg-brand-primary" aria-hidden="true" />
                  </div>
                  <h3 className="text-md font-semibold text-primary">{title}</h3>
                  <p className="text-sm text-tertiary">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-secondary py-6xl">
          <div className="mx-auto max-w-6xl px-xl lg:px-4xl">
            <h2 className="text-heading-xs font-semibold text-primary lg:text-heading-sm">Paid on mainnet</h2>
            <p className="mt-sm max-w-2xl text-md text-tertiary">Real USDC payments this app settled, open on the explorer.</p>
            <ul className="mt-3xl grid grid-cols-1 gap-xl md:grid-cols-2">
              {PROOFS.map((p) => (
                <li key={p.digest}>
                  <a href={`${EXPLORER}/${p.digest}`} target="_blank" rel="noreferrer" className="flex h-full flex-col gap-xs rounded-xl border border-secondary bg-primary p-xl shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">
                    <span className="flex items-center gap-sm text-md font-semibold text-primary">{p.label} <ExternalLink size={16} className="shrink-0 text-fg-quaternary" aria-hidden="true" /></span>
                    <span className="text-sm text-tertiary">{p.note}</span>
                    <code className="mt-xs break-all text-xs text-secondary">{p.digest}</code>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-t border-secondary bg-secondary py-6xl">
          <div className="mx-auto flex max-w-6xl flex-col gap-xl px-xl lg:flex-row lg:items-center lg:justify-between lg:px-4xl">
            <div className="max-w-2xl">
              <h2 className="text-heading-xs font-semibold text-primary lg:text-heading-sm">Built for agents too</h2>
              <p className="mt-sm text-md text-tertiary">Every invoice is a payable HTTP resource. Agents discover it, pay it, and query what the app learned.</p>
            </div>
            <ul className="flex flex-wrap gap-sm">
              {[['llms.txt', '/llms.txt'], ['OpenAPI', '/openapi.json'], ['MCP server card', '/.well-known/mcp/server-card.json'], ['Agent skill', '/.well-known/agent-skills/index.json'], ['x402 challenge', '/api/chaser/x402/inv-101']].map(([t, h]) => (
                <li key={h}><a href={h} className="inline-flex rounded-lg border border-primary bg-primary px-lg py-sm text-sm font-semibold text-secondary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">{t}</a></li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-secondary">
        <div className="mx-auto flex max-w-6xl flex-col gap-sm px-xl py-xl text-xs text-tertiary sm:flex-row sm:justify-between lg:px-4xl">
          <span>Walrus Memory · Tatum Sui gRPC · Sui mainnet USDC</span>
          <a href="https://github.com/PugarHuda/invoice-chaser" className="font-semibold text-secondary hover:text-primary focus-visible:ring-2 focus-visible:ring-focus-ring">Source on GitHub</a>
        </div>
      </footer>
    </div>
  );
}
