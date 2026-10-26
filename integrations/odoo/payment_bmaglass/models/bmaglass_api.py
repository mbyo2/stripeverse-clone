# -*- coding: utf-8 -*-
"""BMaGlass Pay Developer API client — vendored into the Odoo module.

A minimal, dependency-free (urllib) mirror of the standalone Python
SDK in sdk/python. Odoo addons cannot rely on installing an
unpublished PyPI package, so the client travels with the module. The
surface, error codes and webhook scheme are identical to the other
SDKs — including the shared HMAC known-answer test vector.

Auth: an API key created in the BMaGlass Pay app (X-Api-Key header).
bmp_live_ keys move real money; bmp_test_ keys are READ-ONLY —
BMaGlass Pay has no test-mode ledger, so a test key can never move
money. Write attempts with a test key fail with 403
``test_mode_read_only`` and are mapped to plain language below.
"""
import hashlib
import hmac
import json
import urllib.error
import urllib.request

DEFAULT_BASE = "https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/developer-api"
SITE_BASE = "https://bmaglasspay.online"
SUPPORTED_CURRENCIES = ("ZMW", "USD")

TEST_MODE_MESSAGE = (
    "This BMaGlass API key is a test key. Test keys can check the connection "
    "and read wallets, but they can't take payments — BMaGlass Pay has no "
    "test-mode ledger, so a test key can never move money. Use a live key "
    "(bmp_live_...) to accept payments."
)


class BMaGlassError(Exception):
    """Typed API error: HTTP status + the API's stable error code."""

    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message

    @property
    def is_test_mode_read_only(self):
        return self.code == "test_mode_read_only"

    def user_message(self):
        """Plain-language message safe to show a merchant — never raw."""
        if self.code == "test_mode_read_only":
            return TEST_MODE_MESSAGE
        if self.code in ("invalid_api_key", "api_key_revoked", "api_key_expired"):
            return (
                "That BMaGlass API key wasn't accepted. Check the key in your "
                "BMaGlass Pay account (Business settings or the API page) and try again."
            )
        if self.code == "insufficient_scope":
            return (
                "This BMaGlass API key doesn't have permission for that action. "
                "Create a key with the needed scopes in BMaGlass Pay and try again."
            )
        if self.code == "unsupported_currency":
            return self.message
        return self.message or "BMaGlass Pay couldn't complete that request (HTTP %s)." % self.status


def assert_supported_currency(currency):
    """Only currencies with wallets may be used — never a silent conversion."""
    code = str(currency or "").upper()
    if code not in SUPPORTED_CURRENCIES:
        raise BMaGlassError(
            0,
            "unsupported_currency",
            "BMaGlass Pay wallets are ZMW and USD. This transaction is in %s, which has "
            "no BMaGlass wallet, so BMaGlass checkout can't run — no exchange rate has "
            "been applied. Use ZMW or USD to pay with BMaGlass Pay." % (code or "?"),
        )
    return code


def paid_event_matches(data, link_code, amount, currency):
    """Pure check: does a payment_link.paid event's `data` settle the
    transaction that owns `link_code` for `amount`/`currency`?

    The webhook route HMAC-verifies the payload before this runs; this
    is the second, semantic line of defence (right link, right
    currency, amount covering the transaction total within a ngwee of
    rounding). Returns (ok, reason) — reason is for logs, never shown
    to buyers. Kept dependency-free so the unit tests exercise it
    without an Odoo runtime.
    """
    if not isinstance(data, dict):
        return False, "payload data is not an object"
    if not link_code or data.get("link_code") != link_code:
        return False, "link_code mismatch"
    if str(data.get("currency") or "").upper() != str(currency or "").upper():
        return False, "currency mismatch"
    try:
        paid = float(data.get("amount"))
    except (TypeError, ValueError):
        return False, "amount missing or not numeric"
    if paid + 0.009 < round(float(amount), 2):
        return False, "amount below the transaction total"
    return True, "ok"


def payment_link_url(link_code):
    """Hosted payment page URL for a link code."""
    return "%s/pay/%s" % (SITE_BASE, link_code)


def verify_webhook_signature(raw_body, signature_header, secret):
    """Verify an X-BMaGlass-Signature header ("sha256=<hex>") over the raw body."""
    if not signature_header or not signature_header.startswith("sha256=") or not secret:
        return False
    if isinstance(raw_body, str):
        raw_body = raw_body.encode("utf-8")
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)


