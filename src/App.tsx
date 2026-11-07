import React, { useState, useEffect, useRef } from 'react';
import { LogoMark } from './Logo';
import { getWallets, type StandardConnectFeature, type SuiSignTransactionFeature, type SuiSignAndExecuteTransactionFeature, type SuiSignPersonalMessageFeature } from '@mysten/wallet-standard';
import { Transaction } from '@mysten/sui/transactions';
import QRCode from 'qrcode';

// ?pay=<invoice> is the public, client-facing pay page (no owner tabs).
// '?pay=' with no id is still the pay page (it then shows "invoice not found"), never the owner dashboard
const PAY_ONLY = new URLSearchParams(window.location.search).has('pay') ? new URLSearchParams(window.location.search).get('pay') || '-' : null;
// owner downloads (CSV, calendar) through fetch, so a stored passcode goes along (PRIVATE_READS)
const ownerDownload = async (e: { preventDefault: () => void }, path: string, name: string) => {
  e.preventDefault();
  const r = await fetch(path);
  if (!r.ok) return;
  const url = URL.createObjectURL(await r.blob());
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};
const usd = (v: string | number | undefined | null) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
// the plan predicts with the recent-weighted (EWMA) delay, so the profile shows that one too
const delayLabel = (p: { ewmaDelayDays?: number; medianDelayDays: number }) => { const d = Math.round(p.ewmaDelayDays ?? p.medianDelayDays); return d > 0 ? `+${d} days` : d < 0 ? `${-d} days early` : 'on time'; };
// ?inv=<id> deep-links an invoice on the owner tabs
const START_INV = new URLSearchParams(window.location.search).get('inv');
// Default selection: the largest invoice still fully open, then any unpaid one, then the first.
type InvoiceListItem = { id: string; clientId: string; clientName: string; baseAmount: number; payAmount: string; status: string; dueDate: string };
type ClientListItem = { id: string; name: string; contact?: string; email?: string; profile: ClientProfile };
// error bodies from the API: { error } plus whatever the route adds
type ApiBody = { error?: string } & Record<string, unknown>;
const pickDefaultInvoice = (list: InvoiceListItem[]) =>
  [...list].filter((i) => i.status === 'sent' || i.status === 'overdue').sort((a, b) => Number(b.baseAmount) - Number(a.baseAmount))[0] || list.find((i) => i.status !== 'paid') || list[0];
import {
  Clock,
  AlertCircle,
  TrendingUp,
  Brain,
  ExternalLink,
  QrCode,
  Copy,
  DollarSign,
  RefreshCw,
  MessageSquare,
  HelpCircle,
  CreditCard,
  Check,
  ShieldCheck,
  ChevronDown
} from 'lucide-react';

type TabKey = 'today' | 'clients' | 'invoices' | 'pay' | 'proof';

interface SummaryData {
  network?: string;
  learning?: { firstError: number; latestError: number; clients: number; predictions: number } | null;
  expectedInflow7Days: string;
  expectedInflow30Days?: string;
  expectedInflow7DaysRange?: { low: string; high: string };
  overdueAmount: string;
  activeClientNamespaces: number;
  upcomingInflows: Array<{
    invoiceId: string;
    clientName: string;
    earliest?: string;
    latest?: string;
    payAmount: string;
    dueDate: string;
    predictedPayDate: string;
    delayDays: number;
    status: string;
  }>;
  hiddenSmall?: number;
  nextActions: Array<{
    invoiceId: string;
    clientId: string;
    clientName: string;
    amount: string;
    actionDate: string;
    recommendedTone: string;
    reason: string;
    underpayRisk: number | null;
  }>;
}

interface ClientProfile {
  clientId: string;
  medianDelayDays: number;
  ewmaDelayDays: number;
  remindersNeeded: number;
  bestTone: string;
  toneStats: Record<string, { hits: number; total: number; rate: number }>;
  underpayRate: number;
  totalPaidInvoices: number;
  reliabilityBadge: string;
  preferences: string[];
  revokedRules?: string[];
  creditUsdc?: string;
  memoryCount: number;
  history?: Array<{ invoice: string; n: number; predicted: number; actual: number; error: number }>;
  promiseStats?: { kept: number; broken: number };
}

interface ClientDetail {
  client: {
    id: string;
    name: string;
    email: string;
    address: string;
    expectedPayer?: { address: string; name?: string | null } | null;
    provenPayers?: Array<{ address: string; at: string; invoice: string; scheme: string | null }>;
  };
  profile: ClientProfile;
  memories: Array<{
    id: string;
    sentence: string;
    tag: { type?: string; seed?: boolean } & Record<string, unknown>;
    blobId?: string;
    timestamp: string;
    status: string;
  }>;
  namespace: string;
}

interface InvoiceDetail {
  invoice: {
    id: string;
    clientId: string;
    clientName: string;
    baseAmount: number;
    payAmount: string;
    status: string;
    dueDate: string;
    issuedDate: string;
    description: string;
    digest: string | null;
    payeeAddress: string;
    coinType: string;
    network?: string;
    paymentUri?: string;
    slushPayUrl?: string;
    eInvoice?: boolean;
    payee?: { name: string | null; recordedPayments: number; since: string | null };
    registry?: string;
    explorerTx?: string | null;
    receipt?: { blobId: string; url: string; at: string } | null;
    receiptsEnabled?: boolean;
    promise?: { date: string; at: string; source: string } | null;
    terms?: { kind: 'early_discount' | 'late_fee'; pct: number; until: string | null; original: string; expired?: boolean } | null;
    paidOn?: string | null;
    originalAmount?: string;
    repeat?: 'monthly' | 'weekly' | null;
    series?: string | null;
    prev?: string | null;
    repeatStopped?: boolean;
    nextDue?: string | null;
  };
  profile?: { promiseStats?: { kept: number; broken: number } };
  payerLiquidity?: { owner: string; usdc: string; sui: number; covers: boolean; source: string; name: string | null; at: string } | null;
  incentive?: { kind: 'early_discount' | 'late_fee' | null; pct?: number; until?: string; newBase?: number; reason: string };
  adaptivePlan: {
    cites?: Array<{ sentence: string; blobId: string | null; status: string; at: string }>;
    type: string;
    predictedPayDate: string;
    predictedDelayDays: number;
    steps: Array<{ dayOffset: number; date: string; tone: string; reason: string }>;
    memoriesUsed: string[];
  };
  defaultPlan: {
    type: string;
    predictedPayDate: string;
    steps: Array<{ dayOffset: number; date: string; tone: string; reason: string }>;
    memoriesUsed: string[];
  };
}

interface ProofData {
  tatumSuiGrpc: {
    endpoint: string;
    protocol: string;
    apiKeyConfigured: boolean;
    gatewayStatus: string;
    provider?: { provider: string; tatumQuotaExceededAt: string | null; retryTatumAt: string | null; fallback: string };
    latestCheckpoint: string;
    payeeAddress: string;
    payeeBalance: string;
    usdcCoinType: string;
    errorDetail: string | null;
    rates?: { SUI?: { usd: number }; USDC?: { usd: number } };
  };
  walrusMemory: {
    relayerUrl: string;
    sdk: string;
    relayerStatus: string;
    totalMemories: number;
    namespaceCount: number;
    namespaces: Record<string, number>;
    pendingMemoriesCount: number;
    durability?: {
      ok: boolean;
      error?: string;
      inventory?: number;
      active?: number;
      loadedLocally?: number;
      missingFromInventory?: Array<{ blobId: string; sentence: string }>;
      earliestExpiry?: string | null;
      daysToEarliestExpiry?: number | null;
      endEpochRange?: [number, number] | null;
      spotCheck?: Array<{ blobId: string; onWalrus: boolean; bytes: number | null; ms: number }>;
    };
    chainAudit?: {
      error?: string;
      verified: number;
      withTransaction: number;
      mismatched: number;
      gatewayCalls: number;
      service?: string;
      demoHistoryWithoutTransaction?: number;
      stale?: { since: string; reason: string };
      chainToMemory?: { error?: string; windowDays: number; incomingTransfers: number; recordedInMemory: number; unrecorded: number; scannedTransactions: number };
    };
    sampleMemories: Array<{
      namespace: string;
      count: number;
      latest: string;
    }>;
  };
}

