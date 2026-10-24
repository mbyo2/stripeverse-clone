// posStatement: designed print documents for the Bitcoin POS data
// bridge — a merchant statement (date range) and a single-request
// receipt — rendered as standalone HTML and printed via the house
// pattern (TransactionReceipt: open a window, write the document,
// print; the browser's "Save as PDF" produces the file).
//
// These documents are PAPER artefacts: always a light background and
// dark text, whatever theme the app is in. Brand system: PayPal
// palette (deep navy #003087, blue #0070ba), Bitcoin orange #F7931A
// accents, cream #FEF3E2 bands.
//
// summariseForStatement mirrors summarisePosRequests in
// supabase/functions/_shared/pos-core.ts (the house mirror pattern —
// cf. src/utils/paypalPayout.ts); the vitest suite pins the two to
// identical results on shared fixtures.

export interface PosStatementRow {
  created_at: string;
  merchant_reference: string;
  status: string;
  fiat_amount_zmw: number | string;
  sats_expected: number | string;
  sats_received: number | string | null;
  btc_zmw_rate: number | string;
  btc_zmw_rate_at_payment: number | string | null;
  txid: string | null;
  confirmations_at_detection: number | string | null;
  paid_at: string | null;
  deposit_address?: string;
  expires_at?: string;
}

export interface PosStatementSummary {
  requestCount: number;
  paidCount: number;
  settledCount: number;
  totalCollectedZmw: number;
  totalReceivedSats: number;
  averageRateZmw: number | null;
}

const SATS_PER_BTC = 100_000_000;

export function summariseForStatement(
  rows: Array<Pick<PosStatementRow, "status" | "sats_received" | "btc_zmw_rate" | "btc_zmw_rate_at_payment">>,
): PosStatementSummary {
  let paidCount = 0;
  let settledCount = 0;
  let collected = 0;
  let receivedSats = 0;
  for (const r of rows) {
    if (r.status === "paid") paidCount += 1;
    const settled = r.status === "paid" || r.status === "underpaid" || r.status === "overpaid";
    const received = r.sats_received == null ? 0 : Number(r.sats_received);
    if (settled && received > 0) {
      settledCount += 1;
      receivedSats += received;
      const rate = Number(r.btc_zmw_rate_at_payment ?? r.btc_zmw_rate);
      if (Number.isFinite(rate) && rate > 0) {
        collected += (received * rate) / SATS_PER_BTC;
      }
    }
  }
  const totalCollectedZmw = Math.round(collected * 100) / 100;
  return {
    requestCount: rows.length,
    paidCount,
    settledCount,
    totalCollectedZmw,
    totalReceivedSats: receivedSats,
    averageRateZmw:
      receivedSats > 0
        ? Math.round((totalCollectedZmw / (receivedSats / SATS_PER_BTC)) * 100) / 100
        : null,
  };
}

// ── Formatting (Intl only — no app dependencies, so this module also
// renders in a plain node harness for visual checks) ────────────────

