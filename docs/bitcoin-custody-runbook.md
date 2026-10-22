# Bitcoin Custody Runbook — BMaGlass Pay

**Product:** BMaGlass Pay (bmaglasspay.online) · **Supabase project:** paymentgetway (ref `hhxwwozpvgktuqutfkhc`)
**Audience:** CEO / operator, no cryptography background assumed.
**Rule:** Procedure only. This file never contains a real seed phrase, private key, zpub value, or API key value. Always copy a secret from its secure source — never from this file, a chat, or an email.

> **WARNING:** Bitcoin transactions cannot be reversed. A mistake here can lose money permanently. Work slowly, in order, and stop if any step does not match what you see.

## 1. Overview

### The custodial model
1. BMaGlass Pay is **custodial**: the platform holds Bitcoin on behalf of users. Users never see a seed phrase; they see a balance and a deposit address.
2. The platform holds **one master seed** server-side, stored as a Supabase secret. That one seed controls every deposit address and every withdrawal.
3. Each user gets a BIP84 native SegWit deposit address (`bc1…`) derived from the account zpub at `m/84'/0'/0'/0/<index>`. `<index>` is stored per user in the database.
4. The **zpub** is watch-only: it creates deposit addresses and views balances, but cannot spend. Treat it as sensitive anyway — it reveals all addresses and balances.
5. Withdrawals are signed **server-side** from the seed. Lightning runs through **Breez**, with its own separate API key secret.

### Capability gates — what each secret unlocks

The functions gate **per capability**, not all-or-nothing, so each
feature goes live the moment its own secret is correctly installed:

| Capability | Secret(s) required | Notes |
|---|---|---|
| Deposit addresses + deposit detection/crediting | `BTC_XPUB` only | Watch-only. Funds land in the wallet the zpub came from; no spending is possible from a zpub. Works before the seed is installed. |
| Custodial Lightning (invoices + payments) | `BREEZ_API_KEY` only | Breez runs its own nodeless wallet; the on-chain seed is never involved. |
| Withdrawals + buy/sell trades | `BTC_SEED_MNEMONIC` **and** the matching `BTC_XPUB` | Interlocked: the platform refuses to spend unless the seed provably controls the same account as the installed zpub. |

While a capability's secret is missing or wrong, that capability — and
only that capability — answers with a plain-language "not available
yet" message. Nothing fails silently and nothing pretends to succeed.

### What the seed controls
**Everything.** Whoever has the master seed can move all Bitcoin in the hot wallet to any address, with no one else's approval. There is no bank, chargeback, or reset. Treat the seed like the only key to a vault holding other people's money.

### The float and the accounting invariant
- Table `btc_treasury` is a single row (`id = 1`); `float_sats` is platform-owned BTC, in satoshis, available to back user **buy** orders.
- User BTC balances live in `crypto_wallets` where `asset = 'BTC'`.
- **Invariant:** Actual BTC in the hot wallet ≈ `float_sats` + Σ all users' BTC balances in `crypto_wallets`. Every satoshi in the wallet belongs either to the platform (float) or to a user. A large unexplained gap in either direction means something is wrong.

| Action | `float_sats` | User balance |
|---|---|---|
| Buy | Decreases | Increases |
| Sell | Increases | Decreases |
| Deposit | No change | Increases at 1 confirmation |
| Withdrawal | No change | Decreases |

Deposits/withdrawals move real BTC in/out, so wallet total and user totals move together. Buys/sells only move ownership inside the system, so the float absorbs the change.

### Hot-wallet policy
1. A seed stored on a server is a **hot wallet** by definition — connected, directly or indirectly, to the internet.
2. Keep only the current float plus a few days of expected withdrawals in it. Do not let large amounts accumulate for convenience; move excess to separate cold storage as a documented decision outside this runbook.
3. Check the wallet total against the invariant at least weekly (Section 8).

### Key tables and functions
| Item | Purpose |
|---|---|
| `btc_address_assignments` | `user_id`, `derivation_index`, `address` |
| `btc_deposits` | `txid`/`vout` unique, `confirmations`, `status`: `detected` → `credited` at 1 confirmation |
| `btc_withdrawals` | `status`: `reserved` → `broadcast` → `confirmed`/`failed`, plus `idempotency_key` |
| `btc_quotes` | Buy/sell price quotes |
| `btc_treasury` | Singleton `id = 1`, `float_sats` |

