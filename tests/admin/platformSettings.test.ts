import { describe, expect, it } from "vitest";
import {
  ALL_SETTING_FIELDS,
  buildSettingsPatch,
  judgeFxHealth,
  judgeSnapshotHealth,
  judgeWebhookHealth,
  readEditableValues,
  settingsErrorMessage,
  type SettingsValues,
} from "../../src/lib/platformSettings";

// The editable model must mirror the server-side whitelist in
// public.admin_update_platform_settings (migration 20261274)
// EXACTLY — if the two drift, the console would offer a setting
// the RPC refuses (or hide one it accepts). Pin the key list.
const RPC_WHITELIST = [
  "p2p_enabled", "pos_enabled", "mtn_momo_enabled", "airtel_money_enabled",
  "moonpay_enabled", "moonpay_selfcustody_enabled", "paypal_payouts_enabled",
  "bank_payouts_enabled", "receiving_accounts_enabled",
  "face_verification_enabled", "btc_rebalance_enabled", "btc_batch_enabled",
  "btc_consolidation_enabled",
  "send_money_fee_percent", "transfer_fee_percent",
  "split_platform_fee_percent", "p2p_fee_percent",
  "paypal_platform_fee_percent", "paypal_payout_fee_percent",
  "bank_payout_fee_percent",
  "bank_payout_min_zmw", "paypal_float_allowance_usd",
];

describe("platformSettings — editable model parity with the RPC whitelist", () => {
  it("offers exactly the keys the RPC accepts, no more, no fewer", () => {
    expect(ALL_SETTING_FIELDS.map((f) => f.key).sort()).toEqual(
      [...RPC_WHITELIST].sort(),
    );
  });
});

describe("readEditableValues", () => {
  it("reads whitelisted keys and ignores everything else in the row", () => {
    const values = readEditableValues({
      p2p_enabled: true,
      send_money_fee_percent: "2.5",
      btc_max_tx_sats: 2000000,
      paypal_subscription_product_id: "secret-ish",
    });
    expect(values.p2p_enabled).toBe(true);
    expect(values.send_money_fee_percent).toBe(2.5);
    expect("btc_max_tx_sats" in values).toBe(false);
    expect("paypal_subscription_product_id" in values).toBe(false);
  });

  it("fails closed on a missing row: toggles off, numbers zero", () => {
    const values = readEditableValues(null);
    expect(values.p2p_enabled).toBe(false);
    expect(values.p2p_fee_percent).toBe(0);
  });
});

describe("buildSettingsPatch", () => {
  const original: SettingsValues = {
    p2p_enabled: true,
    mtn_momo_enabled: false,
    p2p_fee_percent: 0.5,
    bank_payout_min_zmw: 50,
  };

  it("an unchanged form produces an empty patch and no errors", () => {
    const { patch, errors } = buildSettingsPatch(original, { ...original });
    expect(patch).toEqual({});
    expect(errors).toEqual({});
  });

  it("includes only the keys that actually changed", () => {
    const { patch, errors } = buildSettingsPatch(original, {
      ...original,
      mtn_momo_enabled: true,
      p2p_fee_percent: 0.75,
    });
    expect(errors).toEqual({});
    expect(patch).toEqual({ mtn_momo_enabled: true, p2p_fee_percent: 0.75 });
  });

  it("refuses a fee outside 0–100 with a plain-language error", () => {
    const { patch, errors } = buildSettingsPatch(original, {
      ...original,
      p2p_fee_percent: 150,
    });
    expect(patch).toEqual({});
    expect(errors.p2p_fee_percent).toContain("between 0% and 100%");
  });

  it("refuses a negative amount and a non-number", () => {
    const neg = buildSettingsPatch(original, {
      ...original,
      bank_payout_min_zmw: -1,
    });
    expect(neg.errors.bank_payout_min_zmw).toContain("less than zero");
    const nan = buildSettingsPatch(original, {
      ...original,
      bank_payout_min_zmw: NaN,
    });
    expect(nan.errors.bank_payout_min_zmw).toContain("must be a number");
  });
});

describe("settingsErrorMessage — RPC refusals become plain language", () => {
  it("maps the super_admin gate refusal", () => {
    expect(
      settingsErrorMessage(new Error("Only a super admin can change platform settings")),
    ).toContain("Only a super admin can change platform settings");
  });

  it("maps the unknown-setting refusal without leaking the raw text", () => {
    const msg = settingsErrorMessage(
      new Error("Unknown or read-only setting: btc_coinos_deposit_address"),
    );
    expect(msg).toContain("can't be changed from here");
    expect(msg).not.toContain("btc_coinos_deposit_address");
  });

  it("maps the range refusal", () => {
    expect(
      settingsErrorMessage(new Error("Fee p2p_fee_percent must be a number between 0 and 100")),
    ).toContain("isn't valid");
  });
});

describe("health judgements", () => {
  const now = new Date("2026-11-19T12:00:00Z");

  it("snapshot: fresh and unstaled is healthy", () => {
    const j = judgeSnapshotHealth(
      { created_at: "2026-11-19T11:59:00Z", is_stale: false },
      now,
    );
    expect(j.status).toBe("healthy");
  });

  it("snapshot: a stale flag is down even when recent", () => {
    const j = judgeSnapshotHealth(
      { created_at: "2026-11-19T11:59:30Z", is_stale: true },
      now,
    );
    expect(j.status).toBe("down");
  });

  it("snapshot: older than 10 minutes is down; none at all is unknown", () => {
    expect(
      judgeSnapshotHealth({ created_at: "2026-11-19T11:40:00Z", is_stale: false }, now).status,
    ).toBe("down");
    expect(judgeSnapshotHealth(null, now).status).toBe("unknown");
  });

  it("fx: inside the validity window is healthy, expired is down", () => {
    expect(
      judgeFxHealth({ rate: 20.58, valid_until: "2026-11-19T12:30:00Z" }, now).status,
    ).toBe("healthy");
    expect(
      judgeFxHealth({ rate: 20.58, valid_until: "2026-11-19T11:30:00Z" }, now).status,
    ).toBe("down");
    expect(judgeFxHealth(null, now).status).toBe("unknown");
  });

  it("webhooks: failures need a look, a clean or empty window is healthy", () => {
    const withFailures = judgeWebhookHealth([
      { status: "delivered" },
      { status: "failed" },
      { status: "pending" },
    ]);
    expect(withFailures.status).toBe("attention");
    expect(withFailures.failed).toBe(1);
    expect(withFailures.total).toBe(3);
    expect(judgeWebhookHealth([]).status).toBe("healthy");
    expect(judgeWebhookHealth([{ status: "delivered" }]).status).toBe("healthy");
  });
});
