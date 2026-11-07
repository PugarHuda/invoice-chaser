// Landing page at "/". Every number on it is read live from the production API (/proof, /summary);
// nothing here is sample copy. The dashboard lives at /?app, a pay link at /?pay=<id>.
// Look: deep indigo night, a neon city skyline (an original SVG generated below), heavy uppercase type.
import { useEffect, useState } from 'react';
import { ArrowRight, Bot, Database, ExternalLink, ShieldCheck } from 'lucide-react';
import { LogoMark, Wordmark } from './Logo';

type Proof = {
  tatumSuiGrpc: { gatewayStatus: string; latestCheckpoint: string | null; latencyMs: number | null; network: string };
  walrusMemory: { totalMemories: number; namespaceCount: number; relayerStatus: string; durability?: { daysToEarliestExpiry?: number }; chainAudit?: { verified?: number; withTransaction?: number } };
};
type Summary = { learning: { clients: number; firstError: number; latestError: number; predictions: number } | null; expectedInflow30Days?: string };

const EXPLORER = 'https://suiscan.xyz/mainnet/tx';
const PROOFS = [
  { label: 'Gasless USDC payment', note: 'Payer held no SUI and nobody sponsored gas (Address Balances, gas price 0)', digest: '7oaYHYj24aBSLs8QxTHg7zebAiZycCKkCF6vFPSMcLYA' },
  { label: 'Plain transfer, reconciled', note: 'No nonce and nothing reported to the app: matched by Tatum gRPC ListTransactions', digest: 'CzFhbHnEY6ug3dauaPqmp6CsNkuwfTMtJEGPqRArqkqU' },
];
const STEPS = [
  { icon: Database, title: 'Remembers every client', body: 'Each invoice, reminder, payment and rule is a memory in Walrus Memory. The profile (typical delay, the tone that works, rules like "never before the 10th") is rebuilt from those memories, and every plan cites the memories it used.' },
  { icon: ShieldCheck, title: 'Verifies on Sui through Tatum', body: "Payments are checked on Sui mainnet through Tatum's gRPC gateway: exact-amount matching, Payment Kit nonces, and an audit that re-proves every remembered payment against the chain." },
  { icon: Bot, title: 'Gets paid by people and agents', body: 'A wallet, a gasless USDC transfer, or a plain transfer from an exchange. Agents pay over x402 or MPP and read the learned memory through MCP.' },
];
const AGENT_LINKS = [['llms.txt', '/llms.txt'], ['OpenAPI', '/openapi.json'], ['MCP server card', '/.well-known/mcp/server-card.json'], ['Agent skill', '/.well-known/agent-skills/index.json'], ['x402 challenge', '/api/chaser/x402/inv-101']];

const fmt = (n: number | null | undefined, d = 0) => (n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d }));

// ---- the skyline: deterministic (seeded), so server and every visit draw the same city -------------
function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}
type Block = { x: number; w: number; h: number; cap: number };
function layer(seed: number, count: number, minH: number, maxH: number, minW: number, maxW: number): Block[] {
  const r = rng(seed);
  const out: Block[] = [];
  let x = -40;
  for (let i = 0; i < count && x < 1480; i++) {
    const w = minW + r() * (maxW - minW);
    out.push({ x, w, h: minH + r() * (maxH - minH), cap: r() });
    x += w * (0.55 + r() * 0.5);
  }
  return out;
}
const FAR = layer(7, 60, 110, 250, 40, 90);
const MID = layer(23, 40, 90, 200, 60, 130);
const NEAR = layer(91, 16, 70, 150, 120, 210);
const W = (seed: number, n: number) => {
  const r = rng(seed);
  return Array.from({ length: n }, () => ({ x: r() * 1440, y: 330 + r() * 170, w: 6 + r() * 10, warm: r() > 0.86, d: (r() * 6).toFixed(2) }));
};
const WINDOWS = W(5, 70);
const stripes = (x: number, y0: number, w: number, step: number) =>
  Array.from({ length: Math.floor((520 - y0) / step) }, (_, i) => <line key={i} x1={x} x2={x + w} y1={y0 + i * step} y2={y0 + i * step} />);