export default function App() {
  const START_TAB = new URLSearchParams(window.location.search).get('tab') as TabKey | null;
  const [activeTab, setActiveTab] = useState<TabKey>(PAY_ONLY ? 'pay' : START_TAB && ['today', 'clients', 'invoices', 'pay', 'proof'].includes(START_TAB) ? START_TAB : 'today');
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>(PAY_ONLY || START_INV || '');
  const [ignoreMemory, setIgnoreMemory] = useState<boolean>(false);
  // every tab change is a URL (Back/Forward/reload work); the same tab twice adds no history entry
  const goTab = (tab: TabKey, inv?: string) => {
    setActiveTab(tab);
    const url = `?tab=${tab}${inv ? `&inv=${encodeURIComponent(inv)}` : ''}`;
    if (url !== window.location.search) history.pushState(null, '', url);
    // keyboard and screen-reader users land on the new view's heading, not back at the top of the page
    setTimeout(() => { const h = document.querySelector('main h1') as HTMLElement | null; if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }, 60);
  };
  // on a narrow screen the active tab may sit past the nav's edge: bring it into view when the tab changes
  useEffect(() => { document.querySelector('nav[aria-label="Main"] [aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [activeTab]);
  const [clientNote, setClientNote] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'ok' | 'error'>('ok');

  // Live Data States
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [queue, setQueue] = useState<{ counts: Record<string, number>; items: Array<{ invoiceId: string; clientName: string; owedUsdc: string; action: 'chase_now' | 'nudge' | 'wait' | 'scheduled'; tone: string | null; why: string[]; chain: { usdc: string; covers: boolean } | null }> } | null>(null);
  // an API that failed is said so; the screen never shows zeros it did not get from the server
  const [apiError, setApiError] = useState<string | null>(null);
  const [proofError, setProofError] = useState(false);
  const failed = async (res: Response | null, what: string) => {
    const d = res ? await res.json().catch(() => ({})) : {};
    setApiError(`Could not load ${what}${res ? ` (HTTP ${res.status})` : ' (network error)'}${(d as ApiBody).error ? `: ${(d as ApiBody).error}` : ''}`);
  };
  const [clientsList, setClientsList] = useState<ClientListItem[]>([]);
  const [clientDetail, setClientDetail] = useState<ClientDetail | null>(null);
  const [invoiceDetail, setInvoiceDetail] = useState<InvoiceDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [proofData, setProofData] = useState<ProofData | null>(null);
  const [allInvoices, setAllInvoices] = useState<InvoiceListItem[]>([]);

  // Payment Form States
  const [digestInput, setDigestInput] = useState<string>('');
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  // state updates are async: a second click in the same tick would send the digest twice
  const verifyingRef = useRef(false);
  // no preset client or amount: the client defaults to the first real one once the list loads
  const [newInvoice, setNewInvoice] = useState({ clientId: '', amount: '', dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), description: '', repeat: '' as '' | 'monthly' | 'weekly' });
  useEffect(() => { if (!newInvoice.clientId && clientsList[0]) setNewInvoice((n) => ({ ...n, clientId: clientsList[0].id })); }, [clientsList, newInvoice.clientId]);
  const [reminderText, setReminderText] = useState<string>('');
  const [reminderSource, setReminderSource] = useState<string>('');
  const [newClientName, setNewClientName] = useState<string>('');
  const [walletBusy, setWalletBusy] = useState<string | null>(null);
  const [payerProof, setPayerProof] = useState<{ address: string; verifiedBy: string; wallet: { usdc: string; covers: boolean; owed: string } | null } | null>(null);
  // the client proves which wallet it pays from by signing one message (no transaction, no fee)
  const handleProvePayer = async () => {
    const wallets = getWallets().get().filter((w) => 'sui:signPersonalMessage' in w.features && 'standard:connect' in w.features);
    if (!wallets.length) return showToast('No Sui wallet found in this browser. Install Slush to prove the wallet you pay from.', 'error');
    const wallet = wallets.find((w) => /slush|sui/i.test(w.name)) || wallets[0];
    try {
      setWalletBusy(`Connecting ${wallet.name}…`);
      const { accounts } = await (wallet.features['standard:connect'] as StandardConnectFeature['standard:connect']).connect();
      const account = accounts[0];
      if (!account) throw new Error('No account approved');
      const r = await fetch(`/api/chaser/pay/${encodeURIComponent(selectedInvoiceId)}/payer-message`);
      const challenge = (await r.json()) as ApiBody & { message: string };
      if (!r.ok) throw new Error(challenge.error || 'Could not prepare the message');
      setWalletBusy('Sign the message in your wallet · no transaction, no fee');
      const signed = await (wallet.features['sui:signPersonalMessage'] as SuiSignPersonalMessageFeature['sui:signPersonalMessage']).signPersonalMessage({ message: new TextEncoder().encode(challenge.message), account });
      setWalletBusy('Checking the signature and the wallet on Sui through Tatum…');
      const v = await fetch(`/api/chaser/pay/${encodeURIComponent(selectedInvoiceId)}/prove-payer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: challenge.message, signature: signed.signature, address: account.address }) });
      const data = (await v.json()) as ApiBody & { address: string; verifiedBy: string; wallet: { usdc: string; covers: boolean; owed: string } | null };
      if (!v.ok) throw new Error(data.error || 'Proof refused');
      setPayerProof({ address: data.address, verifiedBy: data.verifiedBy, wallet: data.wallet });
      showToast('Wallet verified: the invoice owner can see which wallet you plan to pay from');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not prove the wallet', 'error');
    } finally {
      setWalletBusy(null);
    }
  };
  const [qr, setQr] = useState<string>('');
  const [noteText, setNoteText] = useState<string>('');
  // when the email/call happened: Walrus analyze() resolves "next Friday" against it
  const [noteDate, setNoteDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [promiseInput, setPromiseInput] = useState<string>('');
  const [noteBusy, setNoteBusy] = useState<boolean>(false);
  const [payerInput, setPayerInput] = useState<string>('');
  const handleSetPayer = async () => {
    const v = payerInput.trim().toLowerCase();
    // same shapes the server accepts: a full Sui address, a name.sui, or an @name
    if (!/^0x[0-9a-f]{64}$/.test(v) && !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.sui$/.test(v) && !/^@[a-z0-9-]+$/.test(v)) return showToast('Enter a full Sui address (0x + 64 hex characters) or a SuiNS name like alice.sui', 'error');
    let r: Response, d: ApiBody & { address: string; name?: string | null; screen?: { verdict?: string } };
    try {
      r = await fetch(`/api/chaser/clients/${selectedClientId}/payer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payer: v }) });
      d = await r.json();
    } catch { return showToast('Network error: payer not saved', 'error'); }
    if (!r.ok) return showToast(d.error || 'Could not set payer', 'error');
    showToast(`Payer set: ${d.name ? `${d.name} → ` : ''}${d.address.slice(0, 10)}… · Tatum screening: ${d.screen?.verdict ?? 'unavailable'}`);
    setPayerInput('');
    fetchClientDetail(selectedClientId);
    fetchClients();
  };
  const [memQuery, setMemQuery] = useState<string>('');
  const [memHits, setMemHits] = useState<Array<{ sentence: string; blobId?: string | null; distance: number }> | null>(null);
  const [memBusy, setMemBusy] = useState<boolean>(false);
  // Walrus recall ranking: closest by meaning, newest among matches, or meaning blended with recency
  const [memMode, setMemMode] = useState<'relevance' | 'recent' | 'weighted'>('relevance');
  const handleMemorySearch = async (mode = memMode) => {
    if (memQuery.trim().length < 2) return;
    setMemMode(mode);
    setMemBusy(true);
    try {
      const r = await fetch(`/api/chaser/clients/${selectedClientId}/search?q=${encodeURIComponent(memQuery.trim())}&mode=${mode}`);
      const d = await r.json();
      if (!r.ok) { setMemHits(null); return showToast(d.error || 'Search failed', 'error'); }
      setMemHits(d.results);
    } finally {
      setMemBusy(false);
    }
  };
  // Tour targets: the largest fully open invoice (a real-sized one, not a 0.01 USDC mainnet proof) and its client.
  const tourInvoice = pickDefaultInvoice(allInvoices);
  const tourClient = clientsList.find((c) => c.id === tourInvoice?.clientId) || clientsList[0];
  const netLabel = (invoiceDetail?.invoice.network || summary?.network) === 'testnet' ? 'Sui Testnet' : 'Sui Mainnet';

  // Real QR: the Sui Payment Kit URI (sui:pay?...) for this invoice, scannable by Sui wallets.
  useEffect(() => {
    const uri = invoiceDetail?.invoice.paymentUri;
    if (!uri) return setQr('');
    QRCode.toDataURL(uri, { margin: 1, width: 240 }).then(setQr).catch(() => setQr(''));
  }, [invoiceDetail?.invoice.paymentUri]);

  // Live: Tatum gRPC checkpoint stream (server-side) pushes "paid" the moment the payment lands.
  // EventSource reconnects by itself when the server ends a stream window.
  // Every open stream costs gateway credits per checkpoint (~3.6/s), so it stops while the tab is hidden
  // and after LIVE_PAGE_MS; the payer can resume it, and the 60 s sync still catches a payment.
  const LIVE_PAGE_MS = 15 * 60_000;
  const [live, setLive] = useState<{ state: string; checkpoint?: string; via?: string }>({ state: 'off' });
  const [liveEpoch, setLiveEpoch] = useState(0); // bump to resume
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== 'hidden');
  // Back/Forward between ?tab= URLs switches the tab
  useEffect(() => {
    const on = () => { const q = new URLSearchParams(window.location.search); const t = q.get('tab') as TabKey | null; setActiveTab(t && ['today', 'clients', 'invoices', 'pay', 'proof'].includes(t) ? t : 'today'); const inv = q.get('inv'); if (inv) setSelectedInvoiceId(inv); };
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  // a title per page: tabs in history and bookmarks are distinguishable, a pay page names its invoice
  useEffect(() => {
    document.title = PAY_ONLY ? (PAY_ONLY === '-' ? 'Pay an invoice · Invoice Chaser' : `Pay invoice ${PAY_ONLY} · Invoice Chaser`) : `${activeTab === 'proof' ? '/proof' : activeTab[0].toUpperCase() + activeTab.slice(1)} · Invoice Chaser`;
  }, [activeTab]);
  useEffect(() => {
    const on = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  useEffect(() => {
    const id = selectedInvoiceId;
    if (activeTab !== 'pay' || !id || !invoiceDetail || invoiceDetail.invoice.status === 'paid') return setLive({ state: 'off' });
    if (!pageVisible) return setLive((l) => ({ ...l, state: 'paused-hidden' }));
    const stop = setTimeout(() => { es.close(); setLive((l) => ({ ...l, state: 'paused' })); }, LIVE_PAGE_MS);
    const es = new EventSource(`${import.meta.env.VITE_API_BASE || ''}/api/chaser/pay/${encodeURIComponent(id)}/live`);
    es.addEventListener('watching', (e) => { const d = JSON.parse((e as MessageEvent).data); setLive((l) => ({ ...l, state: 'watching', via: d.provider === 'tatum' ? 'Tatum gRPC' : 'the public Sui fullnode (Tatum credits exhausted)' })); });
    es.addEventListener('checkpoint', (e) => { const d = JSON.parse((e as MessageEvent).data); setLive((l) => ({ ...l, state: 'watching', checkpoint: d.checkpoint, via: d.provider ? (d.provider === 'tatum' ? 'Tatum gRPC' : 'the public Sui fullnode (Tatum credits exhausted)') : l.via })); });
    es.addEventListener('seen', () => setLive((l) => ({ ...l, state: 'verifying' })));
    // the server already retried transient misses; one registry/reconcile sync still catches a payment it gave up on
    es.addEventListener('rejected', (e) => { setLive((l) => ({ ...l, state: 'watching' })); showToast(JSON.parse((e as MessageEvent).data).error, 'error'); setTimeout(syncPayments, 5000); });
    es.addEventListener('paid', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      es.close();
      setLive({ state: 'paid', checkpoint: d.checkpoint });
      if (!d.already) showToast(d.message || 'Payment detected live and verified on-chain');
      fetchInvoiceDetail(id);
    });
    // this invoice was opened live in another tab: stop here instead of reconnecting and kicking that one
    es.addEventListener('replaced', () => { es.close(); setLive((l) => ({ ...l, state: 'paused-replaced' })); });
    // a refused stream (e.g. 429) closes for good: say so and offer Resume instead of "reconnecting" forever
    es.onerror = () => setLive((l) => (l.state === 'paused-replaced' ? l : { ...l, state: es.readyState === EventSource.CLOSED ? 'paused-refused' : 'reconnecting' }));
    return () => { clearTimeout(stop); es.close(); };
  }, [activeTab, selectedInvoiceId, invoiceDetail?.invoice.status, !!invoiceDetail, pageVisible, liveEpoch]);

  // Payment Kit auto-sync: payments made through the on-chain registry settle without a pasted digest.
  const syncPayments = async () => {
    try {
      const r = await fetch('/api/chaser/sync-payments', { method: 'POST' });
      const d = await r.json();
      if (d.settled?.length) {
        showToast(d.settled.map((x: { invoice: string; message: string }) => `${x.invoice}: ${x.message}`).join(' · '));
        fetchSummary();
        fetchAllInvoices();
        if (selectedInvoiceId) fetchInvoiceDetail(selectedInvoiceId);
      }
    } catch { /* background poll: the next tick retries */ }
  };
  useEffect(() => {
    // the live stream already settles payments the moment they land; poll only as a fallback
    if (activeTab !== 'pay' || invoiceDetail?.invoice.status === 'paid' || !pageVisible || live.state === 'watching') return;
    const t = setInterval(syncPayments, 60000);
    return () => clearInterval(t);
  }, [activeTab, selectedInvoiceId, invoiceDetail?.invoice.status, pageVisible, live.state === 'watching']);

  const handleIngestNotes = async () => {
    if (noteText.trim().length < 10) return showToast('Paste at least a sentence', 'error');
    setNoteBusy(true);
    try {
      const res = await fetch(`/api/chaser/clients/${selectedClientId}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: noteText, receivedAt: noteDate }) });
      const data = await res.json();
      if (!res.ok) return showToast(data.error || 'Could not analyze notes', 'error');
      showToast(`Walrus extracted ${data.facts.length} fact(s) from your notes${data.promise ? ` · promise to pay ${data.promise.invoice} by ${data.promise.date} recorded` : ''}`);
      setNoteText('');
      fetchClientDetail(selectedClientId);
      if (selectedInvoiceId) fetchInvoiceDetail(selectedInvoiceId);
    } catch {
      showToast('Network error: notes not analyzed', 'error');
    } finally {
      setNoteBusy(false);
    }
  };

  const showToast = (msg: string, tone: 'ok' | 'error' = 'ok') => {
    setToastTone(tone);
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  useEffect(() => {
    syncPayments();
    if (PAY_ONLY) return; // the public pay page loads nothing but its own invoice
    fetchSummary();
    fetchClients();
    fetchAllInvoices();
  }, []);

  // recall hits belong to one client: clear them when the selection changes
  useEffect(() => { setMemHits(null); setMemQuery(''); }, [selectedClientId]);

  useEffect(() => {
    if (selectedClientId && !PAY_ONLY && (!clientsList.length || clientsList.some((c) => c.id === selectedClientId))) {
      fetchClientDetail(selectedClientId);
    }
  }, [selectedClientId]);

  useEffect(() => {
    if (selectedInvoiceId && (PAY_ONLY || !allInvoices.length || allInvoices.some((i) => i.id === selectedInvoiceId))) {
      fetchInvoiceDetail(selectedInvoiceId);
    }
  }, [selectedInvoiceId]);

  // on first render the [selectedInvoiceId] effect already loads the invoice: don't fetch it twice
  const tabMounted = useRef(false);
  useEffect(() => {
    if (activeTab === 'proof') fetchProof();
    // plans depend on memories that may have changed on another tab
    if (tabMounted.current && (activeTab === 'invoices' || activeTab === 'pay')) selectedInvoiceId && fetchInvoiceDetail(selectedInvoiceId);
    if (tabMounted.current && activeTab === 'today') fetchSummary(); // the mount effect already loaded it
    tabMounted.current = true;
  }, [activeTab]);

  const fetchSummary = async () => {
    // chase queue: memory x live payer wallet (Tatum); optional, so a failure only hides the card
    fetch('/api/chaser/chase-queue').then((r) => (r.ok ? r.json() : null)).then((q) => q && setQueue(q)).catch(() => {});
    try {
      const res = await fetch('/api/chaser/summary');
      if (res.ok) {
        const data = await res.json();
        setSummary(data);
        setApiError(null);
      } else await failed(res, 'the cash-flow summary');
    } catch { await failed(null, 'the cash-flow summary'); }
  };

  const fetchClients = async () => {
    try {
      const res = await fetch('/api/chaser/clients');
      if (res.ok) {
        const data = await res.json();
        setClientsList(data);
        if (data.length && !data.some((c: ClientListItem) => c.id === selectedClientId)) setSelectedClientId(data[0].id);
      } else await failed(res, 'clients');
    } catch { await failed(null, 'clients'); }
  };

  const fetchAllInvoices = async () => {
    try {
      const res = await fetch('/api/chaser/invoices');
      if (res.ok) {
        const data = await res.json();
        setAllInvoices(data);
        if (!PAY_ONLY && data.length && !data.some((i: InvoiceListItem) => i.id === selectedInvoiceId)) setSelectedInvoiceId(pickDefaultInvoice(data).id);
      } else await failed(res, 'invoices');
    } catch { await failed(null, 'invoices'); }
  };

  // latest id asked for: a slower response for a previously selected client/invoice must not overwrite it
  const clientReq = useRef('');
  const invoiceReq = useRef('');
  const fetchClientDetail = async (id: string) => {
    clientReq.current = id;
    // never show (and post actions against) the previous client's rules under the new selection
    setClientDetail((d) => (d?.client.id === id ? d : null));
    try {
      const res = await fetch(`/api/chaser/clients/${encodeURIComponent(id)}`);
      if (clientReq.current !== id) return;
      if (!res.ok) return showToast(`Could not load this client (HTTP ${res.status}). Please retry.`, 'error');
      const data = await res.json();
      if (clientReq.current === id) setClientDetail(data);
    } catch {
      if (clientReq.current === id) showToast('Network error while loading the client. Check your connection and retry.', 'error');
    }
  };

  const [storingReceipt, setStoringReceipt] = useState(false);
  const storeReceipt = async (id: string) => {
    setStoringReceipt(true);
    try {
      const res = await fetch(`/api/chaser/invoices/${id}/receipt`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Receipt failed');
      showToast(`Receipt stored on Walrus: ${data.blobId.slice(0, 10)}…`);
      await fetchInvoiceDetail(id);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Receipt failed', 'error');
    } finally {
      setStoringReceipt(false);
    }
  };
  const fetchInvoiceDetail = async (id: string) => {
    invoiceReq.current = id;
    try {
      const res = await fetch(PAY_ONLY ? `/api/chaser/pay/${encodeURIComponent(id)}` : `/api/chaser/invoices/${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      if (invoiceReq.current !== id) return;
      // never leave the previous invoice's amount on screen under a different invoice id
      if (!res.ok) {
        if (res.status === 404) setInvoiceDetail(null);
        return setDetailError(res.status === 404 ? 'This invoice does not exist. Check the link you were sent.' : `Could not load the invoice right now (HTTP ${res.status}). Please try again.`);
      }
      setDetailError('');
      setInvoiceDetail(data);
    } catch {
      if (invoiceReq.current === id) setDetailError('Network error while loading the invoice. Check your connection and retry.');
    }
  };

  const fetchProof = async () => {
    try {
      const res = await fetch('/api/chaser/proof');
      if (res.ok) {
        const data = await res.json();
        setProofData(data);
        setProofError(false);
      } else { setProofError(true); await failed(res, 'the live proof'); }
    } catch { setProofError(true); await failed(null, 'the live proof'); }
  };

  const handleSavePreference = async () => {
    if (!clientNote.trim()) return;
    try {
      const res = await fetch(`/api/chaser/clients/${selectedClientId}/preference`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preference: clientNote }),
      });
      if (res.ok) {
        showToast('Client preference recorded in Walrus Memory');
        setClientNote('');
        fetchClientDetail(selectedClientId);
        fetchSummary();
        if (selectedInvoiceId) fetchInvoiceDetail(selectedInvoiceId);
      } else showToast((await res.json().catch(() => ({}))).error || 'Could not save the preference', 'error');
    } catch {
      showToast('Failed to record memory', 'error');
    }
  };

  const handleRevokeRule = async (rule: string) => {
    try {
      const res = await fetch(`/api/chaser/clients/${selectedClientId}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      showToast('Rule revoked: a revocation memory was written to Walrus');
      fetchClientDetail(selectedClientId);
      fetchSummary();
      if (selectedInvoiceId) fetchInvoiceDetail(selectedInvoiceId);
    } catch (err) {
      showToast(`Failed to revoke: ${err instanceof Error ? err.message : err}`, 'error');
    }
  };

  const handleRebuildFromMemory = async () => {
    try {
      showToast('Total Recall: restoring and recalling every namespace from Walrus…');
      const res = await fetch(`/api/chaser/clients/${selectedClientId}/rebuild?deep=1`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        showToast(data.message || 'Profile rebuilt from Walrus memories');
        fetchClientDetail(selectedClientId);
        fetchClients();
        fetchAllInvoices();
        fetchSummary();
      } else showToast((await res.json().catch(() => ({}))).error || 'Rebuild failed', 'error');
    } catch {
      showToast('Rebuild failed', 'error');
    }
  };

  const handleVerifyDigest = async () => {
    if (!digestInput.trim()) {
      showToast('Please enter a transaction digest', 'error');
      return;
    }
    // a pasted explorer link (suiscan, suivision, …/tx/<digest>) works too: take the digest out of it
    const raw = digestInput.trim();
    const digest = (raw.match(/(?:^|\/tx(?:block)?\/)([1-9A-HJ-NP-Za-km-z]{43,44})(?:$|[/?#])/) || [])[1];
    if (!digest) {
      showToast("That isn't a Sui transaction digest: paste the 43-44 character digest or the explorer link of the transfer", 'error');
      return;
    }
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setIsVerifying(true);
    try {
      const res = await fetch('/api/chaser/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: selectedInvoiceId,
          digest,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || `Settled on ${netLabel}. Walrus memory updated.`);
        setDigestInput('');
        fetchInvoiceDetail(selectedInvoiceId);
        fetchSummary();
        fetchAllInvoices();
      } else {
        showToast(data.error || 'Verification failed', 'error');
      }
    } catch {
      showToast('Network error during verification', 'error');
    } finally {
      verifyingRef.current = false;
      setIsVerifying(false);
    }
  };

  const handleAddClient = async () => {
    if (!newClientName.trim()) return;
    let res: Response, data: ApiBody & { client: { id: string; name: string } };
    try {
      res = await fetch('/api/chaser/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newClientName.trim() }) });
      data = await res.json();
    } catch { return showToast('Network error: client not added', 'error'); }
    if (!res.ok) return showToast(data.error || 'Could not add client', 'error');
    showToast(`${data.client.name} added (writing to Walrus Memory)`);
    setNewClientName('');
    await fetchClients();
    setSelectedClientId(data.client.id);
  };

  // Pay with any Sui wallet (Wallet Standard). The server builds the exact USDC transfer through Tatum;
  // the wallet signs and executes it; then the digest is verified on Mainnet like any other payment.
  const handleWalletPay = async (withSui = false) => {
    const wallets = getWallets().get().filter((w) => 'sui:signAndExecuteTransaction' in w.features && 'standard:connect' in w.features);
    if (!wallets.length) return showToast('No Sui wallet found in this browser. Install Slush, or pay manually below.', 'error');
    const wallet = wallets.find((w) => /slush|sui/i.test(w.name)) || wallets[0];
    try {
      setWalletBusy(`Connecting ${wallet.name}…`);
      const { accounts } = await (wallet.features['standard:connect'] as StandardConnectFeature['standard:connect']).connect();
      const chain: `${string}:${string}` = `sui:${invoiceDetail?.invoice.network || 'mainnet'}`;
      const account = accounts.find((a) => a.chains.includes(chain)) || accounts[0];
      if (!account) throw new Error('No account approved');
      setWalletBusy(withSui ? 'Finding the best SUI → USDC route (Cetus aggregator)…' : 'Building transfer via Tatum…');
      const canSignOnly = 'sui:signTransaction' in wallet.features;
      const r = await fetch('/api/chaser/pay-tx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId: selectedInvoiceId, sender: account.address, sponsored: canSignOnly && !withSui, gasless: canSignOnly && !withSui, withSui }) });
      const built = await r.json();
      if (!r.ok) throw new Error(built.error);
      // Native gasless (Sui Address Balances): the protocol charges no gas at all for this USDC transfer.
      if (built.gasless) {
        setWalletBusy('Approve in your wallet · gasless USDC transfer, no network fee at all');
        const signed = await (wallet.features['sui:signTransaction'] as SuiSignTransactionFeature['sui:signTransaction']).signTransaction({
          transaction: { toJSON: async () => Transaction.from(built.bytes).toJSON() },
          account,
          chain,
        });
        setWalletBusy(`Submitting through Tatum and verifying on ${netLabel}…`);
        const v = await fetch('/api/chaser/pay-gasless', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId: selectedInvoiceId, bytes: built.bytes, signature: signed.signature, mac: built.gasless.mac }) });
        const data = await v.json();
        showToast(data?.message || data?.error || 'Payment sent', v.ok ? 'ok' : 'error');
        fetchInvoiceDetail(selectedInvoiceId);
        fetchSummary();
        fetchAllInvoices();
        return;
      }
      // Sponsored: the server's gas wallet pays the network fee; the payer only signs the USDC payment.
      if (built.sponsored) {
        setWalletBusy('Approve in your wallet · network fee sponsored, you pay only USDC');
        const signed = await (wallet.features['sui:signTransaction'] as SuiSignTransactionFeature['sui:signTransaction']).signTransaction({
          transaction: { toJSON: async () => Transaction.from(built.bytes).toJSON() },
          account,
          chain,
        });
        setWalletBusy(`Submitting through Tatum and verifying on ${netLabel}…`);
        const v = await fetch('/api/chaser/pay-sponsored', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId: selectedInvoiceId, bytes: built.bytes, signature: signed.signature, mac: built.sponsored.mac }) });
        const data = await v.json();
        showToast(data?.message || data?.error || 'Payment sent', v.ok ? 'ok' : 'error');
        fetchInvoiceDetail(selectedInvoiceId);
        fetchSummary();
        fetchAllInvoices();
        return;
      }
      const fee = built.fee;
      setWalletBusy(
        built.swap
          ? `Approve in your wallet · ≈ ${built.swap.suiIn} SUI (max ${built.swap.maxSuiIn}) swapped via ${built.swap.via.join(', ')} → exactly ${built.amount} USDC, plus network fee`
          : fee
          ? fee.sui < 0
            ? `Approve in your wallet · you get a ${(-fee.sui).toFixed(4)} SUI storage rebate`
            : `Approve in your wallet · network fee ≈ ${fee.sui.toFixed(4)} SUI${fee.usd != null ? ` ($${fee.usd.toFixed(4)})` : ''}`
          : 'Approve in your wallet…',
      );
      const tx = Transaction.from(built.bytes);
      const out = await (wallet.features['sui:signAndExecuteTransaction'] as SuiSignAndExecuteTransactionFeature['sui:signAndExecuteTransaction']).signAndExecuteTransaction({
        transaction: { toJSON: async () => tx.toJSON() },
        account,
        chain,
      });
      setWalletBusy(`Verifying on ${netLabel}…`);
      let data: ApiBody & { message?: string } = {};
      for (let i = 0; i < 6; i++) {
        const v = await fetch('/api/chaser/verify-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId: selectedInvoiceId, digest: out.digest, channel: 'wallet' }) });
        data = await v.json();
        if (v.ok || v.status === 409) break;
        await new Promise((ok) => setTimeout(ok, 2500)); // the gateway may need a moment to see the tx
      }
      showToast(data?.message || data?.error || 'Payment sent', data?.error ? 'error' : 'ok');
      fetchInvoiceDetail(selectedInvoiceId);
      fetchSummary();
      fetchAllInvoices();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Wallet payment failed', 'error');
    } finally {
      setWalletBusy(null);
    }
  };

  // Apply the learned payment incentive; the server recomputes it, the owner only approves the kind.
  const handleApplyTerms = async (kind: string) => {
    if (!invoiceDetail) return;
    let res: Response, data: ApiBody & { invoice: { payAmount: string } };
    try {
      res = await fetch(`/api/chaser/invoices/${encodeURIComponent(invoiceDetail.invoice.id)}/terms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }) });
      data = await res.json();
    } catch { return showToast('Network error: terms not applied', 'error'); }
    if (!res.ok) return showToast(data.error || 'Could not apply terms', 'error');
    showToast(`New amount ${data.invoice.payAmount} USDC (writing to Walrus Memory)`);
    fetchInvoiceDetail(invoiceDetail.invoice.id);
    fetchAllInvoices();
    fetchSummary();
  };

  const handleStopRepeat = async () => {
    if (!invoiceDetail) return;
    let res: Response, data: ApiBody;
    try {
      res = await fetch(`/api/chaser/invoices/${encodeURIComponent(invoiceDetail.invoice.id)}/stop-repeat`, { method: 'POST' });
      data = await res.json();
    } catch { return showToast('Network error: the series was not stopped', 'error'); }
    if (!res.ok) return showToast(data.error || 'Could not stop the series', 'error');
    showToast('Series stopped: no further invoices will be issued (writing to Walrus Memory)');
    fetchInvoiceDetail(invoiceDetail.invoice.id);
  };
  const handleCreateInvoice = async () => {
    const amt = Number(newInvoice.amount);
    if (!/^\d+(\.\d{1,2})?$/.test(String(newInvoice.amount).trim()) || !(amt >= 0.01 && amt <= 1_000_000)) return showToast('Enter an amount from 0.01 to 1,000,000 USDC, at most 2 decimals (the app adds the unique micro-suffix)', 'error');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newInvoice.dueDate)) return showToast('Pick a due date', 'error');
    if (!newInvoice.clientId) return showToast('Pick a client', 'error');
    try {
      const { repeat, ...rest } = newInvoice;
      const res = await fetch('/api/chaser/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(repeat ? { ...rest, repeat } : rest),
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error || 'Could not create invoice', 'error');
      showToast(`Invoice ${data.invoice.id} created: pay exactly ${data.invoice.payAmount} USDC${repeat ? ` · repeats ${repeat}, the next one is issued before it falls due` : ''}`);
      await fetchAllInvoices();
      setSelectedInvoiceId(data.invoice.id);
      fetchSummary();
    } catch {
      showToast('Could not create invoice', 'error');
    }
  };

  const handleLogReminder = async (tone: string) => {
    try {
      const res = await fetch(`/api/chaser/invoices/${selectedInvoiceId}/remind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tone }),
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error || 'Could not log reminder', 'error');
      setReminderText(data.text);
      setReminderSource(data.draftedBy === 'llm' ? `Drafted by ${data.model} via Vercel AI Gateway from this client's memories` : `Template (AI drafting unavailable${data.fallbackReason ? `: ${String(data.fallbackReason).replace(/\[[0-9;]*m/g, '').split('.')[0]}` : ''})`);
      // what the fresh Walrus recall fed the drafter: hits, the SDK's token estimate, whether the budget trimmed it
      const mc = data.memoryContext;
      if (mc && !mc.error && mc.hits) setReminderSource((src) => `${src} · Walrus recall: ${mc.hits} memories, ~${mc.tokenEstimate} tokens${mc.truncated ? ' (trimmed to a 400-token budget)' : ''}`);
      navigator.clipboard?.writeText(data.text);
      showToast('Reminder copied and saved to Walrus Memory');
      fetchInvoiceDetail(selectedInvoiceId);
      fetchSummary();
    } catch {
      showToast('Could not log reminder', 'error');
    }
  };

  return (
    <div className="min-h-screen bg-primary text-primary flex flex-col font-sans">
      {/* Top Header & Navigation with Tabs recipe */}
      <header className="border-b border-secondary bg-primary sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-xl min-h-16 py-xs md:py-0 flex flex-wrap md:flex-nowrap items-center justify-between gap-y-xs">
          <a href={PAY_ONLY ? `?pay=${encodeURIComponent(PAY_ONLY)}` : '/'} className="flex items-center gap-md rounded-lg focus-visible:ring-2 focus-visible:ring-focus-ring">
            <LogoMark size={32} />
            <div>
              <span className="font-semibold text-sm text-primary tracking-tight">Invoice Chaser</span>
              <span className="ml-xs inline-flex items-center gap-xs rounded-full border border-utility-brand-200 bg-utility-brand-50 px-md py-xxs text-xs font-medium text-utility-brand-700">
                Sui USDC
              </span>
            </div>
          </a>

          {/* Navigation Bar adhering to tabs.md */}
          {!PAY_ONLY && <nav aria-label="Main" className="order-last md:order-none w-full md:w-auto flex gap-lg overflow-x-auto [mask-image:linear-gradient(to_right,black_80%,transparent)] md:[mask-image:none] border-b border-transparent md:h-16 items-end pb-xxs whitespace-nowrap">
            {(['today', 'clients', 'invoices', 'pay', 'proof'] as TabKey[]).map((tab) => (
              <button
                key={tab}
                onClick={() => goTab(tab)}
                aria-current={activeTab === tab ? 'page' : undefined}
                className={`border-b-2 px-md py-sm text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring ${
                  activeTab === tab
                    ? 'border-brand text-brand-primary'
                    : 'border-transparent text-tertiary hover:text-secondary'
                }`}
              >
                {tab === 'today' && 'Today'}
                {tab === 'clients' && 'Clients'}
                {tab === 'invoices' && 'Invoices'}
                {tab === 'pay' && 'Client Pay Page'}
                {tab === 'proof' && '/proof'}
              </button>
            ))}
          </nav>}

          <div className="flex items-center gap-sm">
            <span className={`inline-flex items-center gap-xs rounded-full border px-md py-xxs text-xs font-medium ${netLabel === 'Sui Testnet' ? 'border-utility-warning-200 bg-utility-warning-50 text-utility-warning-700' : 'border-utility-success-200 bg-utility-success-50 text-utility-success-700'}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-success-primary animate-pulse" />
              {netLabel === 'Sui Testnet' ? 'TESTNET' : 'Sui Mainnet'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-xl py-2xl">
        {apiError && (
          <div role="alert" className="mb-xl flex flex-wrap items-center gap-md rounded-xl border border-error-subtle bg-error-secondary px-lg py-md text-sm text-error-primary">
            <span className="font-semibold">{apiError}.</span>
            <span className="text-secondary">Numbers on this screen may be missing until it loads.</span>
            <button onClick={() => { setApiError(null); fetchSummary(); fetchClients(); fetchAllInvoices(); if (activeTab === 'proof') fetchProof(); }} className="ml-auto rounded-lg border border-primary bg-primary px-md py-xs text-sm font-semibold text-secondary hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">Retry</button>
          </div>
        )}
        {activeTab === 'today' && (
          <div className="space-y-2xl">
            {/* Header info */}
            <div>
              <h1 className="text-heading-lg font-semibold text-primary">Today's Cash Flow & Actions</h1>
              <p className="text-secondary text-sm mt-xs">
                Anticipated USDC settlements on {netLabel} with Walrus memory-driven chase recommendations.
              </p>
            </div>

            {/* Judge path: five stops that show the learning loop end to end */}
            <section className="rounded-xl border border-utility-brand-200 bg-utility-brand-50 p-lg flex flex-wrap items-center gap-sm">
              <span className="text-sm font-semibold text-utility-brand-700 mr-sm">Judging? 2-minute tour:</span>
              {[
                { label: `1 · ${tourClient?.name ?? 'Client'}'s learned profile`, go: () => { tourClient && setSelectedClientId(tourClient.id); goTab('clients'); } },
                { label: '2 · Memory on vs off', go: () => { tourInvoice && setSelectedInvoiceId(tourInvoice.id); setIgnoreMemory(true); goTab('invoices', tourInvoice?.id); } },
                { label: '3 · Teach a rule', go: () => { tourClient && setSelectedClientId(tourClient.id); goTab('clients'); setTimeout(() => { const el = document.getElementById('teach-rule'); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.focus({ preventScroll: true }); }, 300); } },
                { label: `4 · Pay on ${netLabel}`, go: () => { if (tourInvoice) setSelectedInvoiceId(tourInvoice.id); goTab('pay', tourInvoice?.id); } },
                { label: '5 · Live proof', go: () => goTab('proof') },
              ].map((st) => (
                <button key={st.label} onClick={st.go} className="rounded-full border border-utility-brand-200 bg-primary px-md py-xs text-xs font-semibold text-utility-brand-700 hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">
                  {st.label}
                </button>
              ))}
              {<span className="text-xs text-tertiary w-full">Aug–Oct client history is seeded demo data (labelled in each timeline). Everything you do here becomes a real Walrus Mainnet memory.</span>}
            </section>

            {/* Overview Stats (Card Recipe: rounded-xl, border-secondary, bg-primary, p-xl, shadow-xs) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-lg md:auto-rows-[minmax(10rem,auto)]">
              <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs">
                <div className="flex items-center justify-between text-tertiary mb-xs">
                  <span className="text-sm">Expected Inflow (Next 7 Days)</span>
                  <DollarSign className="w-4 h-4 text-fg-brand-primary" />
                </div>
                <div className="mt-md text-heading-md font-semibold text-primary">
                  {summary ? usd(summary.expectedInflow7Days) : '—'} <span className="text-xs font-normal text-secondary">USDC</span>
                </div>
                {summary?.expectedInflow7DaysRange && (
                  <div className="text-xs text-tertiary mt-xxs" title="From each client's learned pay-date spread (10th-90th percentile of past delays in Walrus Memory)">
                    Range {usd(summary.expectedInflow7DaysRange.low)} – {usd(summary.expectedInflow7DaysRange.high)} USDC, from each client's learned spread
                  </div>
                )}
                <div className="text-xs text-utility-success-700 mt-xs flex items-center gap-xxs font-medium">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>{summary ? summary.upcomingInflows.length : '—'} expected payments · {usd(summary?.expectedInflow30Days)} USDC in 30 days</span>
                </div>
              </section>

              <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs">
                <div className="flex items-center justify-between text-tertiary mb-xs">
                  <span className="text-sm">Overdue Balance</span>
                  <AlertCircle className="w-4 h-4 text-fg-error-primary" />
                </div>
                <div className="mt-md text-heading-md font-semibold text-primary">
                  {summary ? usd(summary.overdueAmount) : '—'} <span className="text-xs font-normal text-secondary">USDC</span>
                </div>
                <div className="text-xs text-secondary mt-xs flex items-center gap-xxs font-medium">
                  <span>Tracked across {clientsList.length || '—'} clients</span>
                </div>
              </section>

              <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs">
                <div className="flex items-center justify-between text-tertiary mb-xs">
                  <span className="text-sm">Prediction error (learned from memory)</span>
                  <Brain className="w-4 h-4 text-fg-brand-primary" />
                </div>
                <div className="mt-md text-heading-md font-semibold text-primary">
                  {summary?.learning ? <>{summary.learning.firstError}d → {summary.learning.latestError}d</> : '—'}
                </div>
                <div className="text-xs text-secondary mt-xs flex items-center gap-xxs">
                  <span>{summary?.learning ? `first invoice vs latest, ${summary.learning.clients} client(s), ${summary.learning.predictions} predictions` : 'appears once a client has 2 paid invoices'}</span>
                </div>
              </section>
            </div>

            {/* Chase queue: Walrus Memory joined with the payer wallet on Sui (Tatum) */}
            {queue && queue.items.length > 0 && (
              <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs" aria-labelledby="chase-queue-h">
                <div className="flex flex-wrap items-center justify-between gap-sm mb-lg">
                  <div>
                    <h2 id="chase-queue-h" className="text-heading-xs font-semibold text-primary">Who to chase today</h2>
                    <p className="text-xs text-secondary">What memory learned about each client, checked against their payer wallet on Sui right now (Tatum ListBalances + ListTransactions)</p>
                  </div>
                  <span className="text-xs text-tertiary">{Object.entries(queue.counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k.replace('_', ' ')}`).join(' · ')}</span>
                </div>
                <ol className="space-y-sm">
                  {queue.items.map((q) => {
                    const tone = q.action === 'chase_now' ? 'border-utility-error-200 bg-utility-error-50 text-utility-error-700' : q.action === 'nudge' ? 'border-utility-warning-200 bg-utility-warning-50 text-utility-warning-700' : q.action === 'wait' ? 'border-utility-brand-200 bg-utility-brand-50 text-utility-brand-700' : 'border-secondary bg-secondary text-secondary';
                    return (
                      <li key={q.invoiceId} className="flex flex-wrap items-start justify-between gap-sm p-md rounded-lg bg-secondary border border-secondary">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-xs">
                            <span className={`inline-flex rounded-full border px-sm py-xxs text-xs font-semibold ${tone}`}>{q.action.replace('_', ' ')}</span>
                            <span className="font-semibold text-sm text-primary">{q.clientName}</span>
                            <span className="text-xs text-secondary">{usd(q.owedUsdc)} USDC · #{q.invoiceId}</span>
                          </div>
                          <ul className="mt-xs list-disc pl-lg text-xs text-secondary space-y-xxs">
                            {q.why.map((w, i) => <li key={i}>{w}</li>)}
                          </ul>
                        </div>
                        <button onClick={() => { setSelectedInvoiceId(q.invoiceId); goTab('invoices', q.invoiceId); }} aria-label={`Open invoice ${q.invoiceId} (${q.clientName})`} className="inline-flex items-center rounded-lg border border-secondary bg-primary px-md py-xs text-sm font-semibold text-secondary hover:bg-primary_hover focus-visible:ring-2 focus-visible:ring-focus-ring shrink-0">
                          Open
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}

            {/* Next Actions & Inflows */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-xl">
              {/* Next Actions List */}
              <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs">
                <div className="flex items-center justify-between mb-lg">
                  <div>
                    <h2 className="text-heading-xs font-semibold text-primary">Recommended Next Actions</h2>
                    <p className="text-xs text-secondary">Derived from past client settlement history and preferences{summary?.hiddenSmall ? ` · ${summary.hiddenSmall} test invoice(s) under 1 USDC hidden (see Invoices)` : ''}</p>
                  </div>
                  <span className="inline-flex items-center gap-xs rounded-full border border-utility-brand-200 bg-utility-brand-50 px-md py-xxs text-xs font-medium text-utility-brand-700">
                    Walrus Memory
                  </span>
                </div>

                <div className="space-y-md">
                  {summary?.nextActions && summary.nextActions.length > 0 ? (
                    summary.nextActions.map((action, idx) => (
                      <div key={idx} className="p-md rounded-lg bg-secondary border border-secondary hover:border-brand transition-colors">
                        <div className="flex flex-wrap items-start justify-between gap-sm">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-xs">
                              <span className="font-semibold text-sm text-primary">Remind {action.clientName}</span>
                              <span className="inline-flex items-center gap-xs rounded-full border border-utility-warning-200 bg-utility-warning-50 px-sm py-xxs text-xs font-medium text-utility-warning-700 capitalize">
                                {action.recommendedTone} Tone
                              </span>
                              {action.underpayRisk && (
                                <span className="inline-flex items-center gap-xs rounded-full border border-utility-error-200 bg-utility-error-50 px-sm py-xxs text-xs font-medium text-utility-error-700">
                                  Underpay Risk {action.underpayRisk}%
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-secondary mt-xs">{action.reason}</p>
                            <div className="text-xs text-tertiary mt-xs flex items-center gap-xs">
                              <Clock className="w-3.5 h-3.5 text-fg-brand-primary" />
                              <span>Action date: {action.actionDate} • Invoice #{action.invoiceId}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              setSelectedInvoiceId(action.invoiceId);
                              goTab('invoices', action.invoiceId);
                            }}
                            className="inline-flex items-center gap-sm rounded-lg border border-transparent bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring shrink-0"
                          >
                            View Plan
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-secondary p-md">{summary ? 'No pending actions for today.' : 'Loading actions from Walrus Memory…'}</div>
                  )}
                </div>
              </section>

              {/* Expected USDC Inflow (7 Days) with Table recipe */}
              <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs">
                <div className="flex items-center justify-between mb-lg">
                  <div>
                    <h2 className="text-heading-xs font-semibold text-primary">Expected USDC Inflow (7 Days)</h2>
                    <p className="text-xs text-secondary">Predicted completion dates adjusted by Walrus memory</p>
                  </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-secondary bg-primary">
                  <table className="w-full">
                    <thead className="bg-secondary">
                      <tr className="border-b border-secondary text-left">
                        <th className="px-md py-sm text-xs font-semibold text-tertiary">Client & Invoice</th>
                        <th className="px-md py-sm text-xs font-semibold text-tertiary">Predicted Date</th>
                        <th className="px-md py-sm text-xs font-semibold text-tertiary text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary?.upcomingInflows && summary.upcomingInflows.length > 0 ? (
                        summary.upcomingInflows.map((item, idx) => (
                          <tr key={idx} className="border-b border-secondary hover:bg-secondary-hover">
                            <td className="px-md py-sm text-sm text-primary font-medium">
                              <div>{item.clientName}</div>
                              <div className="text-xs text-tertiary">#{item.invoiceId} • Due {item.dueDate}</div>
                            </td>
                            <td className="px-md py-sm text-sm text-tertiary whitespace-nowrap">
                              {item.predictedPayDate} {item.delayDays > 0 ? `(+${item.delayDays}d)` : '(On time)'}
                              {item.earliest && item.latest && item.earliest !== item.latest && <div className="text-xs text-quaternary">likely {item.earliest.slice(5)} – {item.latest.slice(5)}</div>}
                            </td>
                            <td className="px-md py-sm text-sm text-right">
                              <div className="font-semibold text-primary">{item.payAmount} USDC</div>
                              <span className="inline-flex items-center rounded-full border border-utility-brand-200 bg-utility-brand-50 px-sm py-xxs text-xs font-medium text-utility-brand-700">
                                {item.status}
                              </span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={3} className="px-md py-sm text-sm text-tertiary text-center">
                            {summary ? 'No inflows scheduled this week.' : 'Loading…'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        )}

        {activeTab === 'clients' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-xl">
            {/* Clients List */}
            <div className="lg:col-span-1 space-y-md">
              <div className="flex items-center justify-between">
                <h1 className="text-heading-xs font-semibold text-primary">Clients</h1>
                <span className="text-xs text-secondary">{clientsList.length} active clients</span>
              </div>
              <div className="flex gap-sm">
                <input value={newClientName} onChange={(e) => setNewClientName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleAddClient(); }} placeholder="New client name" aria-label="New client name" className="flex-1 min-w-0 rounded-md bg-primary px-md py-xs text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring" />
                <button onClick={handleAddClient} className="rounded-lg bg-brand-solid px-md py-xs text-xs font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring">Add</button>
              </div>

              <div className="space-y-sm">
                {clientsList.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => setSelectedClientId(c.id)}
                    aria-pressed={selectedClientId === c.id}
                    className={`block w-full text-left p-md rounded-xl border cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring ${
                      selectedClientId === c.id
                        ? 'bg-secondary border-brand shadow-xs'
                        : 'bg-primary border-secondary hover:bg-secondary-hover'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-sm text-primary">{c.name}</div>
                      <span
                        className={`inline-flex items-center rounded-full px-md py-xxs text-xs font-medium border ${
                          c.profile.reliabilityBadge.includes('Reliable')
                            ? 'bg-utility-success-50 text-utility-success-700 border-utility-success-200'
                            : c.profile.reliabilityBadge.includes('Underpayer')
                            ? 'bg-utility-error-50 text-utility-error-700 border-utility-error-200'
                            : c.profile.reliabilityBadge.includes('Late')
                            ? 'bg-utility-warning-50 text-utility-warning-700 border-utility-warning-200'
                            : 'bg-utility-brand-50 text-utility-brand-700 border-utility-brand-200'
                        }`}
                      >
                        {c.profile.reliabilityBadge}
                      </span>
                    </div>
                    <div className="text-xs text-secondary mt-xxs">
                      {c.profile.totalPaidInvoices === 0 ? 'No payment history yet' : <>Typical delay: {delayLabel(c.profile)} • Reminders: ~{Math.round(c.profile.remindersNeeded)} • {c.profile.totalPaidInvoices} paid</>}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Client Detail */}
            <div className="lg:col-span-2 space-y-xl">
              {clientDetail ? (
                <>
                  {/* Profile Card */}
                  <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs space-y-lg">
                    <div className="flex items-center justify-between border-b border-secondary pb-md">
                      <div>
                        <h2 className="text-heading-sm font-semibold text-primary">{clientDetail.client.name}</h2>
                        <p className="text-xs text-secondary">
                          Walrus Namespace: <code className="text-brand-primary font-mono">{clientDetail.namespace}</code>
                        </p>
                        <a href={`${import.meta.env.VITE_API_BASE || ""}/api/chaser/clients/${clientDetail.client.id}/statement?format=csv`} onClick={(e) => ownerDownload(e, `/api/chaser/clients/${clientDetail.client.id}/statement?format=csv`, `statement-${clientDetail.client.id}.csv`)} className="text-xs font-semibold text-utility-brand-700 hover:underline">Statement of account (CSV, verified on Sui)</a>
                      </div>
                      <button
                        onClick={handleRebuildFromMemory}
                        className="inline-flex items-center gap-sm rounded-lg bg-primary px-lg py-sm text-sm font-semibold text-secondary border border-primary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Total Recall: rebuild from Walrus
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-md">
                      <div className="p-md bg-secondary rounded-lg border border-secondary">
                        <span className="text-xs text-tertiary" title={`Recent-weighted (EWMA), what the plan predicts with; median ${clientDetail.profile.medianDelayDays} days`}>Typical Delay</span>
                        <div className="text-heading-xs font-bold text-primary mt-xxs">
                          {delayLabel(clientDetail.profile)}
                        </div>
                      </div>

                      <div className="p-md bg-secondary rounded-lg border border-secondary">
                        <span className="text-xs text-tertiary">Reminders Needed</span>
                        <div className="text-heading-xs font-bold text-primary mt-xxs">
                          {clientDetail.profile.remindersNeeded}
                        </div>
                      </div>

                      <div className="p-md bg-secondary rounded-lg border border-secondary">
                        <span className="text-xs text-tertiary">Best Tone (Hit-Rate)</span>
                        <div className="text-heading-xs font-bold text-primary mt-xxs capitalize">
                          {clientDetail.profile.bestTone} ({clientDetail.profile.toneStats[clientDetail.profile.bestTone]?.rate || 0}%)
                        </div>
                      </div>

                      <div className="p-md bg-secondary rounded-lg border border-secondary">
                        <span className="text-xs text-tertiary">Underpay Rate</span>
                        <div className="text-heading-xs font-bold text-primary mt-xxs">
                          {clientDetail.profile.underpayRate}%
                        </div>
                      </div>
                    </div>

                    {/* Learning chart: what we predicted before each payment vs what happened */}
                    {clientDetail.profile.history && clientDetail.profile.history.length > 0 && (() => {
                      const h = clientDetail.profile.history!;
                      const max = Math.max(1, ...h.flatMap((x) => [Math.abs(x.predicted), Math.abs(x.actual)]));
                      return (
                        <div className="p-md bg-secondary rounded-lg border border-secondary space-y-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-primary">How the prediction learned</span>
                            <span className="text-xs text-tertiary">days late (or early): predicted before payment vs actual</span>
                          </div>
                          {h.map((x) => (
                            <div key={x.invoice} className="grid grid-cols-[72px_1fr_64px] items-center gap-sm text-xs">
                              <span className="text-secondary font-mono">#{x.n} {x.invoice}</span>
                              <div className="space-y-xxs">
                                <div className="h-2 rounded-full bg-utility-brand-200" style={{ width: `${(Math.abs(x.predicted) / max) * 100}%`, minWidth: 2 }} title={`predicted ${x.predicted < 0 ? `${-x.predicted}d early` : `${x.predicted}d late`}`} />
                                <div className="h-2 rounded-full bg-brand-solid" style={{ width: `${(Math.abs(x.actual) / max) * 100}%`, minWidth: 2 }} title={`actual ${x.actual < 0 ? `${-x.actual}d early` : `${x.actual}d late`}`} />
                              </div>
                              <span className={x.error === 0 ? 'text-utility-success-700 font-semibold' : 'text-tertiary'}>
                                {x.error === 0 ? 'exact' : `off by ${x.error}d`}
                              </span>
                            </div>
                          ))}
                          <div className="flex gap-md text-xs text-tertiary">
                            <span className="inline-flex items-center gap-xxs"><span className="w-2 h-2 rounded-full bg-utility-brand-200" /> predicted</span>
                            <span className="inline-flex items-center gap-xxs"><span className="w-2 h-2 rounded-full bg-brand-solid" /> actual</span>
                          </div>
                        </div>
                      );
                    })()}

                    {Number(clientDetail.profile.creditUsdc || 0) > 0 && (
                      <p className="rounded-md border border-secondary bg-utility-success-50 px-md py-xs text-xs text-utility-success-700">Credit on account: <span className="font-semibold">{clientDetail.profile.creditUsdc} USDC</span> overpaid on earlier invoices (remembered in Walrus with each payment).</p>
                    )}

                    {/* Active rules: each can be revoked (append-only revocation memory on Walrus) */}
                    {(clientDetail.profile.preferences.length > 0 || (clientDetail.profile.revokedRules || []).length > 0) && (
                      <div className="flex flex-col gap-xs pt-xs">
                        <p className="text-sm font-medium text-secondary">Rules the plan obeys</p>
                        <ul className="flex flex-col gap-xs">
                          {clientDetail.profile.preferences.map((r) => (
                            <li key={r} className="flex items-start justify-between gap-sm rounded-md border border-secondary bg-secondary px-md py-xs text-xs text-secondary">
                              <span>{r}</span>
                              <button onClick={() => handleRevokeRule(r)} aria-label={`Revoke rule: ${r}`} className="shrink-0 font-semibold text-fg-error-primary hover:underline focus-visible:ring-2 focus-visible:ring-focus-ring rounded-sm">Revoke</button>
                            </li>
                          ))}
                          {(clientDetail.profile.revokedRules || []).map((r) => (
                            <li key={`x-${r}`} className="rounded-md border border-secondary px-md py-xs text-xs text-tertiary line-through" title="Revoked: still on Walrus, no longer applied">{r}</li>
                          ))}
                        </ul>
                        <p className="text-xs text-tertiary">Walrus is append-only, so revoking writes a new memory; the original stays on Walrus as history.</p>
                      </div>
                    )}

                    {/* Tell me something about this client (Input & Field Recipe) */}
                    <div className="flex flex-col gap-sm pt-xs">
                      <label className="text-sm font-medium text-secondary flex items-center gap-xs">
                        <MessageSquare className="w-3.5 h-3.5 text-fg-brand-primary" />
                        <span>Tell me something about this client</span>
                      </label>
                      <div className="flex gap-sm">
                        <input
                          type="text"
                          value={clientNote}
                          aria-label="Rule for this client"
                          onChange={(e) => setClientNote(e.target.value)}
                          placeholder='e.g. "Never chase before the 10th of the month" or "Prefers formal reminders"'
                          className="flex-1 min-w-0 rounded-md bg-primary px-lg py-sm text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
                        />
                        <button
                          onClick={handleSavePreference}
                          className="inline-flex items-center gap-sm rounded-lg border border-transparent bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring shrink-0"
                        >
                          Save Preference
                        </button>
                      </div>
                      <p className="text-xs text-tertiary">Saves hard preference constraints directly to Walrus Memory.</p>
                    </div>

                    {/* Expected payer wallet: 0x… or a SuiNS name, resolved and screened through Tatum */}
                    <div className="flex flex-col gap-sm pt-xs">
                      <label className="text-sm font-medium text-secondary flex items-center gap-xs">
                        <ShieldCheck className="w-3.5 h-3.5 text-fg-brand-primary" />
                        <span>Wallet this client pays from {clientDetail.client.expectedPayer ? <span className="font-mono text-xs text-tertiary">({clientDetail.client.expectedPayer.name || clientDetail.client.expectedPayer.address.slice(0, 12) + '…'})</span> : null}</span>
                      </label>
                      {!!clientDetail.client.provenPayers?.length && (
                        <p className="text-xs text-utility-success-700">
                          Claimed via the pay link (signature-verified, not proof of identity): {clientDetail.client.provenPayers.map((p) => `${p.address.slice(0, 10)}…${p.address.slice(-4)} on ${p.at.slice(0, 10)}`).join(', ')}
                        </p>
                      )}
                      <div className="flex gap-sm">
                        <input value={payerInput} onChange={(e) => setPayerInput(e.target.value)} placeholder="0x… or name.sui" aria-label="Expected payer wallet" className="flex-1 min-w-0 rounded-md bg-primary px-lg py-sm text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring" />
                        <button onClick={handleSetPayer} className="rounded-lg border border-primary bg-primary px-lg py-sm text-sm font-semibold text-secondary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">Set payer</button>
                      </div>
                      <p className="text-xs text-tertiary">SuiNS names resolve through Tatum; the wallet is screened with Tatum's Malicious Address API. Payments from any other wallet are flagged.</p>
                    </div>

                    {/* Free-form notes -> Walrus Memory analyze() */}
                    <div className="flex flex-col gap-sm pt-xs">
                      <label htmlFor="teach-rule" className="text-sm font-medium text-secondary flex items-center gap-xs">
                        <Brain className="w-3.5 h-3.5 text-fg-brand-primary" />
                        <span>Paste an email or call notes from this client</span>
                      </label>
                      <label className="text-xs text-tertiary flex items-center gap-xs">Sent or held on
                        <input type="date" value={noteDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setNoteDate(e.target.value)} className="rounded-md bg-primary px-sm py-xxs text-xs text-primary border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring" />
                        <span>(relative dates like "next Friday" are resolved against this; a promise to pay is tracked)</span>
                      </label>
                      <textarea
                        id="teach-rule"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        rows={3}
                        placeholder={'e.g. "Hi, our AP team only runs payments on Thursdays and never before the 15th. Please cc finance@acme.example on invoices."'}
                        className="rounded-md bg-primary px-lg py-sm text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
                      />
                      <button onClick={handleIngestNotes} disabled={noteBusy} className="self-start inline-flex items-center gap-sm rounded-lg border border-primary bg-primary px-lg py-sm text-sm font-semibold text-secondary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring disabled:text-disabled">
                        {noteBusy ? 'Walrus is extracting facts…' : 'Extract facts with Walrus analyze()'}
                      </button>
                      <p className="text-xs text-tertiary">Walrus Memory pulls out each fact and stores it as its own memory; scheduling rules found in them are obeyed.</p>
                    </div>
                  </section>

                  {/* Timeline of Memories */}
                  <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs">
                    <div className="flex items-center justify-between mb-lg">
                      <h2 className="text-heading-xs font-semibold text-primary flex items-center gap-xs">
                        <Brain className="w-4 h-4 text-fg-brand-primary" />
                        <span>Walrus Memory Timeline</span>
                      </h2>
                      <span className="text-xs text-secondary">{clientDetail.memories.length} memories recorded</span>
                    </div>

                    {/* Semantic search over this client's memories (Walrus recall) */}
                    <div className="mb-lg space-y-sm">
                      <div className="flex gap-sm">
                        <input
                          value={memQuery}
                          onChange={(e) => setMemQuery(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleMemorySearch(); }}
                          placeholder='Ask this memory, e.g. "when do they usually pay?" or "what tone works?"'
                          aria-label="Search this client's memory"
                          className="flex-1 min-w-0 rounded-md bg-primary px-md py-xs text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
                        />
                        <button onClick={() => handleMemorySearch()} disabled={memBusy} className="rounded-lg border border-primary bg-primary px-md py-xs text-xs font-semibold text-secondary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring disabled:text-disabled">
                          {memBusy ? 'Recalling…' : 'Recall'}
                        </button>
                      </div>
                      {memHits && (
                        <div className="rounded-lg border border-utility-brand-200 bg-utility-brand-50 p-md space-y-xs">
                          <div className="flex flex-wrap items-center gap-xs">
                            <p className="text-xs font-semibold text-utility-brand-700 mr-auto">Walrus recall: {memMode === 'recent' ? 'newest among the matches' : memMode === 'weighted' ? 'meaning blended with recency' : 'closest memories by meaning'}</p>
                            {(['relevance', 'recent', 'weighted'] as const).map((m) => (
                              <button key={m} onClick={() => handleMemorySearch(m)} disabled={memBusy} aria-pressed={memMode === m} className={`rounded-full border px-sm py-xxs text-xs font-medium focus-visible:ring-2 focus-visible:ring-focus-ring ${memMode === m ? 'border-utility-brand-600 bg-utility-brand-600 text-white' : 'border-utility-brand-200 bg-primary text-utility-brand-700'}`}>{m === 'relevance' ? 'Closest' : m === 'recent' ? 'Newest' : 'Weighted'}</button>
                            ))}
                          </div>
                          {memHits.length === 0 && <p className="text-xs text-tertiary">Nothing relevant remembered yet.</p>}
                          {memHits.map((h, i) => (
                            <div key={i} className="text-xs text-secondary flex gap-xs">
                              <span className="shrink-0 font-mono text-tertiary" title="cosine distance (smaller = closer)">{h.distance.toFixed(2)}</span>
                              <span className="flex-1">{h.sentence}</span>
                              <a href={`https://walruscan.com/mainnet/blob/${h.blobId}`} target="_blank" rel="noreferrer" className="shrink-0 text-utility-brand-700 hover:underline">blob</a>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-md border-l-2 border-secondary ml-xs pl-md">
                      {clientDetail.memories.length > 0 ? (
                        clientDetail.memories.map((mem) => (
                          <div key={mem.id} className="relative">
                            <div className="absolute -left-[23px] top-1 w-2.5 h-2.5 rounded-full bg-brand-solid" />
                            <div className="text-xs font-medium text-primary">
                              {mem.tag?.type ? mem.tag.type.replace('_', ' ').toUpperCase() : 'EVENT'}
                            </div>
                            <p className="text-xs text-secondary mt-xxs">{mem.sentence}</p>
                            <div className="flex items-center gap-sm mt-xxs text-xs">
                              <span className="text-tertiary">{mem.timestamp?.slice(0, 10)}</span>
                              {mem.status === 'saved' && mem.blobId ? (
                                <a href={`https://walruscan.com/mainnet/blob/${mem.blobId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-xxs text-utility-brand-700 hover:underline">
                                  On Walrus <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : (
                                <span className={mem.status === 'failed' ? 'text-utility-error-600' : 'text-utility-warning-600'}>{mem.status === 'failed' ? 'write failed, retrying' : 'writing to Walrus…'}</span>
                              )}
                              {mem.tag?.seed && <span className="text-tertiary">· seeded demo history</span>}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-secondary">No memories in this namespace yet. New client.</div>
                      )}
                    </div>
                  </section>
                </>
              ) : (
                <div className="p-xl bg-secondary rounded-xl border border-secondary text-secondary text-sm">
                  Select a client to view profile.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'invoices' && (
          <div className="space-y-xl">
            <div className="flex flex-wrap items-center justify-between gap-md">
              <div>
                <div className="flex flex-wrap items-center gap-x-md gap-y-xs"><h1 className="text-heading-lg font-semibold text-primary">Invoice Detail</h1> <a href={`${import.meta.env.VITE_API_BASE || ""}/api/chaser/export.csv`} onClick={(e) => ownerDownload(e, '/api/chaser/export.csv', 'invoice-chaser.csv')} className="text-xs font-semibold text-utility-brand-700 hover:underline">Export CSV</a> <a href={`${import.meta.env.VITE_API_BASE || ""}/api/chaser/reminders.ics`} onClick={(e) => ownerDownload(e, '/api/chaser/reminders.ics', 'invoice-chaser-reminders.ics')} className="text-xs font-semibold text-utility-brand-700 hover:underline">Reminders to calendar (.ics)</a></div>
                <p className="text-secondary text-sm mt-xs">
                  Review reminder plans, memory reasoning, and payment parameters.
                </p>
              </div>

              {/* Select component recipe */}
              <div className="flex flex-wrap items-center gap-sm min-w-0 max-w-full">
                <label htmlFor="invoice-select" className="text-xs text-secondary">Select Invoice:</label>
                <div className="relative">
                  <select
                    id="invoice-select"
                    value={selectedInvoiceId}
                    onChange={(e) => { setSelectedInvoiceId(e.target.value); goTab(activeTab, e.target.value); }}
                    className="appearance-none max-w-[calc(100vw-3rem)] md:max-w-none truncate flex items-center justify-between gap-sm rounded-md bg-primary px-lg py-sm pr-10 text-sm text-primary border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring cursor-pointer"
                  >
                    {/* real invoices first (test payments under 1 USDC last), open before paid, newest first */}
                    {[...allInvoices].sort((a, b) => Number(b.baseAmount >= 1) - Number(a.baseAmount >= 1) || Number(a.status === 'paid') - Number(b.status === 'paid') || String(b.id).localeCompare(String(a.id))).map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        #{inv.id} ({inv.clientName} - {inv.payAmount} USDC · {inv.status})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="size-4 shrink-0 text-fg-quaternary absolute right-3 top-3 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* New invoice */}
            <section className="rounded-xl border border-secondary bg-primary p-lg shadow-xs flex flex-wrap items-end gap-md">
              <div className="flex flex-col gap-xxs">
                <label htmlFor="ni-client" className="text-xs text-tertiary">Client</label>
                <select id="ni-client" value={newInvoice.clientId} onChange={(e) => setNewInvoice({ ...newInvoice, clientId: e.target.value })} className="rounded-md bg-primary px-md py-xs text-sm text-primary border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring">
                  {clientsList.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </select>
              </div>
              <div className="flex flex-col gap-xxs">
                <label htmlFor="ni-amount" className="text-xs text-tertiary">Amount (USDC)</label>
                <input id="ni-amount" type="number" min="0.01" step="0.01" value={newInvoice.amount} onChange={(e) => setNewInvoice({ ...newInvoice, amount: e.target.value })} className="rounded-md bg-primary px-md py-xs text-sm text-primary border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring w-28" />
              </div>
              <div className="flex flex-col gap-xxs">
                <label htmlFor="ni-due" className="text-xs text-tertiary">Due date</label>
                <input id="ni-due" type="date" value={newInvoice.dueDate} onChange={(e) => setNewInvoice({ ...newInvoice, dueDate: e.target.value })} className="rounded-md bg-primary px-md py-xs text-sm text-primary border border-primary focus:ring-2 focus:ring-focus-ring" />
              </div>
              <div className="flex flex-col gap-xxs flex-1 min-w-[160px]">
                <label htmlFor="ni-desc" className="text-xs text-tertiary">Description</label>
                <input id="ni-desc" type="text" value={newInvoice.description} onChange={(e) => setNewInvoice({ ...newInvoice, description: e.target.value })} placeholder="What is this invoice for?" className="rounded-md bg-primary px-md py-xs text-sm text-primary border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring" />
              </div>
              <div className="flex flex-col gap-xxs">
                <label htmlFor="ni-repeat" className="text-xs text-tertiary">Repeat</label>
                <select id="ni-repeat" value={newInvoice.repeat} onChange={(e) => setNewInvoice({ ...newInvoice, repeat: e.target.value as '' | 'monthly' | 'weekly' })} className="rounded-md bg-primary px-md py-xs text-sm text-primary border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring">
                  <option value="">Once</option>
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <button onClick={handleCreateInvoice} className="inline-flex items-center gap-sm rounded-lg bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring">
                <DollarSign className="w-4 h-4" /> New invoice
              </button>
            </section>

            {invoiceDetail && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-xl">
                {/* Left Column: Invoice summary & pay link */}
                <div className="lg:col-span-1 space-y-lg">
                  <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs space-y-md">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-tertiary">Status</span>
                      <span
                        className={`inline-flex items-center rounded-full px-md py-xxs text-xs font-medium border capitalize ${
                          invoiceDetail.invoice.status === 'paid'
                            ? 'bg-utility-success-50 text-utility-success-700 border-utility-success-200'
                            : invoiceDetail.invoice.status === 'partial'
                            ? 'bg-utility-warning-50 text-utility-warning-700 border-utility-warning-200'
                            : 'bg-utility-brand-50 text-utility-brand-700 border-utility-brand-200'
                        }`}
                      >
                        {invoiceDetail.invoice.status}
                      </span>
                    </div>

                    <div>
                      <span className="text-xs text-tertiary">{invoiceDetail.invoice.status === 'partial' ? `Still owed (partially paid)` : 'Unique Payable Amount (6 decimals)'}</span>
                      <div className="mt-xs text-heading-md font-semibold text-primary">
                        {invoiceDetail.invoice.payAmount} <span className="text-xs font-normal text-secondary">USDC</span>
                      </div>
                      <p className="text-xs text-tertiary mt-xxs">
                        Base: {invoiceDetail.invoice.baseAmount} USDC + unique micro-suffix for deterministic Sui settlement.
                      </p>
                    </div>

                    <div className="border-t border-secondary pt-md space-y-xs">
                      <div className="flex justify-between text-xs">
                        <span className="text-secondary">Client:</span>
                        <span className="font-medium text-primary">{invoiceDetail.invoice.clientName}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-secondary">Due Date:</span>
                        <span className="font-medium text-primary">{invoiceDetail.invoice.dueDate}</span>
                      </div>
                      {invoiceDetail.invoice.repeat && (
                        <div className="flex flex-wrap items-center justify-between gap-xs text-xs">
                          <span className="text-secondary">Repeats:</span>
                          <span className="font-medium text-primary">
                            {invoiceDetail.invoice.repeatStopped
                              ? `${invoiceDetail.invoice.repeat}, stopped`
                              : `${invoiceDetail.invoice.repeat} · next due ${invoiceDetail.invoice.nextDue}`}
                            {invoiceDetail.invoice.prev && ` · follows ${invoiceDetail.invoice.prev}`}
                          </span>
                          {!invoiceDetail.invoice.repeatStopped && (
                            <button onClick={handleStopRepeat} className="font-semibold text-utility-error-700 hover:underline focus-visible:ring-2 focus-visible:ring-focus-ring rounded">Stop repeating</button>
                          )}
                        </div>
                      )}
                      <div className="flex justify-between text-xs">
                        <span className="text-secondary">Payee Address:</span>
                        <span className="font-mono text-xs text-secondary truncate max-w-[150px]">
                          {invoiceDetail.invoice.payeeAddress}
                        </span>
                      </div>
                    </div>

                    <div className="border-t border-secondary pt-md space-y-sm">
                      {invoiceDetail.invoice.status !== 'paid' && (
                        <div className="p-md bg-secondary rounded-lg border border-secondary flex flex-col items-center justify-center text-center">
                          {qr ? <img src={qr} alt="Sui Payment Kit QR code for this invoice" className="w-40 h-40 mb-xs" /> : <QrCode className="w-24 h-24 text-primary mb-xs" />}
                          <span className="text-xs font-medium text-primary">Scan with a Sui wallet</span>
                          <span className="text-xs text-secondary">{netLabel} · Payment Kit registry</span>
                        </div>
                      )}

                      <button
                        onClick={() => goTab('pay', selectedInvoiceId)}
                        className="w-full inline-flex items-center justify-center gap-sm rounded-lg border border-transparent bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Preview client pay page
                      </button>
                      <button
                        onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/?pay=${invoiceDetail.invoice.id}`); showToast('Pay link copied: send it to your client'); }}
                        className="w-full inline-flex items-center justify-center gap-sm rounded-lg border border-primary bg-primary px-lg py-sm text-sm font-semibold text-secondary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy client pay link
                      </button>
                      {invoiceDetail.invoice.explorerTx && (
                        <a href={invoiceDetail.invoice.explorerTx} target="_blank" rel="noreferrer" className="block text-center text-xs text-utility-brand-700 hover:underline">View payment on Suiscan</a>
                      )}
                      {invoiceDetail.invoice.status === 'paid' && invoiceDetail.invoice.explorerTx && (invoiceDetail.invoice.receipt ? (
                        <a href={invoiceDetail.invoice.receipt.url} target="_blank" rel="noreferrer" className="block text-center text-xs text-utility-brand-700 hover:underline">PDF receipt on Walrus ({invoiceDetail.invoice.receipt.blobId.slice(0, 10)}…)</a>
                      ) : invoiceDetail.invoice.receiptsEnabled ? (
                        <button type="button" disabled={storingReceipt} onClick={() => storeReceipt(invoiceDetail.invoice.id)} className="w-full rounded-lg border border-primary px-lg py-sm text-xs font-semibold text-secondary hover:bg-primary-hover disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-focus-ring">
                          {storingReceipt ? 'Storing receipt on Walrus (~15 s)…' : 'Store PDF receipt on Walrus'}
                        </button>
                      ) : null)}
                    </div>
                  </section>
                </div>

                {/* Right Column: Reminder Plan & "Why?" panel */}
                <div className="lg:col-span-2 space-y-lg">
                  <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs space-y-lg">
                    <div className="flex items-center justify-between border-b border-secondary pb-md">
                      <div>
                        <h2 className="text-heading-xs font-semibold text-primary">
                          {ignoreMemory ? 'Default Plan (Without Memory)' : 'Adaptive Reminder Plan'}
                        </h2>
                        <p className="text-xs text-secondary">
                          {ignoreMemory ? 'Standard fixed interval fallback' : 'Calculated deterministically from Walrus client memories'}
                        </p>
                      </div>

                      {/* Switch recipe: track + sliding thumb */}
                      <div className="flex items-center gap-xs">
                        <span className="text-xs text-secondary font-medium">Ignore memory</span>
                        <button
                          role="switch"
                          aria-checked={ignoreMemory}
                          aria-label="Ignore memory"
                          onClick={() => setIgnoreMemory(!ignoreMemory)}
                          className={`flex h-6 w-11 shrink-0 items-center rounded-full p-xxs transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring ${
                            ignoreMemory ? 'bg-brand-solid' : 'bg-tertiary'
                          }`}
                        >
                          <span
                            className={`size-5 rounded-full bg-primary shadow-xs transform transition-transform ${
                              ignoreMemory ? 'translate-x-5' : 'translate-x-0'
                            }`}
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    </div>

                    {!ignoreMemory ? (
                      /* Adaptive Memory Plan */
                      <div className="space-y-md">
                        <div className="flex items-start gap-md p-md rounded-lg bg-secondary border border-secondary">
                          <div className="p-xs bg-utility-brand-50 text-utility-brand-700 rounded-md">
                            <Clock className="w-4 h-4" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-primary">
                                Predicted Payment: {invoiceDetail.adaptivePlan.predictedPayDate ?? 'no history yet'}
                              </span>
                              <span className="inline-flex items-center rounded-full border border-utility-brand-200 bg-utility-brand-50 px-sm py-xxs text-xs font-medium text-utility-brand-700">
                                Adaptive
                              </span>
                            </div>
                            <p className="text-xs text-secondary mt-xxs">
                              Schedule is tuned specifically to this client's historical payment speed.
                            </p>
                          </div>
                        </div>

                        <div className="space-y-sm">
                          {invoiceDetail.adaptivePlan.steps.map((st, i) => (
                            <div key={i} className="p-sm bg-secondary rounded-lg border border-secondary flex items-center justify-between">
                              <div>
                                <div className="text-xs font-medium text-primary capitalize">Step {i + 1}: {st.tone} Reminder</div>
                                <div className="text-xs text-secondary">Scheduled Date: {st.date} • {st.reason}</div>
                              </div>
                              <span className="inline-flex items-center rounded-full border border-utility-brand-200 bg-utility-brand-50 px-sm py-xxs text-xs font-medium text-utility-brand-700 capitalize">
                                {st.tone}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      /* Default Plan */
                      <div className="space-y-md">
                        <div className="flex gap-lg rounded-xl bg-utility-warning-50 p-md text-xs text-utility-warning-700 font-medium">
                          Default non-adaptive plan for baseline comparison:
                        </div>
                        <div className="space-y-sm">
                          {invoiceDetail.defaultPlan.steps.map((st, i) => (
                            <div key={i} className="p-sm bg-secondary rounded-lg border border-secondary flex items-center justify-between">
                              <div>
                                <div className="text-xs font-medium text-primary capitalize">Default {i + 1}: {st.tone}</div>
                                <div className="text-xs text-secondary">Date: {st.date} ({st.reason})</div>
                              </div>
                              <span className="text-xs text-secondary">Default</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Log a reminder you actually sent */}
                    {invoiceDetail.invoice.status !== 'paid' && (
                      <div className="space-y-sm border-t border-secondary pt-md">
                        <div className="flex flex-wrap items-center gap-sm">
                          <span className="text-xs text-secondary font-medium">Send a reminder now:</span>
                          {['friendly', 'formal', 'firm'].map((t) => (
                            <button key={t} onClick={() => handleLogReminder(t)} className="inline-flex items-center gap-xs rounded-lg border border-primary bg-primary px-md py-xs text-xs font-semibold text-secondary capitalize shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring">
                              <MessageSquare className="w-3.5 h-3.5" /> {t}
                            </button>
                          ))}
                        </div>
                        {reminderText && (
                          <div className="text-xs text-secondary bg-secondary rounded-lg border border-secondary p-md space-y-xs">
                            <p className="whitespace-pre-line">{reminderText}</p>
                            {reminderSource && <p className="text-tertiary italic">{reminderSource}</p>}
                            <a href={`mailto:${encodeURIComponent(((c) => (c && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) ? c : ''))(clientsList.find((c) => c.id === invoiceDetail.invoice.clientId)?.contact))}?subject=${encodeURIComponent(`Invoice ${invoiceDetail.invoice.id}`)}&body=${encodeURIComponent(`${reminderText}\n\nPay here: ${window.location.origin}/?pay=${invoiceDetail.invoice.id}
Invoice PDF: ${window.location.origin}/api/chaser/pay/${invoiceDetail.invoice.id}/invoice.pdf`)}`} className="inline-flex items-center gap-xxs font-semibold text-utility-brand-700 hover:underline">
                              Open in your email app <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Alert Recipe: Why? Panel */}
                    <div className="flex gap-lg rounded-xl bg-utility-brand-50 p-xl">
                      <HelpCircle className="mt-xxs size-5 shrink-0 text-utility-brand-600" aria-hidden="true" />
                      <div className="space-y-xs">
                        <p className="text-sm font-semibold text-utility-brand-600">Why this plan? (Walrus Memories Used)</p>
                        <ul className="text-xs text-tertiary space-y-xxs list-disc list-inside">
                          {(!ignoreMemory ? invoiceDetail.adaptivePlan.memoriesUsed : invoiceDetail.defaultPlan.memoriesUsed).map((m, idx) => (
                            <li key={idx}>{m}</li>
                          ))}
                          {!ignoreMemory && invoiceDetail.payerLiquidity && (
                            <li title={`${invoiceDetail.payerLiquidity.owner}, read ${invoiceDetail.payerLiquidity.at} via Tatum StateService.ListBalances`}>
                              Payer wallet right now ({invoiceDetail.payerLiquidity.source}{invoiceDetail.payerLiquidity.name ? `, ${invoiceDetail.payerLiquidity.name}` : ''}): {Number(invoiceDetail.payerLiquidity.usdc).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC, {invoiceDetail.payerLiquidity.sui.toFixed(3)} SUI. {invoiceDetail.payerLiquidity.covers ? 'Enough USDC to pay this invoice now: a nudge can work.' : 'Not enough USDC there to pay this invoice yet: expect a delay, or another wallet.'}
                            </li>
                          )}
                        </ul>
                        {!ignoreMemory && (invoiceDetail.adaptivePlan.cites?.length ?? 0) > 0 && (
                          <div className="pt-xs space-y-xxs">
                            <p className="text-xs font-semibold text-utility-brand-600">Cited memories</p>
                            {invoiceDetail.adaptivePlan.cites!.map((c, i) => (
                              <div key={i} className="text-xs text-tertiary flex gap-xs">
                                <span className="shrink-0">{c.at?.slice(0, 10)}</span>
                                <span className="flex-1 min-w-0 break-words">{c.sentence}</span>
                                {c.blobId ? (
                                  <a href={`https://walruscan.com/mainnet/blob/${c.blobId}`} target="_blank" rel="noreferrer" className="shrink-0 inline-flex items-center gap-xxs text-utility-brand-700 hover:underline">Walrus <ExternalLink className="w-3 h-3" /></a>
                                ) : (
                                  <span className="shrink-0 text-utility-warning-600">writing…</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Promise to pay: holds the plan until the date; kept/broken is learned per client */}
                    {invoiceDetail.invoice.status !== 'paid' && (
                      <div className="rounded-xl border border-secondary p-xl space-y-xs">
                        <p className="text-sm font-semibold text-primary">Promise to pay</p>
                        <p className="text-xs text-tertiary">
                          {invoiceDetail.invoice.promise
                            ? `${invoiceDetail.invoice.clientName} promised to pay by ${invoiceDetail.invoice.promise.date}${invoiceDetail.invoice.promise.date < new Date().toISOString().slice(0, 10) ? ' and missed it: the plan follows up now, one tone firmer' : ': no reminder before then'}.`
                            : 'None recorded. Record one here, or paste the email on the client page ("we will pay next Friday").'}
                          {invoiceDetail.profile?.promiseStats && (invoiceDetail.profile.promiseStats.kept + invoiceDetail.profile.promiseStats.broken) > 0 && ` Kept ${invoiceDetail.profile.promiseStats.kept} of ${invoiceDetail.profile.promiseStats.kept + invoiceDetail.profile.promiseStats.broken} earlier promises.`}
                        </p>
                        <div className="flex flex-wrap items-center gap-sm">
                          <label className="sr-only" htmlFor="promise-date">Promised pay date</label>
                          <input id="promise-date" type="date" value={promiseInput} onChange={(e) => setPromiseInput(e.target.value)} className="rounded-md bg-primary px-sm py-xs text-sm text-primary border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring" />
                          <button
                            disabled={!promiseInput}
                            onClick={async () => {
                              let r: Response, d: ApiBody & { promise: { date: string } };
                              try {
                                r = await fetch(`/api/chaser/invoices/${encodeURIComponent(invoiceDetail.invoice.id)}/promise`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: promiseInput }) });
                                d = await r.json();
                              } catch { return showToast('Network error: promise not saved', 'error'); }
                              if (!r.ok) return showToast(d.error || 'Could not record the promise', 'error');
                              showToast(`Promise to pay by ${d.promise.date} saved to Walrus Memory`);
                              setPromiseInput('');
                              fetchInvoiceDetail(invoiceDetail.invoice.id);
                            }}
                            className="rounded-lg border border-primary bg-primary px-lg py-xs text-sm font-semibold text-secondary shadow-xs hover:bg-primary_hover focus-visible:ring-2 focus-visible:ring-focus-ring disabled:text-disabled"
                          >Record promise</button>
                        </div>
                      </div>
                    )}

                    {/* Payment terms learned from memory: early-payment discount or late fee */}
                    {invoiceDetail.incentive && invoiceDetail.invoice.status !== 'paid' && (
                      <div className="rounded-xl border border-secondary p-xl space-y-xs">
                        <p className="text-sm font-semibold text-primary">Payment terms (learned from memory)</p>
                        {invoiceDetail.invoice.terms && (
                          <p className="text-xs text-secondary">
                            {invoiceDetail.invoice.terms.kind === 'early_discount'
                              ? `${invoiceDetail.invoice.terms.pct}% early-payment discount until ${invoiceDetail.invoice.terms.until}${invoiceDetail.invoice.terms.expired ? ' (expired: full amount owed again)' : ''}`
                              : `${invoiceDetail.invoice.terms.pct}% late fee applied`}
                            {' '}· was {invoiceDetail.invoice.terms.original} USDC
                          </p>
                        )}
                        <p className="text-xs text-tertiary">{invoiceDetail.incentive.reason}</p>
                        {invoiceDetail.incentive.kind && (
                          <button
                            onClick={() => handleApplyTerms(invoiceDetail.incentive!.kind!)}
                            className="inline-flex items-center gap-xs rounded-lg border border-primary bg-primary px-lg py-sm text-sm font-semibold text-secondary shadow-xs hover:bg-primary_hover focus-visible:ring-2 focus-visible:ring-focus-ring"
                          >
                            {invoiceDetail.incentive.kind === 'early_discount'
                              ? `Offer ${invoiceDetail.incentive.pct}% off if paid by ${invoiceDetail.incentive.until} (≈ ${invoiceDetail.incentive.newBase} USDC)`
                              : `Add ${invoiceDetail.incentive.pct}% late fee (≈ ${invoiceDetail.incentive.newBase} USDC)`}
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'pay' && (
          <div className="max-w-2xl mx-auto space-y-xl">
            {/* owner only: this tab previews what one client sees at their own link */}
            {!PAY_ONLY && (() => {
              const clientLink = `${window.location.origin}/?pay=${encodeURIComponent(selectedInvoiceId)}`;
              return (
                <div className="rounded-xl border border-utility-warning-200 bg-utility-warning-50 p-lg space-y-sm text-utility-warning-700">
                  <p className="text-sm font-semibold">Preview: this is what your client sees</p>
                  <p className="text-xs">You don't pay here. Each invoice has its own link, and a client who opens it sees only that invoice (its amount, due date and payment options), not your dashboard.</p>
                  <div className="flex flex-wrap items-center gap-sm">
                    <label htmlFor="pay-preview-select" className="text-xs font-medium">Invoice:</label>
                    <select
                      id="pay-preview-select"
                      value={selectedInvoiceId}
                      onChange={(e) => { setSelectedInvoiceId(e.target.value); goTab('pay', e.target.value); }}
                      className="max-w-full truncate rounded-md bg-primary px-md py-xs text-sm text-primary border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                      {[...allInvoices].sort((a, b) => Number(b.baseAmount >= 1) - Number(a.baseAmount >= 1) || Number(a.status === 'paid') - Number(b.status === 'paid') || String(b.id).localeCompare(String(a.id))).map((inv) => (
                        <option key={inv.id} value={inv.id}>#{inv.id} · {inv.clientName} · {inv.payAmount} USDC · {inv.status}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-wrap items-center gap-sm">
                    <code className="min-w-0 flex-1 truncate rounded-md border border-utility-warning-200 bg-primary px-md py-xs text-xs text-secondary">{clientLink}</code>
                    <button
                      onClick={() => { navigator.clipboard?.writeText(clientLink); showToast('Client link copied: send it to your client'); }}
                      className="inline-flex items-center gap-xs rounded-lg border border-primary bg-primary px-md py-xs text-sm font-semibold text-secondary hover:bg-primary_hover focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                      <Copy className="w-3.5 h-3.5" /> Copy link for client
                    </button>
                    <a href={clientLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-xs rounded-lg border border-primary bg-primary px-md py-xs text-sm font-semibold text-secondary hover:bg-primary_hover focus-visible:ring-2 focus-visible:ring-focus-ring">
                      <ExternalLink className="w-3.5 h-3.5" /> Open as client
                    </a>
                  </div>
                </div>
              );
            })()}
            <div className="text-center space-y-xs">
              <span className="inline-flex items-center gap-xs rounded-full border border-utility-brand-200 bg-utility-brand-50 px-md py-xxs text-xs font-medium text-utility-brand-700">
                Public Payment Gateway
              </span>
              <h1 className="text-heading-lg font-bold text-primary break-all">
                {PAY_ONLY === '-' ? 'No invoice in this link' : `Pay Invoice #${selectedInvoiceId}`}
              </h1>
              <p className="text-xs text-secondary">{invoiceDetail ? `${invoiceDetail.invoice.clientName} · due ${invoiceDetail.invoice.dueDate} · ` : ''}Pay in USDC on {netLabel}</p>
              {invoiceDetail?.invoice.terms && !invoiceDetail.invoice.terms.expired && invoiceDetail.invoice.status !== 'paid' && (
                <p className="text-xs font-medium text-utility-brand-700">
                  {invoiceDetail.invoice.terms.kind === 'early_discount'
                    ? `Includes a ${invoiceDetail.invoice.terms.pct}% early-payment discount if paid by ${invoiceDetail.invoice.terms.until} (full amount afterwards: ${invoiceDetail.invoice.terms.original} USDC)`
                    : `Includes a ${invoiceDetail.invoice.terms.pct}% late fee (original amount ${invoiceDetail.invoice.terms.original} USDC)`}
                </p>
              )}
              {invoiceDetail?.invoice.status === 'paid' && (
                <p className="inline-flex items-center gap-xs rounded-full border border-utility-success-200 bg-utility-success-50 px-md py-xxs text-sm font-semibold text-utility-success-700">
                  <Check className="w-4 h-4" /> Paid{invoiceDetail.invoice.paidOn ? ` on ${invoiceDetail.invoice.paidOn}` : ''} · thank you{invoiceDetail.invoice.explorerTx && <a className="underline ml-xs" href={invoiceDetail.invoice.explorerTx} target="_blank" rel="noreferrer">transaction</a>}{invoiceDetail.invoice.receipt && <a className="underline ml-xs" href={invoiceDetail.invoice.receipt.url} target="_blank" rel="noreferrer">PDF receipt (Walrus)</a>}
                </p>
              )}
            </div>

            {detailError && (
              <div role="alert" className="rounded-xl border border-utility-error-200 bg-utility-error-50 p-lg text-center text-sm font-medium text-utility-error-700 space-y-sm">
                <p>{detailError}</p>
                {!/does not exist/.test(detailError) && <button onClick={() => fetchInvoiceDetail(selectedInvoiceId)} className="rounded-lg border border-utility-error-300 bg-primary px-lg py-xs text-sm font-semibold text-utility-error-700 focus-visible:ring-2 focus-visible:ring-focus-ring">Retry</button>}
              </div>
            )}
            {invoiceDetail?.invoice.id === selectedInvoiceId && (
            <section className="rounded-xl border border-secondary bg-primary p-2xl shadow-xs space-y-xl">
              {/* Amount Display */}
              <div className="text-center p-xl bg-secondary rounded-xl border border-secondary">
                <span className="text-xs text-tertiary font-medium">{invoiceDetail?.invoice.status === 'partial' ? `Remaining after a partial payment (invoice total ${invoiceDetail.invoice.originalAmount} USDC)` : invoiceDetail?.invoice.status === 'paid' ? 'Amount paid' : 'Payable Amount (Unique Micro-Suffix)'}</span>
                <div className="mt-xs text-heading-md sm:text-heading-xl font-semibold text-primary break-all tabular-nums">
                  {invoiceDetail?.invoice.payAmount ?? '—'}{' '}
                  <span className="text-sm font-normal text-secondary">USDC</span>
                </div>
                <p className="text-xs text-tertiary mt-xs">
                  Payments go through the Sui Payment Kit registry with this invoice as the nonce, so the chain itself refuses a second payment. Verified through Tatum, remembered in Walrus Memory.
                </p>
                {qr && invoiceDetail?.invoice.status !== 'paid' && (
                  <div className="mt-md flex flex-col items-center gap-xs">
                    <img src={qr} alt="Scan to pay with a Sui wallet" className="w-44 h-44" />
                    <a href={invoiceDetail?.invoice.paymentUri} className="inline-block py-sm px-xs text-xs font-semibold text-utility-brand-700 hover:underline">Open in Sui wallet (sui:pay)</a>
                    {invoiceDetail?.invoice.slushPayUrl && <a href={invoiceDetail.invoice.slushPayUrl} target="_blank" rel="noopener noreferrer" className="inline-block py-sm px-xs text-xs font-semibold text-utility-brand-700 hover:underline">Pay in Slush (phone or web)</a>}
                  </div>
                )}
                {invoiceDetail && (
                  <a href={`${import.meta.env.VITE_API_BASE || ''}/api/chaser/pay/${encodeURIComponent(invoiceDetail.invoice.id)}/invoice.pdf`} target="_blank" rel="noreferrer" className="mt-sm inline-flex items-center gap-xxs text-xs font-semibold text-utility-brand-700 hover:underline">
                    Download invoice (PDF) <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {invoiceDetail?.invoice.eInvoice && (
                  <a href={`${import.meta.env.VITE_API_BASE || ''}/api/chaser/pay/${encodeURIComponent(invoiceDetail.invoice.id)}/invoice.xml`} className="mt-sm ml-md inline-flex items-center gap-xxs text-xs font-semibold text-utility-brand-700 hover:underline">E-invoice XML (Factur-X)</a>
                )}
                {live.state !== 'off' && (
                  <p className="mt-sm flex items-center justify-center gap-xs text-xs text-tertiary">
                    <span className={`w-2 h-2 rounded-full ${live.state === 'paid' ? 'bg-utility-success-600' : live.state === 'reconnecting' ? 'bg-utility-warning-600' : live.state.startsWith('paused') ? 'bg-tertiary' : 'bg-brand-solid animate-pulse'}`} />
                    {live.state !== 'watching' && live.state !== 'connecting' ? <span role="status" aria-live="polite" className="sr-only">{live.state === 'paid' ? 'Payment seen live, verified' : live.state === 'verifying' ? 'Payment seen on-chain, verifying' : 'Live stream ' + live.state.replace('-', ' ')}</span> : null}
                    {live.state === 'paid' ? `Payment seen live at checkpoint ${live.checkpoint ?? ''}` : live.state === 'verifying' ? 'Payment seen on-chain, verifying…' : live.state === 'reconnecting' ? 'Reconnecting to the live Sui stream…' : live.state === 'paused-replaced' ? 'Live view moved to another tab with this invoice' : live.state === 'paused-refused' ? 'The server refused the live stream right now; payments are still checked every minute' : live.state === 'paused' || live.state === 'paused-hidden' ? 'Live stream paused to save gateway credits' : <><span role="status" aria-live="polite">{`Watching ${netLabel} live via ${live.via || 'Tatum gRPC'}`}</span>{live.checkpoint && <span aria-hidden="true">{` · checkpoint ${live.checkpoint}`}</span>}</>}
                    {['paused', 'paused-replaced', 'paused-refused'].includes(live.state) && <button onClick={() => setLiveEpoch((n) => n + 1)} className="ml-xs font-semibold text-utility-brand-700 hover:underline">Resume</button>}
                  </p>
                )}
              </div>

              {/* Recipient Address */}
              <div className="flex flex-col gap-sm">
                <label className="text-sm font-medium text-secondary">Payee Sui Address</label>
                <div className="flex items-center justify-between rounded-md bg-primary px-lg py-sm border border-primary font-mono text-xs text-primary">
                  <span className="truncate">{invoiceDetail?.invoice.payeeAddress ?? '—'}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(invoiceDetail?.invoice.payeeAddress || '');
                      showToast('Address copied to clipboard');
                    }}
                    aria-label="Copy payee address" title="Copy payee address"
                    className="inline-flex size-7 shrink-0 items-center justify-center text-secondary hover:text-primary rounded focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
                {invoiceDetail?.invoice.payee && (
                  <p className="text-xs text-tertiary">
                    {invoiceDetail.invoice.payee.name ? <>SuiNS: <span className="font-semibold text-secondary">{invoiceDetail.invoice.payee.name}</span> · </> : null}
                    {invoiceDetail.invoice.payee.recordedPayments
                      ? `${invoiceDetail.invoice.payee.recordedPayments} earlier on-chain payments to this exact address are on record in Walrus Memory${invoiceDetail.invoice.payee.since ? ` (since ${invoiceDetail.invoice.payee.since.slice(0, 10)})` : ''}. Check the address matches before paying.`
                      : 'No earlier payments to this address on record. Check it with the sender before paying.'}
                  </p>
                )}
              </div>

              {/* paid: a receipt, not payment instructions */}
              {invoiceDetail?.invoice.status !== 'paid' && (<>
              {/* One-click: connect a Sui wallet and pay */}
              <div className="space-y-sm border-t border-secondary pt-lg">
                <button
                  onClick={() => handleWalletPay()}
                  disabled={!invoiceDetail || invoiceDetail.invoice.status === 'paid' || !!walletBusy}
                  className="w-full inline-flex items-center justify-center gap-sm rounded-lg border border-transparent px-lg py-md text-sm font-semibold shadow-xs focus-visible:ring-2 focus-visible:ring-focus-ring bg-brand-solid text-primary-on-brand hover:bg-brand-solid-hover disabled:bg-disabled-subtle disabled:text-disabled"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{walletBusy ?? (invoiceDetail?.invoice.status === 'paid' ? 'Invoice already paid' : `Connect Sui wallet & pay ${invoiceDetail?.invoice.payAmount ?? ''} USDC`)}</span>
                </button>
                <button
                  onClick={() => handleWalletPay(true)}
                  disabled={!invoiceDetail || invoiceDetail.invoice.status === 'paid' || !!walletBusy || invoiceDetail.invoice.network !== 'mainnet'}
                  className="w-full inline-flex items-center justify-center gap-sm rounded-lg border border-primary px-lg py-md text-sm font-semibold shadow-xs focus-visible:ring-2 focus-visible:ring-focus-ring bg-primary text-secondary hover:bg-primary_hover disabled:text-disabled"
                >
                  <span>Only have SUI? Swap &amp; pay in one transaction</span>
                </button>
                {PAY_ONLY && (
                  <button
                    onClick={handleProvePayer}
                    disabled={!invoiceDetail || invoiceDetail.invoice.status === 'paid' || !!walletBusy}
                    className="w-full inline-flex items-center justify-center gap-sm rounded-lg border border-secondary px-lg py-sm text-xs font-semibold text-secondary focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
                  >
                    Paying later? Prove the wallet you will pay from (sign a message, no fee)
                  </button>
                )}
                {payerProof && (
                  <p role="status" className="text-xs text-utility-success-700 text-center break-all">
                    Proven: {payerProof.address.slice(0, 10)}…{payerProof.address.slice(-6)} ({payerProof.verifiedBy})
                    {payerProof.wallet ? ` · holds ${payerProof.wallet.usdc} USDC on Sui, ${payerProof.wallet.covers ? 'enough' : 'not yet enough'} for ${payerProof.wallet.owed}` : ''}
                  </p>
                )}
                <p className="text-xs text-tertiary text-center">Slush, Suiet, Phantom: any Sui wallet. The transaction is built through Tatum and verified on {netLabel}. USDC alone is enough: if your USDC sits in your Sui address balance the transfer is natively gasless (no fee for anyone); otherwise the app sponsors the network fee for a Payment Kit payment, and if the sponsor runs dry your wallet pays the gas.</p>
              </div>

              {/* Pay from any Sui wallet */}
              <div className="space-y-sm border-t border-secondary pt-lg">
                <span className="text-sm font-semibold text-primary block">Or pay manually · Step 1: send exactly this amount</span>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(invoiceDetail?.invoice.payAmount || '');
                    showToast('Exact amount copied');
                  }}
                  disabled={!invoiceDetail || invoiceDetail.invoice.status === 'paid'}
                  className="w-full inline-flex items-center justify-center gap-sm rounded-lg border border-transparent px-lg py-md text-sm font-semibold shadow-xs focus-visible:ring-2 focus-visible:ring-focus-ring bg-brand-solid text-primary-on-brand hover:bg-brand-solid-hover disabled:bg-disabled-subtle disabled:text-disabled"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>{invoiceDetail?.invoice.status === 'paid' ? 'Invoice already paid' : `Copy amount: ${invoiceDetail?.invoice.payAmount ?? ''} USDC`}</span>
                </button>
                <p className="text-xs text-tertiary text-center">
                  Send USDC on {netLabel} to the address above (Slush, Suiet, Phantom, or an exchange withdrawal). The unique decimals identify this invoice.
                </p>
              </div>

              {/* Or paste transaction digest */}
              <div className="space-y-sm border-t border-secondary pt-lg">
                <label htmlFor="digest-input" className="text-sm font-semibold text-primary block">Step 2: Paste the transaction digest</label>
                <div className="flex flex-col gap-sm">
                  <input
                    id="digest-input"
                    type="text"
                    value={digestInput}
                    onChange={(e) => setDigestInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !isVerifying) handleVerifyDigest(); }}
                    placeholder="Paste the transaction digest or its explorer link"
                    className="rounded-md bg-primary px-lg py-sm text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
                  />
                  <button
                    onClick={handleVerifyDigest}
                    disabled={isVerifying || invoiceDetail?.invoice.status === 'paid'}
                    className={`inline-flex items-center justify-center gap-sm rounded-lg px-lg py-sm text-sm font-semibold border border-primary shadow-xs focus-visible:ring-2 focus-visible:ring-focus-ring ${
                      invoiceDetail?.invoice.status === 'paid'
                        ? 'bg-disabled-subtle text-disabled cursor-not-allowed'
                        : 'bg-primary text-secondary hover:bg-primary-hover'
                    }`}
                  >
                    {isVerifying ? 'Verifying with Tatum gRPC...' : 'Verify & Settle Payment'}
                  </button>
                </div>
              </div>
              </>)}
            </section>
            )}
          </div>
        )}

        {activeTab === 'proof' && (
          <div className="space-y-xl">
            <div>
              <h1 className="text-heading-lg font-semibold text-primary">/proof — System & Provider Health</h1>
              <p className="text-secondary text-sm mt-xs">
                Live verification of Tatum Sui gRPC gateway, StateService balances, and Walrus Memory relayer.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-xl">
              {/* Tatum Sui gRPC Card */}
              <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs space-y-md">
                <div className="flex items-center justify-between border-b border-secondary pb-sm">
                  <div className="flex items-center gap-xs">
                    <ShieldCheck className="w-5 h-5 text-fg-success-primary" />
                    <span className="font-semibold text-sm text-primary">Tatum Sui gRPC Gateway</span>
                  </div>
                  <StatusBadge state={!proofData ? (proofError ? 'error' : 'loading') : proofData.tatumSuiGrpc.gatewayStatus === 'connected' ? 'ok' : ['quota_fallback', 'no_api_key'].includes(proofData.tatumSuiGrpc.gatewayStatus) ? 'warn' : 'error'} ok="Connected (TLS)" warn={proofData?.tatumSuiGrpc.gatewayStatus === 'no_api_key' ? 'No Tatum key · public fullnode' : 'Credits exhausted · public fullnode fallback'} error="Unreachable" />
                </div>

                <div className="space-y-xs text-xs">
                  <div className="flex justify-between py-xxs">
                    <span className="text-secondary">Host:</span>
                    <code className="text-primary font-mono text-xs">{proofData?.tatumSuiGrpc.endpoint || 'sui-mainnet-grpc.gateway.tatum.io:443'}</code>
                  </div>
                  <div className="flex justify-between py-xxs">
                    <span className="text-secondary">Latest Checkpoint:</span>
                    <code className="text-primary font-mono text-xs">#{proofData?.tatumSuiGrpc.latestCheckpoint ?? 'loading…'}</code>
                  </div>
                  <div className="flex justify-between py-xxs">
                    <span className="text-secondary">SUI / USDC in USD (Tatum Data API):</span>
                    <span className="font-semibold text-primary">
                      {proofData?.tatumSuiGrpc.rates?.SUI ? `$${proofData.tatumSuiGrpc.rates.SUI.usd.toFixed(4)} / $${proofData.tatumSuiGrpc.rates.USDC?.usd.toFixed(4)}` : 'loading…'}
                    </span>
                  </div>
                  <div className="flex justify-between py-xxs">
                    <span className="text-secondary">Payee USDC Balance:</span>
                    <span className="font-semibold text-primary">{proofData?.tatumSuiGrpc.payeeBalance ?? 'loading…'}</span>
                  </div>
                  <div className="flex justify-between py-xxs">
                    <span className="text-secondary">USDC Coin Type:</span>
                    <code className="text-primary font-mono text-xs truncate max-w-[200px]">
                      {proofData?.tatumSuiGrpc.usdcCoinType ?? 'loading…'}
                    </code>
                  </div>
                </div>

                <div className="p-sm bg-secondary rounded-lg border border-secondary">
                  <span className="text-xs text-tertiary block mb-xxs font-medium">LedgerService & StateService API</span>
                  <code className="text-xs text-secondary font-mono">
                    LedgerService.GetTransaction(digest) + StateService.GetBalance(payee)
                  </code>
                </div>
              </section>

              {/* Walrus Memory Card */}
              <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs space-y-md">
                <div className="flex items-center justify-between border-b border-secondary pb-sm">
                  <div className="flex items-center gap-xs">
                    <Brain className="w-5 h-5 text-fg-brand-primary" />
                    <span className="font-semibold text-sm text-primary">Walrus Memory Relayer</span>
                  </div>
                  <StatusBadge state={!proofData ? (proofError ? 'error' : 'loading') : proofData.walrusMemory.relayerStatus === 'ok' ? 'ok' : 'error'} ok="Relayer Active" error={`Relayer ${proofData?.walrusMemory.relayerStatus || 'error'}`} />
                </div>

                <div className="space-y-xs text-xs">
                  <div className="flex justify-between py-xxs">
                    <span className="text-secondary">Relayer URL:</span>
                    <code className="text-primary font-mono text-xs">{proofData?.walrusMemory.relayerUrl || 'https://relayer.memory.walrus.xyz'}</code>
                  </div>
                  <div className="flex justify-between py-xxs">
                    <span className="text-secondary">Memory SDK:</span>
                    <code className="text-primary font-mono text-xs">{proofData?.walrusMemory.sdk || '@mysten-incubation/memwal'}</code>
                  </div>
                  <div className="flex justify-between py-xxs">
                    <span className="text-secondary">Namespaces Indexed:</span>
                    <span className="font-semibold text-primary">
                      {proofData ? `${proofData.walrusMemory.namespaceCount} client namespaces` : 'loading…'}
                    </span>
                  </div>
                  <div className="flex justify-between py-xxs">
                    <span className="text-secondary">Pending Queue:</span>
                    <span className={proofData?.walrusMemory.pendingMemoriesCount ? 'text-utility-warning-700 font-medium' : 'text-utility-success-700 font-medium'}>{proofData ? `${proofData.walrusMemory.pendingMemoriesCount} writes pending` : 'loading…'}</span>
                  </div>
                </div>

                {proofData?.walrusMemory.durability && (() => {
                  const d = proofData.walrusMemory.durability;
                  const spot = d.spotCheck || [];
                  return (
                    <div className={`p-sm rounded-lg border text-xs space-y-xxs ${d.ok ? 'border-utility-success-200 bg-utility-success-50 text-utility-success-700' : 'border-utility-error-200 bg-utility-error-50 text-utility-error-700'}`}>
                      <span className="block font-semibold">Durability audit {d.ok ? '· everything remembered is still held' : '· needs attention'}</span>
                      {d.error ? <p>{d.error}</p> : (
                        <>
                          <p>Relayer inventory (listMemories): {d.active}/{d.inventory} active · {d.loadedLocally} loaded into state · {d.missingFromInventory?.length || 0} missing</p>
                          <p>Fetched straight from a Walrus aggregator: {spot.filter((x) => x.onWalrus).length}/{spot.length} newest blobs present</p>
                          {d.earliestExpiry && <p>Earliest storage expiry: {d.earliestExpiry.slice(0, 10)} ({d.daysToEarliestExpiry} days){d.endEpochRange ? ` · Walrus end epochs ${d.endEpochRange[0]}–${d.endEpochRange[1]}` : ''}</p>}
                        </>
                      )}
                    </div>
                  );
                })()}

                {/* Memory <-> chain audit: every payment memory re-checked on Sui through Tatum */}
                {(() => {
                  const a = proofData?.walrusMemory.chainAudit;
                  if (!a) return null;
                  const ok = !a.error && a.mismatched === 0;
                  return (
                    <div className={`p-sm rounded-lg border text-xs space-y-xxs ${ok ? 'border-utility-success-200 bg-utility-success-50 text-utility-success-700' : 'border-utility-error-200 bg-utility-error-50 text-utility-error-700'}`}>
                      <span className="block font-semibold">Memory audited against Sui {ok ? '· every payment memory matches the chain' : '· needs attention'}</span>
                      {a.stale && <p>Showing the audit from {a.stale.since.slice(0, 16).replace('T', ' ')} UTC ({a.stale.reason}).</p>}
                      {a.error ? <p>{a.error}</p> : (
                        <>
                          <p>{a.verified}/{a.withTransaction} payment memories re-checked on-chain (digest, USDC amount, checkpoint) in {a.gatewayCalls} Tatum {a.service?.split(' ')[0]} call{a.gatewayCalls === 1 ? '' : 's'}{a.mismatched ? ` · ${a.mismatched} mismatch(es): see /api/chaser/audit` : ''}</p>
                          <p>{a.demoHistoryWithoutTransaction} seeded history memories carry no transaction (labelled demo data)</p>
                          {a.chainToMemory && !a.chainToMemory.error && (
                            <p>Other way round: {a.chainToMemory.recordedInMemory}/{a.chainToMemory.incomingTransfers} USDC transfers to the payee in the last {a.chainToMemory.windowDays} days are recorded in memory{a.chainToMemory.unrecorded ? ` · ${a.chainToMemory.unrecorded} not yet recorded` : ''} (Tatum ListTransactions, {a.chainToMemory.scannedTransactions} transactions scanned)</p>
                          )}
                        </>
                      )}
                    </div>
                  );
                })()}

                <div className="p-sm bg-secondary rounded-lg border border-secondary">
                  <span className="text-xs text-tertiary block mb-xxs font-medium">Sample Memories Across Namespaces</span>
                  <div className="space-y-xxs text-xs font-mono text-secondary">
                    {proofData?.walrusMemory.sampleMemories.map((sm, idx) => (
                      <div key={idx}>
                        • {sm.namespace} → {sm.count} memories ("{sm.latest.slice(0, 50)}...")
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}
      </main>

      {/* Toast Recipe: floating confirmation stacked in screen corner */}
      {/* always mounted, so screen readers announce each message; errors are assertive and never green */}
      <section aria-label="Notifications" role={toastTone === 'error' ? 'alert' : 'status'} aria-live={toastTone === 'error' ? 'assertive' : 'polite'} className="fixed bottom-xl right-xl z-50">
        {toastMessage && (
          <div className={`flex items-start gap-sm rounded-lg border bg-primary p-lg shadow-lg ${toastTone === 'error' ? 'border-utility-error-200' : 'border-secondary'}`}>
            {toastTone === 'error'
              ? <AlertCircle className="mt-xxs size-4 shrink-0 text-utility-error-600" aria-hidden="true" />
              : <Check className="mt-xxs size-4 shrink-0 text-fg-success-primary" aria-hidden="true" />}
            <p className={`text-sm ${toastTone === 'error' ? 'text-utility-error-700' : 'text-secondary'}`}>{toastMessage}</p>
          </div>
        )}
      </section>
    </div>
  );
}

// Status pill driven by the live /proof response: never green unless the check actually passed.
function StatusBadge({ state, ok, warn, error }: { state: 'loading' | 'ok' | 'warn' | 'error'; ok: string; warn?: string; error: string }) {
  const cls = { ok: 'border-utility-success-200 bg-utility-success-50 text-utility-success-700', warn: 'border-utility-warning-200 bg-utility-warning-50 text-utility-warning-700', error: 'border-utility-error-200 bg-utility-error-50 text-utility-error-700', loading: 'border-secondary bg-secondary text-secondary' }[state];
  return <span role="status" className={`inline-flex items-center gap-xs rounded-full border px-md py-xxs text-xs font-medium ${cls}`}>{state === 'loading' ? 'Checking…' : state === 'ok' ? ok : state === 'warn' ? warn : error}</span>;
}