Deploy to project paymentgetway: `btc-onchain`, `btc-trade`, plus updated `breez-lightning` and `btc-payment`.

Implementation note (for developers): every `btc_*` RPC is granted to
the service role only and the `btc_*` tables are service-write-only
under RLS, so the edge functions perform all money-path database work
through a dedicated service-role client that does **not** forward the
caller's JWT. Routing the same calls through the request client runs
them as the `authenticated` role and they are denied (42501) — the
exact failure the atomic-transfer function hit and documented.
Inbound Lightning settlement is exactly-once via the
`btc_settle_lightning_deposit` RPC: claim, wallet credit and ledger
row commit in a single transaction, idempotent on the payment id.

## 2. Generating the Master Seed — Offline Only

Do this once before launch, and again only for an incident (Section 9) or a planned rotation.

> **WARNING:** Never generate the seed on a phone or a normally-used laptop, and never type, photograph, or store it on a connected device. If that happens, consider it compromised and start again with a new seed.

### Recommended: hardware wallet
1. Buy a reputable hardware wallet **directly from the manufacturer**. Never second-hand or from a marketplace seller. If seals/packaging look tampered with, do not use it.
2. Set it up per the manufacturer's instructions. Generate a new wallet with **24 words**.
3. Write the words by hand, in order, on the card provided. Check spelling and order twice.
4. Set a strong device PIN only you know. Do not store the PIN with the words.

### Alternative: air-gapped computer (only if no hardware wallet)
1. Use a dedicated computer that will never go online again, or boot a trusted live OS with networking physically disabled, using only a reputable open-source wallet tool obtained and verified *before* going offline.
2. Disconnect Wi-Fi, Ethernet, and Bluetooth. Generate the 24 words on that machine only. Do not save them to a file. Power down when done.

### Backups
1. Copy 1: the handwritten paper backup. Copy 2: a **steel backup** (stamped/etched metal — paper burns, floods, and fades).
2. Store the two copies in **two separate secure locations**, ideally not the same building (e.g. a safe, and a safe-deposit box or second secure site).
3. Tell no one the locations except a named successor who needs to know in an emergency. Record *who* knows, outside this document.
4. **Never** photograph the words; type them into a connected device; or email/message/upload them to cloud storage, a notes app, or a chat — including this assistant.

### Verify the backup
1. On the offline device / hardware wallet, use its recovery-check or "show receive address" feature and note the **first receiving address** for account `m/84'/0'/0'`.
2. Run the backup verification once from the written copy and confirm the same first address appears.
3. If they do not match, the backup is wrong. Do not proceed — generate again and make new backups. Only a verified backup moves you to Section 3.

## 3. Deriving and Installing the zpub