const dtf = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
const df = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", year: "numeric",
});
const nf2 = new Intl.NumberFormat("en-ZM", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat("en-ZM", { maximumFractionDigits: 0 });

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dtf.format(d);
}
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : df.format(d);
}
export function fmtZmw(v: number | string): string {
  const n = Number(v);
  return Number.isFinite(n) ? `K${nf2.format(n)}` : "—";
}
export function fmtSats(v: number | string | null | undefined): string {
  if (v == null) return "—";
  const n = Number(v);
  return Number.isFinite(n) ? nf0.format(n) : "—";
}
export function satsToBtcString(sats: number): string {
  if (!Number.isInteger(sats) || sats < 0) return "—";
  const whole = Math.floor(sats / SATS_PER_BTC);
  const frac = sats % SATS_PER_BTC;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(8, "0").replace(/0+$/, "")}`;
}
export function shortenTxid(txid: string | null | undefined, head = 10, tail = 8): string {
  if (!txid) return "—";
  if (txid.length <= head + tail + 1) return txid;
  return `${txid.slice(0, head)}…${txid.slice(-tail)}`;
}
export function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Shared document shell ────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  paid: "#0e7a3d",
  underpaid: "#b45309",
  overpaid: "#0369a1",
  awaiting_payment: "#92400e",
  expired: "#64748b",
  cancelled: "#64748b",
};
const statusLabel = (s: string) => s.replace(/_/g, " ");

const SHARED_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #16232e; background: #ffffff; font-size: 12px; line-height: 1.45;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  @page {
    size: A4 portrait; margin: 15mm 14mm 17mm 14mm;
    @bottom-left {
      content: "On-chain Bitcoin payments · settled after 1 network confirmation · exported from BMaGlass Pay for reconciliation";
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 8px; color: #71808e;
    }
    @bottom-center {
      content: "bmaglasspay.online";
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 8.5px; color: #71808e;
    }
    @bottom-right {
      content: "Page " counter(page) " of " counter(pages);
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 8.5px; color: #71808e;
    }
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand-mark {
    width: 34px; height: 34px; border-radius: 8px; background: #F7931A;
    color: #ffffff; font-size: 20px; font-weight: 800;
    display: flex; align-items: center; justify-content: center;
  }
  .brand-name { font-size: 19px; font-weight: 800; color: #003087; letter-spacing: -0.2px; }
  .brand-sub { font-size: 9.5px; color: #71808e; text-transform: uppercase; letter-spacing: 1.4px; white-space: nowrap; }
`;

function brandHeader(docTitle: string, periodLine: string, generatedAt: Date): string {
  return `
  <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom: 3px solid #003087; padding-bottom: 14px;">
    <div class="brand">
      <div class="brand-mark">B</div>
      <div>
        <div class="brand-name">BMaGlass Pay</div>
        <div class="brand-sub">Bitcoin POS · Data Bridge</div>
      </div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:16px; font-weight:700; color:#16232e;">${htmlEscape(docTitle)}</div>
      <div style="font-size:11px; color:#5b6b7a;">${htmlEscape(periodLine)}</div>
      <div style="font-size:11px; color:#5b6b7a;">Generated ${htmlEscape(dtf.format(generatedAt))}</div>
    </div>
  </div>`;
}