def parse_webhook_event(raw_body, signature_header, secret):
    """Verify + decode a webhook payload; None when invalid."""
    if not verify_webhook_signature(raw_body, signature_header, secret):
        return None
    try:
        if isinstance(raw_body, bytes):
            raw_body = raw_body.decode("utf-8")
        return json.loads(raw_body)
    except (ValueError, UnicodeDecodeError):
        return None


class BMaGlassClient:
    """Thin typed client over the developer API (mirrors sdk/python)."""

    def __init__(self, api_key, base_url=DEFAULT_BASE, opener=None):
        if not api_key or not str(api_key).startswith("bmp_"):
            raise BMaGlassError(
                0, "invalid_api_key",
                "api_key must be a BMaGlass Pay API key (bmp_live_... or bmp_test_...).",
            )
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self._opener = opener  # tests: fn(method, url, headers, body_bytes) -> (status, text)

    @property
    def mode(self):
        return "live" if self.api_key.startswith("bmp_live_") else "test"

    @property
    def is_live(self):
        return self.mode == "live"

    # -- transport -----------------------------------------------------
    def _request(self, method, path, body=None, headers=None):
        url = "%s/%s" % (self.base_url, path.lstrip("/"))
        hdrs = {"X-Api-Key": self.api_key, "Content-Type": "application/json"}
        if headers:
            hdrs.update(headers)
        raw = json.dumps(body).encode("utf-8") if body is not None else None
        if self._opener is not None:
            status, text = self._opener(method, url, hdrs, raw)
        else:
            status, text = self._urllib(method, url, hdrs, raw)
        try:
            parsed = json.loads(text) if text else {}
        except ValueError:
            parsed = {}
        if not (200 <= status < 300):
            raise BMaGlassError(
                status,
                parsed.get("error", "request_failed"),
                parsed.get("message", "Request failed with HTTP %s" % status),
            )
        return parsed.get("data", parsed)

    @staticmethod
    def _urllib(method, url, headers, raw):
        req = urllib.request.Request(url, data=raw, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                return res.status, res.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace")
        except urllib.error.URLError as e:
            raise BMaGlassError(
                0, "network_error",
                "Couldn't reach BMaGlass Pay. Check the connection and try again. (%s)" % e.reason,
            )

    # -- endpoints -----------------------------------------------------
    def wallets(self):
        return self._request("GET", "wallets")

    def transactions(self, limit=25):
        return self._request("GET", "transactions?limit=%d" % max(1, min(100, int(limit))))

    def create_transfer(self, to_user_id, amount, currency="ZMW", description=None,
                        recipient_name=None, idempotency_key=None):
        body = {"to_user_id": to_user_id, "amount": amount,
                "currency": assert_supported_currency(currency)}
        if description is not None:
            body["description"] = description
        if recipient_name is not None:
            body["recipient_name"] = recipient_name
        headers = {"Idempotency-Key": idempotency_key} if idempotency_key else None
        return self._request("POST", "transfers", body, headers)

    def list_payment_links(self):
        return self._request("GET", "payment-links")

    def create_payment_link(self, title, amount=None, currency="ZMW",
                            description=None, expires_at=None):
        body = {"title": str(title), "currency": assert_supported_currency(currency)}
        if amount is not None:
            body["amount"] = round(float(amount), 2)
        if description is not None:
            body["description"] = description
        if expires_at is not None:
            body["expires_at"] = expires_at
        return self._request("POST", "payment-links", body)

    def bitcoin_balance(self):
        return self._request("GET", "bitcoin/balance")

    def bitcoin_deposit_address(self):
        return self._request("GET", "bitcoin/deposit-address")

    def bitcoin_quote(self, side, amount_zmw=None, amount_sats=None):
        body = {"side": "sell" if side == "sell" else "buy"}
        if amount_zmw is not None:
            body["amount_zmw"] = amount_zmw
        if amount_sats is not None:
            body["amount_sats"] = amount_sats
        return self._request("POST", "bitcoin/quote", body)

    def list_webhooks(self):
        return self._request("GET", "webhooks")

    def create_webhook(self, url, events=None):
        body = {"url": url}
        if events is not None:
            body["events"] = list(events)
        return self._request("POST", "webhooks", body)

    def delete_webhook(self, webhook_id):
        return self._request("DELETE", "webhooks/%s" % webhook_id)

    def test_webhook(self, webhook_id):
        return self._request("POST", "webhooks/%s/test" % webhook_id)

    def webhook_deliveries(self):
        return self._request("GET", "webhook-deliveries")