1. On the offline device / hardware wallet, open the Bitcoin account at `m/84'/0'/0'` and use "export public key / export zpub". Confirm on the device screen that the path is `84'/0'/0'` (BIP84).
2. Transfer **only the zpub** to your connected computer (type it by hand and double-check, or use the manufacturer's companion app on a computer you trust). The seed words never make this trip.
3. In the Supabase dashboard: project **paymentgetway** → **Edge Functions** → **Secrets**. Add/update the secret named `BTC_XPUB` with the zpub. Save. Confirm you are on the correct project — setting it elsewhere does nothing for the live app.

Installing the zpub **on its own switches deposits on** — Receive and
the Section 7 deposit detection need nothing else. Funds sent to these
addresses land in the wallet the zpub came from (e.g. your Sparrow
wallet) and deposit crediting works immediately; spending them from
the platform side additionally needs the matching seed (Section 4).
If an xpub is already installed from an earlier setup, the drill below
is what proves it is really yours — an xpub whose addresses do not
match your wallet must be replaced before any real deposit.

### Verification drill — do not skip, before any real deposit
1. In the app, as a test user, open Bitcoin **Receive** and get a deposit address.
2. On a separate computer, open a watch-only wallet (e.g. **Sparrow Wallet**) and import **only the zpub** — never the seed.
3. Compare Sparrow's receive address at **index 0** with the app's address for derivation index 0. They must match **character for character**.
4. If they do not match, **stop** and do not accept deposits. Usual causes: wrong account path, wrong zpub, or the secret set on the wrong project. Fix the cause and repeat the drill. Repeat once more for a second test user's index for confidence.

## 4. Installing the Seed Secret

Installing the seed is what unlocks **spending**: withdrawals and
buy/sell trades. Deposits and Lightning do not wait for it (Sections 3
and 5). The platform verifies the seed⇄zpub match itself and refuses
to spend if the two control different accounts.

From this moment, anyone with the right dashboard or service-role access can move all funds. Treat dashboard access like bank-signing authority.

> **WARNING:** Keep dashboard access minimal and require MFA on every account before you set this secret.

1. First complete Section 2 (offline generation + verified backups) and Section 3 (zpub installed + drill passed).
2. Review who has access to project **paymentgetway** in the Supabase dashboard. Remove anyone who does not actively need it. Confirm **MFA is enabled** on every remaining account, including yours.
3. Retrieve the 24 words **from a backup copy, in person**. Do not have them sent to you.
4. Dashboard → project **paymentgetway** → **Edge Functions** → **Secrets**. Add/update `BTC_SEED_MNEMONIC` with the 24 words, exactly in order, single spaces, no extra lines. Save.
5. Do not paste the seed anywhere else to "check" it — no chat, notes app, or online tool. Clear your clipboard if your system allows it, and return the backup copy to its secure location immediately.

### Test withdrawal — do not skip
1. Fund the wallet with a very small test amount first if needed (Section 6).
2. Withdraw the **smallest amount the system allows** from the app to a wallet **you personally control** (e.g. your hardware wallet).
3. Wait for broadcast and confirmation. Check the transaction on mempool.space using the txid from the app / the `btc_withdrawals` row. Confirm the funds arrived.
4. Only a successful test makes the withdrawal path live. If it fails, do not launch withdrawals — escalate to a developer with the `btc_withdrawals` row and the function logs.

## 5. Setting BREEZ_API_KEY and Optional Config

### Breez (Lightning)
1. Obtain the key from Breez via its official onboarding channel, through a secure channel where possible.
2. Dashboard → project **paymentgetway** → **Edge Functions** → **Secrets**. Add/update `BREEZ_API_KEY`. Save.
3. Test one tiny Lightning payment in the app in each direction the product supports, and confirm balances update. If dashboard access is ever suspected compromised, rotate this key too (Section 9e).

The key **on its own switches custodial Lightning on** — invoices and
payments do not need the seed. The tiny-payment test in step 3 is the
deciding verification of the Breez server integration: if it fails,
Lightning stays honestly unavailable while the failure is investigated
— nothing about it is simulated in the meantime.

### Optional secrets (safe defaults — set only to override deliberately)
| Secret | Default | Meaning |
|---|---|---|
| `ESPLORA_API_URL` | `https://mempool.space/api` | Blockchain API used to scan deposits and broadcast |
| `TRADE_FEE_BPS` | `150` | Trade fee in basis points (150 = 1.5%) |
| `BTC_MIN_WITHDRAWAL_SATS` | `10000` | Minimum withdrawal, in sats |
| `BTC_MAX_TX_SATS` | `2000000` | Max single withdrawal (0.02 BTC) |
| `BTC_MAX_DAILY_SATS` | `5000000` | Max total withdrawals per day (0.05 BTC) |

To change one: write down the reason in your operations notes, update the secret by its exact name, save, then run one small test transaction. **Never raise withdrawal limits casually or under pressure from a single user request** — a raise increases what a bug or compromised account can drain (Section 11).

## 6. Funding the Hot Wallet and Setting the Float

The float must match real BTC actually sent in. Setting `float_sats` without funding first creates promises the wallet cannot keep.

1. Get a platform deposit address from the app (an address assigned to a platform/test account), or the intended address from `btc_address_assignments`.
2. From an external wallet you control, send the initial float amount to that address. Double-check the address character for character first — a wrong address loses the funds. Start smaller than your final target on the first funding; top up later.
3. Wait for **at least 1 confirmation** (check on mempool.space). Confirm a row appears in `btc_deposits` and moves to `credited`.
4. Compute current user balances (convert consistently: 1 BTC = 100,000,000 sats):
   ```sql
   select coalesce(sum(balance_sats), 0) as user_btc_total_sats
   from crypto_wallets
   where asset = 'BTC';
   ```
5. Set the float on the singleton row. The value is only the newly funded platform-owned sats — not sats already owed to users. Work the arithmetic out on paper with a developer if in doubt, *before* running this:
   ```sql
   update btc_treasury
   set float_sats = <FUNDED_SATS minus existing user balances>
   where id = 1;
   ```
6. Verify: `select id, float_sats from btc_treasury where id = 1;`
7. **Re-check the invariant:** actual hot-wallet BTC in sats (watch-only wallet total) ≈ `float_sats` + Σ user BTC balances. Small gaps explained by in-flight deposits (detected, not credited) or withdrawals (reserved, not confirmed) are expected. Large or unexplained gaps are not — stop and investigate before taking more trades.
8. Make one small test **buy** and one small test **sell** in the app. Confirm `float_sats` falls on the buy and rises on the sell by the expected amounts.

> **WARNING:** Never edit `float_sats` to "fix" a mismatch without finding *why* it mismatched. Editing the number hides theft, a double-credit bug, or a missed deposit.

## 7. Scheduling Deposit Detection

Deposits are not detected automatically. The `btc-onchain` function must be **called every ~5 minutes**; each call scans assigned addresses and credits at 1 confirmation. If the schedule stops, BTC still arrives on-chain but users are not credited until it runs again.

- Function: `btc-onchain`, action: `check_deposits`, authenticated with the project's **service-role key**. It scans via the Esplora API (`ESPLORA_API_URL`) and writes `btc_deposits` rows. It needs only `BTC_XPUB`; while no parseable zpub is installed it skips quietly (logged reason `receive_not_configured`) instead of erroring every 5 minutes.

### Setup (Supabase pg_cron + pg_net)
The real project URL and service-role key live in the dashboard (**Project Settings → API**) — copy them from there at setup time; never copy them into this document, a ticket, or a chat. The service-role key bypasses row-level security: anyone with it has full database access.

1. In the SQL editor for project **paymentgetway**, confirm extensions `pg_cron` and `pg_net` are enabled (**Database → Extensions**). Enable them if not.
2. Create the job using this **shape** — replace both placeholders with the real values from the dashboard:
   ```sql
   select cron.schedule(
     'btc-check-deposits',
     '*/5 * * * *',
     $$
     select net.http_post(
       url     := '<PROJECT_FUNCTIONS_URL>/btc-onchain',
       headers := '{"Content-Type": "application/json",
                    "Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
       body    := '{"action": "check_deposits"}'::jsonb
     );
     $$
   );
   ```
   `*/5 * * * *` = every 5 minutes. `<PROJECT_FUNCTIONS_URL>` is the Edge Functions base URL for paymentgetway.
3. Make one manual call with the same request and confirm success before relying on the schedule.
4. Make one small test deposit and confirm it is detected and credited after 1 confirmation **without** any manual call. That proves the schedule works.

### Checking it is running (daily at first, then weekly)
1. **Table:** `btc_deposits` shows recent rows with fresh timestamps. No new rows while deposits were sent = schedule problem.
2. **Logs:** Dashboard → **Edge Functions** → `btc-onchain` → **Logs** — regular invocations ~every 5 minutes, no repeated errors.
3. **Cron history:**
   ```sql
   select jobname, status, start_time, end_time
   from cron.job_run_details
   order by start_time desc limit 20;
   ```
4. If invocations stopped: check the job exists (`select * from cron.job;`), test a manual call, and check logs for Esplora errors. Do not credit deposits by hand — restore the schedule and let it catch up.

## 8. Daily and Weekly Operations

### Daily (5–10 minutes)
1. **Invariant:** compare hot-wallet actual BTC (sats), `btc_treasury.float_sats`, and Σ `crypto_wallets` BTC balances. Wallet ≈ float + user balances, allowing only for in-flight items you can name.
2. **Stuck withdrawals:** check `btc_withdrawals` for `reserved` rows older than 1 hour (see below).
3. **Deposits:** confirm new `btc_deposits` rows are moving `detected` → `credited`.
4. **Logs:** scan `btc-onchain` and `btc-trade` logs for repeated errors.
5. **Breez balance:** Lightning funds sit with Breez, separate from the on-chain wallet. If expected Lightning payouts exceed the available balance, arrange funding/rebalancing *before* users hit failures.

### Weekly
1. Repeat the invariant check slowly and record the three numbers and the date. A written trail is how you spot slow drift.
2. **Limits review:** re-read `BTC_MIN_WITHDRAWAL_SATS`, `BTC_MAX_TX_SATS`, `BTC_MAX_DAILY_SATS`. Confirm they still fit your risk appetite and hot-wallet size. A daily limit above the hot-wallet total is meaningless; a raise never lowered again is a future loss.
3. **Float adequacy:** enough to serve normal buy demand without constant top-ups, but not so much that the hot wallet holds unnecessary value. Top up (Section 6) or move excess to cold storage as a deliberate, documented decision.
4. **Access review:** re-check dashboard access to paymentgetway; confirm MFA is still on for everyone.
5. **Scheduler:** confirm the `btc-check-deposits` job ran all week (Section 7).

### Stuck withdrawals — `reserved` for more than 1 hour
`reserved` means funds were set aside to send but the withdrawal has not reached `broadcast`/`confirmed`. Investigate the same day — a stuck reservation locks a user's funds.

1. Open the `btc_withdrawals` row. Note `id`, `user_id`, amount, destination, `idempotency_key`, timestamps, and any txid.
2. If a txid exists, look it up on **mempool.space**:
   - Confirming/confirmed → broadcast happened; the status update likely failed. Record the txid and escalate to a developer to finalize the row from on-chain truth.
   - Found but unconfirmed for hours → likely fee/congestion. Record it and escalate; do not attempt your own fix.
   - Not found → the broadcast likely never happened.
3. Check `btc-onchain` logs around the withdrawal's creation time (Esplora outage, insufficient funds, limit rejection). Note whether the user was debited and whether the reservation is the only hold.

> **WARNING — never re-send a stuck withdrawal by hand.** Do not pay it again from another wallet, and do not tell the user to "just try again" while the original is unresolved. Double-paying is the classic custodial loss. The system is designed to finalize the original or refund the reservation; if neither happens automatically, **escalate to a developer** with the row ID and your explorer findings, and tell the user honestly that it is under review — do not promise a time you do not control. The same rule applies to a withdrawal stuck in `broadcast` far beyond normal confirmation times.

## 9. Incident Response — Suspected Seed Compromise

Act on **suspicion**, not proof. If the seed may have been seen, photographed, typed into a connected device, stored wrongly, or exposed via dashboard compromise, treat it as compromised. Waiting for proof usually means waiting until the wallet is empty.

> **WARNING:** Speed beats neatness in the first hour. An attacker with the seed can empty the wallet in one transaction at any moment.

**(a) Generate a NEW seed, offline.** Follow Section 2 exactly: hardware wallet or air-gapped machine, 24 words, paper + steel backups, two locations, verified backup. Do not rush the new backups — a sloppy backup repeats the original problem.

**(b) Point the platform at the new wallet.**
1. Derive the new zpub at `m/84'/0'/0'` (Section 3).
2. Dashboard → paymentgetway → Edge Functions → Secrets: update `BTC_XPUB` to the new zpub and `BTC_SEED_MNEMONIC` to the new 24 words. New deposit addresses and new withdrawals now use the new wallet.
3. Pause Bitcoin withdrawals in the app if your tooling allows it until step (c) finishes. Be ready to tell users deposits/withdrawals are briefly paused for maintenance. Do not announce a compromise externally without a deliberate decision — but never lie to a user who asks directly about their funds.

**(c) Sweep the old wallet to the new wallet.**
1. Get a fresh receiving address from the **new** wallet (app, after step (b), or its watch-only wallet).
2. On an **offline / air-gapped signer only**, restore the **OLD** seed. This is the one correct use of the old seed: on an offline signer, to empty it.
3. List addresses that may hold funds: every `address` in `btc_address_assignments`, plus the platform's own funding addresses. Check each balance via the offline signer or a watch-only view of the old wallet.
4. Build and sign sweep transactions sending **all** old-wallet funds to the new-wallet address. Broadcast only the signed transactions from a connected machine that never sees the seed.
5. Confirm on mempool.space, wait for confirmation, and confirm the new wallet now matches the expected invariant total. Record the small shortfall from network fees.

**(d) Keep watching old addresses.** Deposits will keep arriving there — users have them saved and some payments were already in flight. That money is still owed to users.
1. Monitor old addresses with the old zpub in a watch-only wallet (e.g. Sparrow) and keep crediting deposits to the right users per `btc_address_assignments`.
2. Sweep again periodically (weekly, then monthly) following step (c).
3. Decide in writing how long monitoring continues (months, not days) before the tail is closed.

**(e) If dashboard access may also be compromised, rotate Breez and keys.**
1. Rotate `BREEZ_API_KEY`: get a new key from Breez, update the secret, have the old key revoked.
2. Rotate the Supabase service-role key per Supabase's procedure and update everywhere it is used — including the Section 7 cron job.
3. Remove unneeded dashboard access, force password changes, confirm MFA on all remaining accounts.
4. Review `btc_withdrawals` and recent transactions for the compromise window for anything unrecognized. Preserve logs and rows — do not delete evidence. Afterwards, write a short internal record: what happened, when, what was moved or lost, and what changed so it cannot happen the same way again.

## 10. Backup Verification Drill — Quarterly

Untested backups are hopes, not backups. Run this every quarter, and after any change of safe, office, or responsible person.

1. Pick **one** backup copy (rotate: paper one quarter, steel the next) and retrieve it in person.
2. On an **offline device** (hardware-wallet recovery check, or an air-gapped machine), restore/verify from **that copy only**. Do not consult the other copy to "help."
3. Open account `m/84'/0'/0'` and list the first few receiving addresses (indexes 0, 1, 2, …).
4. Compare them with the first rows of `btc_address_assignments` ordered by `derivation_index`. They must match character for character. (This also confirms you hold the seed behind the live `BTC_XPUB` — never paste the seed or zpub into an online tool to check.)
5. If a copy is damaged, illegible, or mismatched, treat it as urgent: verify the *other* copy immediately, then — while a good copy exists — make a fresh replacement per Section 2. If **neither** copy verifies, escalate at once and plan a controlled migration to a new seed with developer help (Section 9a–c, without incident urgency).
6. Return the tested copy to its secure location the same day. Never leave a backup out overnight.
7. Record in operations notes: date, which copy, result (matched / problem), and who ran it. **Results only** — never copy locations, never any part of the words.

## 11. What Never To Do

Print this section. Every item here has lost real platforms real money.

1. **Never put the seed in git** — not in code, a committed `.env`, a comment, or "temporarily."
2. **Never send the seed, zpub, or any API key in chat, email, or a ticket** — including to developers, support, or this assistant. Legitimate support never asks for the seed.
3. **Never photograph the seed**, or store it in cloud photos/notes or a synced folder.
4. **Never type the seed into a connected device** except the single dashboard secret entry (Section 4) — the Section 9c sweep uses an *offline* signer.
5. **Never raise withdrawal limits** without a written review of why, the new exposure, and its relation to the hot-wallet size — and never to satisfy one user's urgent request.
6. **Never edit a `crypto_wallets` balance by hand** without a matching audit row in the transactions record stating the correction, reason, and approver. Silent edits destroy the invariant as evidence and make theft undetectable.
7. **Never edit `float_sats` to make the numbers agree.** Find the cause first (Section 6).
8. **Never disable the deposit-detection scheduler** to "stop errors" and leave it off — deposits will silently go uncredited. Fix the error; if you must pause it, set a same-day reminder to restore it and watch `btc_deposits` manually meanwhile.
9. **Never re-send a stuck withdrawal manually** (Section 8). Investigate, record, escalate.
10. **Never grant dashboard access casually** — no shared logins, no "just to look," no access without MFA. After Section 4, dashboard access is effectively signing authority over all Bitcoin.
11. **Never put BMaGlass Pay's Bitcoin secrets on the wrong project.** `BTC_XPUB`, `BTC_SEED_MNEMONIC`, and `BREEZ_API_KEY` belong to project **paymentgetway** only.
12. **Never skip the drills** — the address match (Section 3), the test withdrawal (Section 4), and the quarterly backup drill (Section 10) are the only evidence that recovery and spending work before real user money depends on them.

## 12. The Self-Custody Wallet (User-Held Keys)

Alongside the custodial account, the app offers a **self-custody wallet**
that runs entirely in the user's browser:

- The seed phrase is generated on the user's device, encrypted there with a
  wallet password (PBKDF2 + AES-256-GCM) into an on-device vault, and is
  **never transmitted to any server** — not to Supabase, not to BMaGlass,
  not anywhere. Balances are read from the public blockchain; sends are
  signed on the device.
- **There is NO recovery for self-custody funds.** If a user loses their
  seed phrase, the funds are gone. Support must NEVER ask a user for their
  seed phrase or wallet password — anyone who asks is scamming them. The
  only legitimate advice: restore by importing the phrase on the wallet
  page; if the device password is forgotten, remove the device vault and
  import the phrase again.
- The two wallets are labelled everywhere in the UI (CUSTODIAL vs
  SELF-CUSTODY) and are fully independent; moving funds between them is an
  ordinary on-chain send.
- **Self-custody Lightning & Spark** uses the **Breez SDK – Spark**
  (`@breeztech/breez-sdk-spark`, `src/lib/selfcustody/spark.ts`), running
  in-browser under the user's own seed — the same architecture as Glow,
  Breez's reference wallet app. One Spark balance covers Lightning
  invoices, on-chain Bitcoin deposits (auto-claimed into the balance,
  after 3 confirmations by default) and Spark transfers; sending uses a
  single paste-anything flow (the SDK's `parse()` + `prepareSendPayment()`
  quote the exact fee before the user confirms), plus LNURL-pay /
  withdraw / auth and a MoonPay buy button.

  > **Do not resurrect the old Liquid integration.** Breez has deprecated
  > the Breez SDK – Liquid (its documentation site now only carries a
  > notice steering all partners to Spark) and Glow is a Spark app, not a
  > Liquid app. The former `VITE_BREEZ_LIQUID_API_KEY` gate and the
  > `lightning.ts` module were removed with the Spark migration.

### Enabling Spark / Lightning / MoonPay buy (go-live)

One step, done by the CEO:

1. Set the app environment variable **`VITE_BREEZ_API_KEY`** (Vercel →
   project → Settings → Environment Variables, production) to **the
   existing Breez API key** and redeploy. The Breez API key is a single
   per-app developer credential — the same Breez-issued key already
   stored in the project's Supabase secrets as `BREEZ_API_KEY` is the key
   the Spark web integration uses as `VITE_BREEZ_API_KEY`. Note that
   Supabase never reveals stored secret values, so the value must come
   from the CEO's own copy of the key (the one Breez emailed when it was
   issued) — never request it over chat or any other channel.