function Skyline() {
  // ogive towers: tall, curved, striped, one lit pink from inside
  const tower = (x: number, w: number, top: number, fill: string, id: string) => {
    const d = `M${x},520 L${x},${top + 170} C${x},${top + 70} ${x + w * 0.35},${top + 15} ${x + w / 2},${top} C${x + w * 0.65},${top + 15} ${x + w},${top + 70} ${x + w},${top + 170} L${x + w},520 Z`;
    return (
      <g>
        <clipPath id={id}><path d={d} /></clipPath>
        <path d={d} fill={fill} />
        <g clipPath={`url(#${id})`} stroke="#1a0b4f" strokeOpacity="0.55" strokeWidth="2">{stripes(x, top + 20, w, 9)}</g>
        <path d={`M${x + w * 0.28},520 C${x + w * 0.2},${top + 260} ${x + w * 0.7},${top + 140} ${x + w * 0.52},${top + 4}`} stroke="#c58cff" strokeOpacity="0.45" strokeWidth="5" fill="none" clipPath={`url(#${id})`} />
      </g>
    );
  };
  return (
    <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-[50%] w-full lg:h-[54%]" viewBox="0 0 1440 520" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="sk-far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a1a8e" /><stop offset="1" stopColor="#1d0b5c" /></linearGradient>
        <linearGradient id="sk-mid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5023b8" /><stop offset="1" stopColor="#230d6e" /></linearGradient>
        <linearGradient id="sk-near" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7a46e6" /><stop offset="0.55" stopColor="#3b1599" /><stop offset="1" stopColor="#21094f" /></linearGradient>
        <linearGradient id="sk-towerA" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8b5cf0" /><stop offset="0.5" stopColor="#4a1fb0" /><stop offset="1" stopColor="#24096a" /></linearGradient>
        <linearGradient id="sk-towerB" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#6d34d8" /><stop offset="0.55" stopColor="#d46fe0" /><stop offset="1" stopColor="#5a1fa8" /></linearGradient>
        <linearGradient id="sk-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.6" stopColor="#040114" stopOpacity="0" /><stop offset="1" stopColor="#040114" stopOpacity="0.85" /></linearGradient>
        <linearGradient id="sk-side" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e27ee0" /><stop offset="1" stopColor="#4a1a9e" /></linearGradient>
        <radialGradient id="sk-glow" cx="0.5" cy="1" r="0.7"><stop offset="0" stopColor="#ad2b9d" stopOpacity="0.45" /><stop offset="1" stopColor="#ad2b9d" stopOpacity="0" /></radialGradient>
      </defs>
      <rect x="0" y="120" width="1440" height="400" fill="url(#sk-glow)" />
      {/* horizon wings */}
      <path d="M0,215 L380,240 L0,262 Z" fill="#5820ad" opacity="0.75" />
      <path d="M0,232 L300,240 L0,246 Z" fill="#ad2b9d" opacity="0.8" />
      <path d="M1440,205 L1080,236 L1440,258 Z" fill="#5820ad" opacity="0.75" />
      <path d="M1440,226 L1160,236 L1440,242 Z" fill="#ad2b9d" opacity="0.8" />
      <g fill="url(#sk-far)" opacity="0.9">
        {FAR.map((b, i) => <rect key={i} x={b.x} y={520 - b.h - 120} width={b.w} height={b.h + 120} />)}
      </g>
      {tower(640, 84, 150, 'url(#sk-towerA)', 'sk-c')}
      {tower(330, 120, 60, 'url(#sk-towerA)', 'sk-a')}
      {tower(1010, 96, 20, 'url(#sk-towerB)', 'sk-b')}
      <g>
        {MID.map((b, i) => {
          const y = 520 - b.h - 60;
          return (
            <g key={i}>
              {b.cap > 0.6 ? <path d={`M${b.x},${y + 22} L${b.x + b.w * 0.5},${y} L${b.x + b.w},${y + 22} L${b.x + b.w},520 L${b.x},520 Z`} fill="url(#sk-mid)" /> : <rect x={b.x} y={y} width={b.w} height={b.h + 60} fill="url(#sk-mid)" />}
              <rect x={b.x} y={y + (b.cap > 0.6 ? 22 : 0)} width={b.w} height="3" fill="#c07ae8" opacity="0.5" />
            </g>
          );
        })}
      </g>
      <g className="ic-windows">
        {WINDOWS.map((w, i) => <rect key={i} x={w.x} y={w.y} width={w.w} height="3" rx="1" fill={w.warm ? '#ff9a8a' : '#f08ae6'} style={{ animationDelay: `${w.d}s` }} />)}
      </g>
      <g>
        {NEAR.map((b, i) => {
          const y = 520 - b.h;
          const t = 16 + b.cap * 18; // isometric top face depth
          return (
            <g key={i}>
              <path d={`M${b.x},${y} L${b.x + t},${y - t * 0.6} L${b.x + b.w + t},${y - t * 0.6} L${b.x + b.w},${y} Z`} fill={i % 2 ? '#b58af7' : '#9a6cf2'} opacity="0.9" />
              <path d={`M${b.x},${y} L${b.x + b.w},${y}`} stroke="#f3b6ff" strokeOpacity="0.6" strokeWidth="1.5" />
              <path d={`M${b.x + b.w},${y} L${b.x + b.w + t},${y - t * 0.6} L${b.x + b.w + t},520 L${b.x + b.w},520 Z`} fill={i % 3 === 1 ? 'url(#sk-side)' : '#2a0c78'} />
              <rect x={b.x} y={y} width={b.w} height={b.h} fill="url(#sk-near)" />
              <g stroke="#e58ce0" strokeOpacity="0.28" strokeWidth="2">{stripes(b.x + 10, y + 18, b.w - 20, 14).slice(0, 6)}</g>
              {b.cap > 0.5 && <rect x={b.x + b.w * 0.15} y={y + 28} width={b.w * 0.3} height="4" rx="2" fill="#ff8ad8" opacity="0.8" />}
            </g>
          );
        })}
      </g>
      <rect x="0" y="0" width="1440" height="520" fill="url(#sk-fade)" />
    </svg>
  );
}

