// S1 — dashboard read mix (scalability audit §4), production-safe variant: READS ONLY.
// Weighted like a real session: wallets 40% / transactions 40% / profile 10% / price snapshot 10%.
// Run (smoke): SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... QA_JWT=... QA_USER_ID=... \
//   k6 run --vus 5 --duration 90s tests/load/s1-dashboard-read-mix.js
// Full staging variant (audit plan): ramp 10→200 VU over 10 min, hold 10 min — staging only.
// Safety: no writes, no money movement, QA user only. Abort thresholds: error rate >2% or p95 >2s.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.SUPABASE_URL;
const KEY = __ENV.SUPABASE_PUBLISHABLE_KEY;
const JWT = __ENV.QA_JWT;
const UID = __ENV.QA_USER_ID;

if (!BASE || !KEY || !JWT || !UID) {
  throw new Error('S1 requires SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, QA_JWT, QA_USER_ID');
}

export const options = {
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<2000'],
  },
};

function headers() {
  return {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${JWT}`,
      Accept: 'application/json',
    },
  };
}

export default function () {
  const r = Math.random();
  let url;
  let name;
  if (r < 0.4) {
    url = `${BASE}/rest/v1/wallets?user_id=eq.${UID}&select=*`;
    name = 'wallets';
  } else if (r < 0.8) {
    url = `${BASE}/rest/v1/transactions?user_id=eq.${UID}&order=created_at.desc&limit=50`;
    name = 'transactions';
  } else if (r < 0.9) {
    url = `${BASE}/rest/v1/profiles?id=eq.${UID}&select=*`;
    name = 'profiles';
  } else {
    url = `${BASE}/rest/v1/p2p_price_snapshots?order=created_at.desc&limit=1`;
    name = 'price_snapshot';
  }
  const res = http.get(url, headers());
  check(res, { [`${name} status 200`]: (x) => x.status === 200 });
  sleep(1);
}
