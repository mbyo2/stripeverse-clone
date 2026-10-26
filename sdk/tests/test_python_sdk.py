"""Contract tests for the Python SDK using a stub transport that mirrors
the developer-api contract. Run: python3 -m unittest discover sdk/tests -v
(from the repo root, with sdk/python on PYTHONPATH)."""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from bmaglass_sdk import BMaGlass, BMaGlassError, verify_webhook_signature, parse_webhook_event


class FakeResponse:
    def __init__(self, status, payload):
        self.status_code = status
        self.ok = 200 <= status < 300
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self):
        self.calls = []

    def request(self, method, url, headers=None, data=None, timeout=None):
        self.calls.append({"method": method, "url": url, "headers": headers, "data": data})
        if headers.get("X-Api-Key") != "bmp_test_contract":
            return FakeResponse(401, {"error": "invalid_api_key", "message": "nope"})
        if url.endswith("/wallets"):
            return FakeResponse(200, {"data": [{"id": "w1", "currency": "ZMW", "balance": 42}], "mode": "test"})
        if "/transactions" in url:
            return FakeResponse(200, {"data": [], "mode": "test"})
        if url.endswith("/transfers"):
            return FakeResponse(403, {"error": "test_mode_read_only", "message": "Test keys are read-only"})
        if url.endswith("/bitcoin/balance"):
            return FakeResponse(200, {"data": [{"asset": "BTC", "balance_sats": 1000}], "mode": "test"})
        if url.endswith("/webhooks") and method == "POST":
            return FakeResponse(201, {"data": {"id": "wh1", "secret": "whsec_testsecret"}, "mode": "test"})
        return FakeResponse(404, {"error": "not_found", "message": "no route"})


class SdkContractTest(unittest.TestCase):
    def setUp(self):
        self.session = FakeSession()
        self.client = BMaGlass("bmp_test_contract", base_url="http://local.test", session=self.session)

    def test_mode_detection(self):
        self.assertEqual(self.client.mode, "test")
        self.assertEqual(BMaGlass("bmp_live_x", session=FakeSession()).mode, "live")
        with self.assertRaises(BMaGlassError):
            BMaGlass("sk_live_nope")

    def test_wallets_sends_key_header(self):
        wallets = self.client.wallets.list()
        self.assertEqual(wallets[0]["balance"], 42)
        self.assertEqual(self.session.calls[-1]["headers"]["X-Api-Key"], "bmp_test_contract")

    def test_transfer_test_mode_error_is_typed(self):
        with self.assertRaises(BMaGlassError) as ctx:
            self.client.transfers.create(to_user_id="u2", amount=10, idempotency_key="idem-1")
        self.assertEqual(ctx.exception.status, 403)
        self.assertEqual(ctx.exception.code, "test_mode_read_only")
        self.assertEqual(self.session.calls[-1]["headers"]["Idempotency-Key"], "idem-1")

    def test_bitcoin_and_webhooks(self):
        self.assertEqual(self.client.bitcoin.balance()[0]["balance_sats"], 1000)
        hook = self.client.webhooks.create("https://example.com/hook")
        self.assertEqual(hook["secret"], "whsec_testsecret")


class WebhookVerifyTest(unittest.TestCase):
    RAW = b'{"id":"evt_1","type":"webhook.test","created":"2026-10-26T00:00:00.000Z","data":{"ping":true}}'
    SIG = "sha256=ff522c97ada5bfd4f6c09a0457823f89546896708e8e1f5bbb72d2ad59d68535"

    def test_known_answer_vector(self):
        self.assertTrue(verify_webhook_signature(self.RAW, self.SIG, "whsec_testsecret"))
        self.assertFalse(verify_webhook_signature(self.RAW, self.SIG, "whsec_wrong"))
        self.assertFalse(verify_webhook_signature(self.RAW + b" ", self.SIG, "whsec_testsecret"))
        event = parse_webhook_event(self.RAW, self.SIG, "whsec_testsecret")
        self.assertEqual(event["type"], "webhook.test")
        self.assertIsNone(parse_webhook_event(self.RAW, "sha256=deadbeef", "whsec_testsecret"))


if __name__ == "__main__":
    unittest.main()
