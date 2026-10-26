"""BMaGlass Pay Developer API client (Python).

Auth: an API key created in the BMaGlass Pay app. ``bmp_live_`` keys
move real money; ``bmp_test_`` keys are read-only — this app has no
test-mode ledger, so a test key can never move money.
"""
from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any, Optional

import requests

DEFAULT_BASE = "https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/developer-api"


class BMaGlassError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class BMaGlass:
    def __init__(self, api_key: str, base_url: str = DEFAULT_BASE, session: Optional[requests.Session] = None):
        if not api_key or not api_key.startswith("bmp_"):
            raise BMaGlassError(0, "invalid_api_key", "api_key must be a BMaGlass Pay API key (bmp_live_... or bmp_test_...).")
        self.api_key = api_key
        self.mode = "live" if "_live_" in api_key else "test"
        self.base_url = base_url.rstrip("/")
        self.session = session or requests.Session()
        self.wallets = _Wallets(self)
        self.transactions = _Transactions(self)
        self.transfers = _Transfers(self)
        self.payment_links = _PaymentLinks(self)
        self.bitcoin = _Bitcoin(self)
        self.webhooks = _Webhooks(self)

    def _request(self, method: str, path: str, body: Any = None, headers: Optional[dict] = None) -> Any:
        hdrs = {"X-Api-Key": self.api_key, "Content-Type": "application/json"}
        if headers:
            hdrs.update(headers)
        res = self.session.request(method, f"{self.base_url}/{path}", headers=hdrs,
                                   data=json.dumps(body) if body is not None else None, timeout=30)
        try:
            parsed = res.json() if res.text else {}
        except ValueError:
            parsed = {}
        if not res.ok:
            raise BMaGlassError(res.status_code, parsed.get("error", "request_failed"),
                                parsed.get("message", f"Request failed with HTTP {res.status_code}"))
        return parsed.get("data", parsed)


class _Wallets:
    def __init__(self, c: BMaGlass): self.c = c
    def list(self): return self.c._request("GET", "wallets")


class _Transactions:
    def __init__(self, c: BMaGlass): self.c = c
    def list(self, limit: int = 25): return self.c._request("GET", f"transactions?limit={limit}")


class _Transfers:
    def __init__(self, c: BMaGlass): self.c = c
    def create(self, to_user_id: str, amount: float, currency: str = "ZMW",
               description: Optional[str] = None, recipient_name: Optional[str] = None,
               idempotency_key: Optional[str] = None):
        body = {"to_user_id": to_user_id, "amount": amount, "currency": currency}
        if description is not None: body["description"] = description
        if recipient_name is not None: body["recipient_name"] = recipient_name
        headers = {"Idempotency-Key": idempotency_key} if idempotency_key else None
        return self.c._request("POST", "transfers", body, headers)


class _PaymentLinks:
    def __init__(self, c: BMaGlass): self.c = c
    def list(self): return self.c._request("GET", "payment-links")
    def create(self, title: str, **kwargs): return self.c._request("POST", "payment-links", {"title": title, **kwargs})


class _Bitcoin:
    def __init__(self, c: BMaGlass): self.c = c
    def balance(self): return self.c._request("GET", "bitcoin/balance")
    def deposit_address(self): return self.c._request("GET", "bitcoin/deposit-address")
    def quote(self, side: str, amount_zmw: Optional[float] = None, amount_sats: Optional[float] = None):
        body: dict[str, Any] = {"side": side}
        if amount_zmw is not None: body["amount_zmw"] = amount_zmw
        if amount_sats is not None: body["amount_sats"] = amount_sats
        return self.c._request("POST", "bitcoin/quote", body)


class _Webhooks:
    def __init__(self, c: BMaGlass): self.c = c
    def list(self): return self.c._request("GET", "webhooks")
    def create(self, url: str, events: Optional[list] = None):
        body: dict[str, Any] = {"url": url}
        if events is not None: body["events"] = events
        return self.c._request("POST", "webhooks", body)
    def remove(self, webhook_id: str): return self.c._request("DELETE", f"webhooks/{webhook_id}")
    def test(self, webhook_id: str): return self.c._request("POST", f"webhooks/{webhook_id}/test")
    def deliveries(self): return self.c._request("GET", "webhook-deliveries")


def verify_webhook_signature(raw_body: bytes, signature_header: str, secret: str) -> bool:
    """Verify an X-BMaGlass-Signature header ("sha256=<hex>") over the exact raw body."""
    if not signature_header or not signature_header.startswith("sha256=") or not secret:
        return False
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)


def parse_webhook_event(raw_body: bytes, signature_header: str, secret: str) -> Optional[dict]:
    if not verify_webhook_signature(raw_body, signature_header, secret):
        return None
    try:
        return json.loads(raw_body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