// What only this app does, each with the number that proves it live (no number until the API answers).
const DIFFERENTIATORS = (l: Summary['learning'] | undefined, a: { verified?: number; withTransaction?: number } | undefined) => [
  { title: 'Learning you can check', proof: l ? `Pay-date error ${l.firstError} → ${l.latestError} days; every reminder plan cites the Walrus memories it used.` : 'Every reminder plan cites the Walrus memories it used.' },
  { title: 'Memory proven by the chain', proof: a?.withTransaction ? `${a.verified}/${a.withTransaction} remembered payments re-proven on Sui through Tatum, live.` : 'Every remembered payment is re-proven on Sui through Tatum.' },
  { title: 'Chases the wallet, not the calendar', proof: "Before a reminder it reads the payer's USDC and recent activity on Sui: chase the one who can pay." },
];
const COMPETITORS = ['Invoice Chaser', 'Chaser', 'Kolleno', 'Request Finance', 'Coinbase Business'];
// yes = documented capability; no = not in the vendor's public docs; free text = a qualified answer
const COMPARISON: string[][] = [
  ['Predicts when each client will pay', 'yes', 'yes (ML predictor)', 'yes (AI forecast)', 'no', 'no'],
  ['Shows the evidence behind each prediction', 'yes (cited memories)', 'no', 'no', 'no', 'no'],
  ['Picks reminder tone per client', 'yes', 'no', 'yes', 'no', 'no'],
  ['Payment verified on a public chain', 'yes (Sui)', 'no (bank / ledger)', 'no (bank / ledger)', 'yes (EVM)', 'yes (Base)'],
  ['Learned data re-checked against the chain', 'yes', 'no', 'no', 'no', 'no'],
  ["Reads the payer's live balance before chasing", 'yes', 'no', 'no', 'no', 'no'],
  ['AI agents can pay the invoice (x402 / MPP)', 'yes', 'no', 'no', 'no', 'no'],
  ['Recurring invoices', 'yes', 'no', 'no', 'yes', 'yes'],
  ['Memory owned by the user (Walrus), not the vendor', 'yes', 'no', 'no', 'no', 'no'],
];

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
  const a = w?.chainAudit;
  const live = g?.gatewayStatus === 'connected';
  const stats = [
    { k: 'Prediction error, first → latest invoice', v: l ? `${l.firstError} → ${l.latestError} days` : '—', sub: l ? `${l.predictions} predictions across ${l.clients} clients` : 'learned from payment memories' },
    { k: 'Memories on Walrus', v: fmt(w?.totalMemories), sub: w ? `${w.namespaceCount} client namespaces · relayer ${w.relayerStatus}` : 'Walrus Memory relayer' },
    { k: 'Payment memories re-proven on Sui', v: a?.withTransaction ? `${a.verified}/${a.withTransaction}` : '—', sub: 'audited through Tatum BatchGetTransactions' },
    { k: 'Latest Sui checkpoint', v: fmt(g?.latestCheckpoint ? Number(g.latestCheckpoint) : null), sub: g ? `${live ? 'via Tatum gRPC' : 'via public fullnode fallback'} · ${g.latencyMs ?? '—'} ms` : 'Tatum Sui gRPC gateway' },
  ];
  const link = 'rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f08ae6] focus-visible:ring-offset-2 focus-visible:ring-offset-[#040114]';

  return (
    <div className="ic-landing min-h-screen bg-[#040114] text-[#fefefe]">
      {/* full-bleed hero: one screen tall, edge to edge */}
        <section className="relative flex min-h-[100svh] w-full flex-col overflow-hidden bg-[linear-gradient(180deg,#0f0b4d_0%,#1c0f6e_45%,#3a1590_100%)] [min-height:max(100svh,720px)]">
          <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between gap-md px-xl py-xl lg:px-6xl">
            <a href="/" className={`flex items-center gap-sm ${link}`}>
              <LogoMark size={30} tile="#5820ad" />
              <Wordmark />
            </a>
            <nav aria-label="Main" className="flex items-center gap-lg lg:gap-4xl">
              <a href="#how" className={`hidden text-xs text-[#c9c6e4] hover:text-white md:inline ${link}`}>How it works</a>
              <a href="/?tab=proof" className={`hidden text-xs text-[#c9c6e4] hover:text-white md:inline ${link}`}>Proof</a>
              <a href="#agents" className={`hidden text-xs text-[#c9c6e4] hover:text-white md:inline ${link}`}>For agents</a>
              <a href="https://github.com/PugarHuda/invoice-chaser" className={`hidden text-xs text-[#c9c6e4] hover:text-white lg:inline ${link}`}>GitHub</a>
              <a href="/?app" className={`border border-[#fefefe]/80 px-xl py-xs text-xs font-medium hover:bg-white/10 ${link}`}>Dashboard</a>
            </nav>
          </header>

          <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center px-xl pt-3xl text-center lg:pt-5xl">
            <span className="mb-xl inline-flex items-center gap-sm rounded-full border border-white/15 bg-white/5 px-md py-xxs text-xs text-[#d8d5ee] backdrop-blur-sm" role="status">
              <span className={`size-2 rounded-full ${live ? 'bg-[#6ee7b7]' : 'bg-[#fbbf24]'}`} aria-hidden="true" />
              {g ? `Live on Sui ${g.network} · checkpoint ${fmt(Number(g.latestCheckpoint))}` : failed ? 'Live status unavailable right now' : 'Connecting to Sui mainnet…'}
            </span>
            <h1 className="ic-display ic-glow text-[2.4rem] font-black uppercase leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
              Invoices that learn <br className="hidden sm:block" />
              how clients pay
            </h1>
            <p className="ic-glow mt-md max-w-2xl text-sm font-light text-[#e4e1f5] sm:text-base">
              Walrus Memory remembers every client · Tatum verifies every payment on Sui · you get paid in USDC
            </p>
            <div className="mt-2xl flex flex-col items-center gap-md sm:flex-row">
              <a href="/?app" className={`group inline-flex items-center gap-md border border-[#fefefe] px-xl py-sm text-sm font-semibold hover:bg-white hover:text-[#200854] ${link}`}>
                Open live dashboard <ArrowRight size={16} className="shrink-0 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </a>
              <a href="/?pay=inv-101" className={`px-md py-sm text-sm text-[#d8d5ee] underline-offset-4 hover:text-white hover:underline ${link}`}>See a client's pay page</a>
            </div>
            <ul aria-label="What makes it different" className="mt-2xl grid w-full max-w-4xl grid-cols-1 gap-sm text-left sm:grid-cols-3">
              {DIFFERENTIATORS(l, a).map((d) => (
                <li key={d.title} className="rounded-xl border border-white/15 bg-[#0a0628]/70 px-lg py-md backdrop-blur">
                  <span className="block text-xs font-semibold text-white">{d.title}</span>
                  <span className="mt-xxs block text-xs text-[#d8d5ee]">{d.proof}</span>
                </li>
              ))}
            </ul>
          </div>

          <Skyline />
        </section>

      <main>
        {/* live numbers */}
        <section aria-labelledby="live-h" className="mx-auto max-w-7xl px-xl py-5xl lg:px-6xl">
          <div className="flex flex-wrap items-baseline justify-between gap-sm">
            <h2 id="live-h" className="ic-display text-xl font-extrabold uppercase tracking-wide">Production, right now</h2>
            <span className="text-xs text-[#9b99b8]">read live from /proof and /summary</span>
          </div>
          <dl className="mt-xl grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.k} className="flex flex-col gap-xxs rounded-2xl border border-[#2b0e94] bg-[linear-gradient(160deg,#120a45,#0a0628)] p-xl">
                <dt className="text-xs text-[#9b99b8]">{s.k}</dt>
                <dd className="ic-display text-2xl font-extrabold text-white">{s.v}</dd>
                <dd className="text-xs text-[#9b99b8]">{s.sub}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-md text-xs text-[#9b99b8]">
            {w?.durability?.daysToEarliestExpiry != null ? `Every memory is stored on Walrus mainnet; the earliest expires in ${w.durability.daysToEarliestExpiry} days.` : 'Memories are stored on Walrus mainnet.'}
          </p>
        </section>

        <section id="different" aria-labelledby="diff-h" className="mx-auto max-w-7xl scroll-mt-xl px-xl pb-5xl lg:px-6xl">
          <h2 id="diff-h" className="ic-display text-xl font-extrabold uppercase tracking-wide">Why it is different</h2>
          <p className="mt-xs max-w-3xl text-sm text-[#d8d5ee]">
            Collections tools predict late payers from your ledger; crypto invoicing tools take payment. None of them shows you why a prediction was made, checks what it learned against the chain, or looks at the payer's wallet before chasing.
          </p>
          <div role="region" aria-label="Comparison table (scrolls sideways on small screens)" tabIndex={0} className="mt-xl overflow-x-auto rounded-2xl border border-[#2b0e94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f08ae6]">
            <table className="w-full min-w-[640px] text-left text-xs">
              <caption className="sr-only">Invoice Chaser compared with collections and crypto invoicing tools</caption>
              <thead className="bg-[#120a45] text-[#d8d5ee]">
                <tr>
                  <th scope="col" className="px-md py-sm font-semibold">Capability</th>
                  {COMPETITORS.map((c) => <th key={c} scope="col" className={`px-md py-sm font-semibold ${c === 'Invoice Chaser' ? 'text-white' : ''}`}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map(([cap, ...cells]) => (
                  <tr key={cap} className="border-t border-[#2b0e94]">
                    <th scope="row" className="px-md py-sm font-medium text-white">{cap}</th>
                    {cells.map((c, i) => <td key={i} className={`px-md py-sm ${c.startsWith('yes') ? 'text-[#7ef0c0]' : 'text-[#9b99b8]'}`}>{c === 'no' ? 'Not in public docs' : c[0].toUpperCase() + c.slice(1)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-sm text-xs text-[#9b99b8]">
            Competitor columns reflect each vendor's public product pages as of November 2026 (Chaser, Kolleno, Request Finance, Coinbase Business); "not in public docs" means we found no claim, not that it is impossible. Sources are listed in the README.
          </p>
        </section>

        <section id="how" aria-labelledby="how-h" className="mx-auto max-w-7xl scroll-mt-xl px-xl pb-5xl lg:px-6xl">
          <h2 id="how-h" className="ic-display text-xl font-extrabold uppercase tracking-wide">How it works</h2>
          <div className="mt-xl grid grid-cols-1 gap-md md:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex flex-col gap-md rounded-2xl border border-[#2b0e94] bg-[#0b0630] p-xl">
                <div className="flex size-10 items-center justify-center rounded-full bg-[linear-gradient(135deg,#5820ad,#ad2b9d)]">
                  <Icon size={18} className="shrink-0 text-white" aria-hidden="true" />
                </div>
                <h3 className="text-md font-semibold">{title}</h3>
                <p className="text-sm text-[#b9b6d6]">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="paid-h" className="mx-auto max-w-7xl px-xl pb-5xl lg:px-6xl">
          <h2 id="paid-h" className="ic-display text-xl font-extrabold uppercase tracking-wide">Paid on mainnet</h2>
          <p className="mt-xs max-w-2xl text-sm text-[#b9b6d6]">Real USDC payments this app settled, open on the explorer.</p>
          <ul className="mt-xl grid grid-cols-1 gap-md md:grid-cols-2">
            {PROOFS.map((p) => (
              <li key={p.digest}>
                <a href={`${EXPLORER}/${p.digest}`} target="_blank" rel="noreferrer" className="flex h-full flex-col gap-xs rounded-2xl border border-[#2b0e94] bg-[#0b0630] p-xl hover:border-[#ad2b9d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f08ae6]">
                  <span className="flex items-center gap-sm text-md font-semibold">{p.label} <ExternalLink size={16} className="shrink-0 text-[#9b99b8]" aria-hidden="true" /></span>
                  <span className="text-sm text-[#b9b6d6]">{p.note}</span>
                  <code className="mt-xs break-all text-xs text-[#d8a6f0]">{p.digest}</code>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section id="agents" aria-labelledby="agents-h" className="mx-auto max-w-7xl scroll-mt-xl px-xl pb-5xl lg:px-6xl">
          <div className="flex flex-col gap-xl rounded-[28px] border border-[#530e5c] bg-[linear-gradient(120deg,#200854,#2b0e94_55%,#530e5c)] p-2xl lg:flex-row lg:items-center lg:justify-between lg:p-4xl">
            <div className="max-w-2xl">
              <h2 id="agents-h" className="ic-display text-xl font-extrabold uppercase tracking-wide">Built for agents too</h2>
              <p className="mt-xs text-sm text-[#e4e1f5]">Every invoice is a payable HTTP resource. Agents discover it, pay it, and query what the app learned through 12 MCP tools.</p>
            </div>
            <ul className="flex flex-wrap gap-sm">
              {AGENT_LINKS.map(([t, h]) => (
                <li key={h}><a href={h} className={`inline-flex border border-white/60 px-lg py-xs text-xs font-medium hover:bg-white hover:text-[#200854] ${link}`}>{t}</a></li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#200854]">
        <div className="mx-auto flex max-w-7xl flex-col gap-sm px-xl py-xl text-xs text-[#9b99b8] sm:flex-row sm:justify-between lg:px-6xl">
          <span>Walrus Memory · Tatum Sui gRPC · Sui mainnet USDC</span>
          <a href="https://github.com/PugarHuda/invoice-chaser" className={`font-semibold text-[#d8d5ee] hover:text-white ${link}`}>Source on GitHub</a>
        </div>
      </footer>
    </div>
  );
}
