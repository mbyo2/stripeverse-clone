"""Standalone tests for the Odoo module's vendored BMaGlass client.

No Odoo needed: the client file is imported by path and driven through
a stub transport that mirrors the developer-api contract — the same
approach as the SDK contract tests in sdk/tests.

Run: python3 -m unittest discover integrations/odoo/tests -v
"""
import importlib.util
import json
import sys
import unittest
from pathlib import Path

CLIENT_PATH = (Path(__file__).resolve().parents[1]
               / "payment_bmaglass" / "models" / "bmaglass_api.py")
spec = importlib.util.spec_from_file_location("bmaglass_api", CLIENT_PATH)
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


class FakeTransport:
    def __init__(self):
        self.calls = []

    def __call__(self, method, url, headers, raw):
        self.calls.append({"method": method, "url": url, "headers": headers,
                           "body": json.loads(raw) if raw else None})
        if headers.get("X-Api-Key") not in ("bmp_test_contract", "bmp_live_contract"):
            return 401, json.dumps({"error": "invalid_api_key", "message": "nope"})
        if url.endswith("/wallets"):
            return 200, json.dumps({"data": [{"id": "w1", "currency": "ZMW", "balance": 42}], "mode": "test"})
        if url.endswith("/payment-links") and method == "GET":
            return 200, json.dumps({"data": [{"id": "pl1", "link_code": "ABC123",
                                              "payment_count": 1, "total_collected": 5}], "mode": "live"})
        if url.endswith("/payment-links") and method == "POST":
            if headers.get("X-Api-Key", "").startswith("bmp_test_"):
                return 403, json.dumps({"error": "test_mode_read_only", "message": "Test keys are read-only"})
            req = json.loads(raw)
            return 201, json.dumps({"data": {"id": "pl1", "title": req["title"],
                                             "amount": req.get("amount"), "currency": req["currency"],
                                             "link_code": "ABC123"}, "mode": "live"})
        if url.endswith("/webhooks") and method == "POST":
            return 201, json.dumps({"data": {"id": "wh1", "secret": "whsec_testsecret"}, "mode": "live"})
        return 404, json.dumps({"error": "not_found", "message": "no route"})


class ClientTest(unittest.TestCase):
    def setUp(self):
        self.transport = FakeTransport()
        self.test_client = api.BMaGlassClient("bmp_test_contract", base_url="http://local.test",
                                              opener=self.transport)
        self.live_client = api.BMaGlassClient("bmp_live_contract", base_url="http://local.test",
                                              opener=self.transport)

    def test_mode_detection(self):
        self.assertEqual(self.test_client.mode, "test")
        self.assertEqual(self.live_client.mode, "live")
        with self.assertRaises(api.BMaGlassError):
            api.BMaGlassClient("sk_live_nope")

    def test_wallets_sends_key_header(self):
        wallets = self.test_client.wallets()
        self.assertEqual(wallets[0]["balance"], 42)
        self.assertEqual(self.transport.calls[-1]["headers"]["X-Api-Key"], "bmp_test_contract")

    def test_create_link_shaping(self):
        link = self.live_client.create_payment_link("Order S0001", amount=10.5, currency="zmw")
        self.assertEqual(link["link_code"], "ABC123")
        sent = self.transport.calls[-1]["body"]
        self.assertEqual(sent["currency"], "ZMW")
        self.assertEqual(sent["amount"], 10.5)
        self.assertEqual(api.payment_link_url("ABC123"), "https://bmaglasspay.online/pay/ABC123")

    def test_test_key_write_maps_to_honest_message(self):
        with self.assertRaises(api.BMaGlassError) as ctx:
            self.test_client.create_payment_link("Nope", amount=5)
        self.assertEqual(ctx.exception.code, "test_mode_read_only")
        self.assertTrue(ctx.exception.is_test_mode_read_only)
        self.assertIn("no test-mode ledger", ctx.exception.user_message())

    def test_currency_guard_fires_before_transport(self):
        before = len(self.transport.calls)
        with self.assertRaises(api.BMaGlassError) as ctx:
            self.live_client.create_payment_link("Euro order", amount=5, currency="EUR")
        self.assertEqual(ctx.exception.code, "unsupported_currency")
        self.assertIn("no exchange rate", ctx.exception.user_message())
        self.assertEqual(len(self.transport.calls), before)

    def test_webhook_create_returns_one_time_secret(self):
        hook = self.live_client.create_webhook("https://example.com/hook")
        self.assertEqual(hook["secret"], "whsec_testsecret")


class WebhookVerifyTest(unittest.TestCase):
    # Shared cross-SDK known-answer vector (sdk/tests, TS + Python SDKs).
    RAW = b'{"id":"evt_1","type":"webhook.test","created":"2026-10-26T00:00:00.000Z","data":{"ping":true}}'
    SIG = "sha256=ff522c97ada5bfd4f6c09a0457823f89546896708e8e1f5bbb72d2ad59d68535"

    def test_known_answer_vector(self):
        self.assertTrue(api.verify_webhook_signature(self.RAW, self.SIG, "whsec_testsecret"))
        self.assertFalse(api.verify_webhook_signature(self.RAW, self.SIG, "whsec_wrong"))
        self.assertFalse(api.verify_webhook_signature(self.RAW + b" ", self.SIG, "whsec_testsecret"))
        event = api.parse_webhook_event(self.RAW, self.SIG, "whsec_testsecret")
        self.assertEqual(event["type"], "webhook.test")
        self.assertIsNone(api.parse_webhook_event(self.RAW, "sha256=deadbeef", "whsec_testsecret"))


if __name__ == "__main__":
    unittest.main()