function shell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${htmlEscape(title)}</title>
<style>${SHARED_CSS}</style></head>
<body>${bodyHtml}</body></html>`;
}

// ── Statement ────────────────────────────────────────────────────────

export interface PosStatementData {
  merchantName: string;
  merchantEmail: string;
  periodFrom: string; // ISO
  periodTo: string; // ISO
  generatedAt: Date;
  rows: PosStatementRow[];
}

export function buildPosStatementHtml(data: PosStatementData): string {
  const s = summariseForStatement(data.rows);
  const period = `${fmtDate(data.periodFrom)} — ${fmtDate(data.periodTo)}`;

  const stat = (label: string, value: string, sub = "") => `
    <div style="flex:1; min-width:0;">
      <div style="font-size:9.5px; text-transform:uppercase; letter-spacing:1.2px; color:#8a6d3b;">${label}</div>
      <div style="font-size:17px; font-weight:800; color:#16232e; margin-top:2px; white-space:nowrap;">${value}</div>
      ${sub ? `<div style="font-size:10px; color:#5b6b7a;">${sub}</div>` : ""}
    </div>`;

  const summaryBand = `
  <div style="background:#FEF3E2; border:1px solid #f3ddba; border-radius:10px; padding:14px 18px; margin:18px 0 6px; display:flex; gap:18px;">
    ${stat("Requests", nf0.format(s.requestCount))}
    ${stat("Paid in full", nf0.format(s.paidCount), `${nf0.format(s.settledCount)} settled`)}
    ${stat("Collected", fmtZmw(s.totalCollectedZmw))}
    ${stat("Bitcoin received", `${satsToBtcString(s.totalReceivedSats)} BTC`, `${fmtSats(s.totalReceivedSats)} sats`)}
    ${stat("Average rate", s.averageRateZmw != null ? fmtZmw(s.averageRateZmw) : "—", "volume-weighted")}
  </div>`;

  const head = `
    <tr>
      <th style="text-align:left;">Date</th>
      <th style="text-align:left;">Reference</th>
      <th style="text-align:left;">Status</th>
      <th style="text-align:right;">Amount</th>
      <th style="text-align:right;">Sats expected</th>
      <th style="text-align:right;">Sats received</th>
      <th style="text-align:right;">Rate (ZMW/BTC)</th>
      <th style="text-align:left;">Transaction</th>
    </tr>`;

  const bodyRows = data.rows.map((r, i) => {
    const color = STATUS_COLORS[r.status] ?? "#16232e";
    const rate = r.btc_zmw_rate_at_payment ?? r.btc_zmw_rate;
    return `
    <tr style="background:${i % 2 ? "#f7f9fb" : "#ffffff"};">
      <td style="white-space:nowrap;">${htmlEscape(fmtDate(r.created_at))}</td>
      <td style="font-family:'Courier New', monospace; font-size:10.5px; word-break:break-all;">${htmlEscape(r.merchant_reference)}</td>
      <td style="white-space:nowrap;"><span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:${color}; margin-right:6px;"></span><span style="color:${color}; font-weight:600;">${htmlEscape(statusLabel(r.status))}</span></td>
      <td style="text-align:right; white-space:nowrap;">${htmlEscape(fmtZmw(r.fiat_amount_zmw))}</td>
      <td style="text-align:right; white-space:nowrap;">${htmlEscape(fmtSats(r.sats_expected))}</td>
      <td style="text-align:right; white-space:nowrap;">${htmlEscape(fmtSats(r.sats_received))}</td>
      <td style="text-align:right; white-space:nowrap;">${htmlEscape(fmtZmw(rate))}</td>
      <td style="font-family:'Courier New', monospace; font-size:9.5px; color:#5b6b7a; word-break:break-all;">${htmlEscape(shortenTxid(r.txid))}</td>
    </tr>`;
  }).join("");

  const table = data.rows.length === 0
    ? `<p style="color:#5b6b7a; margin:22px 0;">No payment requests were created in this period.</p>`
    : `
  <table style="width:100%; border-collapse:collapse; margin-top:12px; font-size:11px; table-layout:fixed;">
    <colgroup>
      <col style="width:10.5%"><col style="width:14.5%"><col style="width:13.5%">
      <col style="width:10.5%"><col style="width:11%"><col style="width:11%">
      <col style="width:14%"><col style="width:15%">
    </colgroup>
    <thead>${head}</thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <style>
    thead { display: table-header-group; }
    thead th {
      font-size:9.5px; text-transform:uppercase; letter-spacing:0.5px; color:#003087;
      padding:7px 6px; border-bottom:2px solid #F7931A; line-height:1.3; vertical-align:bottom;
    }
    tbody td { padding:6px; border-bottom:1px solid #e6ebef; vertical-align:top; }
    tbody tr { page-break-inside: avoid; }
  </style>`;

  const notes = `
  <div style="margin-top:20px; font-size:10px; color:#5b6b7a; line-height:1.6;">
    <strong style="color:#16232e;">How to read this statement.</strong>
    “Collected” is the kwacha value of the Bitcoin that actually arrived, valued at each
    request’s locked rate. “Paid in full” counts requests settled at exactly the expected
    amount; underpaid and overpaid requests are settled and included in the collected total,
    and are itemised above so you can follow them up by reference. Requests still awaiting
    payment, expired or cancelled carry no collected value. Transaction ids are shortened
    here — the full id for any row is in the CSV export and the POS API.
    <br>Data exported from BMaGlass Pay · bmaglasspay.online
  </div>`;

  return shell(
    `Bitcoin POS Statement — ${period}`,
    `
    ${brandHeader("Bitcoin POS Statement", period, data.generatedAt)}
    <div style="margin-top:14px; font-size:12px;">
      <span style="font-weight:700;">${htmlEscape(data.merchantName)}</span>
      <span style="color:#5b6b7a;"> · ${htmlEscape(data.merchantEmail)}</span>
    </div>
    ${summaryBand}
    ${table}
    ${notes}`,
  );
}

// ── Single-request receipt ───────────────────────────────────────────

export interface PosReceiptData {
  merchantName: string;
  merchantEmail: string;
  generatedAt: Date;
  request: PosStatementRow;
}

export function buildPosReceiptHtml(data: PosReceiptData): string {
  const r = data.request;
  const color = STATUS_COLORS[r.status] ?? "#16232e";
  const rate = r.btc_zmw_rate_at_payment ?? r.btc_zmw_rate;
  const row = (label: string, value: string, mono = false) => `
    <div style="display:flex; justify-content:space-between; gap:18px; padding:8px 0; border-bottom:1px solid #eef1f4;">
      <span style="color:#5b6b7a; font-size:11.5px;">${label}</span>
      <span style="font-weight:600; font-size:11.5px; text-align:right; ${mono ? "font-family:'Courier New', monospace; font-size:10.5px; word-break:break-all;" : ""}">${value}</span>
    </div>`;

  return shell(
    `Bitcoin POS Receipt — ${r.merchant_reference}`,
    `
    <div style="max-width:520px; margin:0 auto;">
      ${brandHeader("Payment Receipt", `Reference ${r.merchant_reference}`, data.generatedAt)}
      <div style="text-align:center; margin:26px 0 6px;">
        <div style="font-size:30px; font-weight:800; color:#16232e;">${htmlEscape(fmtZmw(r.fiat_amount_zmw))}</div>
        <div style="font-size:12.5px; color:#5b6b7a;">${satsToBtcString(Number(r.sats_expected) || 0)} BTC · ${fmtSats(r.sats_expected)} sats</div>
        <div style="margin-top:10px;">
          <span style="display:inline-block; padding:4px 12px; border-radius:999px; border:1.5px solid ${color}; color:${color}; font-weight:700; font-size:11px; text-transform:uppercase; letter-spacing:0.8px;">${htmlEscape(statusLabel(r.status))}</span>
        </div>
      </div>
      <div style="margin-top:14px;">
        ${row("Merchant", htmlEscape(data.merchantName))}
        ${row("Merchant email", htmlEscape(data.merchantEmail))}
        ${row("Your reference", htmlEscape(r.merchant_reference), true)}
        ${row("Created", htmlEscape(fmtDateTime(r.created_at)))}
        ${row("Paid at", htmlEscape(fmtDateTime(r.paid_at)))}
        ${row("Sats expected", htmlEscape(fmtSats(r.sats_expected)))}
        ${row("Sats received", htmlEscape(fmtSats(r.sats_received)))}
        ${row("Bitcoin price used", `${htmlEscape(fmtZmw(rate))} per BTC`)}
        ${row("Confirmations at detection", r.confirmations_at_detection == null ? "—" : htmlEscape(String(r.confirmations_at_detection)))}
        ${row("Deposit address", htmlEscape(r.deposit_address ?? "—"), true)}
        ${row("Transaction id", htmlEscape(r.txid ?? "—"), true)}
      </div>
      <p style="font-size:10px; color:#5b6b7a; line-height:1.6; margin-top:18px;">
        This receipt records an on-chain Bitcoin payment matched to the merchant’s reference
        above. A request is marked paid after 1 network confirmation. Keep it with the
        matching till record for reconciliation.
      </p>
    </div>`,
  );
}

// ── Print (house pattern, cf. TransactionReceipt) ────────────────────

export function openPosPrintWindow(html: string): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  win.focus();
  // Give the new document a tick to lay out before the print dialog.
  setTimeout(() => win.print(), 250);
  return true;
}
