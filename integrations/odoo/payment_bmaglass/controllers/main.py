# -*- coding: utf-8 -*-
import json
import logging

from odoo import http
from odoo.http import request

from ..models.bmaglass_api import parse_webhook_event

_logger = logging.getLogger(__name__)


class BMaGlassPayController(http.Controller):
    """Signed webhook receiver for BMaGlass developer webhooks.

    Security is the HMAC-SHA256 signature (X-BMaGlass-Signature) over
    the exact raw body, checked against the secret stored on the
    provider when the webhook was registered. Events today:
    webhook.test (connectivity proof), payment_link.created,
    transaction.completed (the account's own API transfers — its
    payload carries no sale/order identity, so it cannot settle a
    payment transaction), and payment_link.paid — the settlement
    event: it settles the matching payment transaction immediately
    (models/payment_transaction.py), with the reconciliation cron
    kept as the fallback for any missed delivery. Every verified
    event is logged.
    """

    @http.route("/payment/bmaglass/webhook", type="http", auth="public",
                methods=["POST"], csrf=False)
    def bmaglass_webhook(self):
        provider = request.env["payment.provider"].sudo().search(
            [("code", "=", "bmaglass")], limit=1)
        secret = provider.bmaglass_webhook_secret if provider else ""
        raw = request.httprequest.get_data(cache=False, as_text=False)
        signature = request.httprequest.headers.get("X-BMaGlass-Signature", "")

        event = parse_webhook_event(raw, signature, secret or "")
        if event is None:
            _logger.warning("BMaGlass webhook rejected: bad signature or payload.")
            return request.make_response(
                json.dumps({"error": "invalid_signature"}),
                headers=[("Content-Type", "application/json")], status=401)

        etype = event.get("type")
        data = event.get("data") or {}
        if etype == "webhook.test":
            _logger.info("BMaGlass webhook.test received and verified.")
        elif etype == "payment_link.paid":
            tx = request.env["payment.transaction"].sudo().search(
                [("bmaglass_link_code", "=", data.get("link_code"))], limit=1)
            if tx:
                settled = tx._bmaglass_settle_from_paid_event(data)
                if not settled:
                    # The event's checks declined it — verify against
                    # the API instead of trusting the payload further.
                    tx._bmaglass_check_paid()
            else:
                _logger.info(
                    "BMaGlass payment_link.paid for unknown link %s.", data.get("link_code"))
        elif etype == "payment_link.created":
            _logger.info("BMaGlass payment_link.created: link %s.", data.get("link_code"))
            tx = request.env["payment.transaction"].sudo().search(
                [("bmaglass_link_code", "=", data.get("link_code"))], limit=1)
            if tx:
                # Opportunistic fast-path: the link exists; the cron
                # remains the settler, this just checks a beat early.
                tx._bmaglass_check_paid()
        else:
            _logger.info("BMaGlass webhook event received: %s.", etype)

        return request.make_response(
            json.dumps({"received": True}),
            headers=[("Content-Type", "application/json")], status=200)