2. Until the variable is set, the Spark features stay honestly disabled:
   the wallet explains why, and on-chain self-custody is unaffected.
   Nothing is simulated.

Key safety notes:

- The Breez API key is a partner/app identifier: it gates SDK access and
  **cannot move funds** (only a wallet's mnemonic can). Breez's own Spark
  examples ship it in the client bundle via `VITE_BREEZ_API_KEY` by
  design. If a new key is ever needed, it is free from
  breez.technology/request-api-key.
- The SDK persists its state in the browser (IndexedDB) under a
  per-wallet storage directory. Browser storage is evictable — the user's
  seed phrase (in their encrypted vault / paper backup) remains the only
  durable recovery root, exactly as for the on-chain wallet above.
- A browser tab that is closed cannot sync or finish claims; pending
  receives resolve when the user next opens the wallet and the SDK syncs.

### MoonPay buy — what users should expect

- The Buy button calls the SDK's `buyBitcoin({ type: 'moonpay', … })`,
  which returns a MoonPay checkout URL under **Breez's own MoonPay
  partner arrangement** — the app needs no MoonPay account or keys of its
  own. On web the tab is pre-opened inside the click (mobile browsers
  block `window.open()` after an await).
- Purchased Bitcoin is delivered to the wallet's on-chain deposit
  address and claimed into the Spark balance automatically.
- **Zambia is supported** for MoonPay Buy and cards work — but **ZMW is
  not a supported MoonPay currency**: users pay in USD/EUR/GBP and their
  card issuer converts. Expect a **~$20 minimum** ticket, MoonPay fees of
  **up to 4.5%** (plus a partner minimum on small purchases and Breez's
  ecosystem fee), and **full KYC run by MoonPay** (government ID +
  liveness check, questionnaire, proof of address for higher tiers).
  The UI states the currency and minimum facts before redirecting.

---
*End of runbook. This file is safe to keep in the repo because it contains no secrets. Keep the secrets out of the repo, always.*
