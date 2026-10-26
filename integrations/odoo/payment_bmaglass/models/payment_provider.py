# -*- coding: utf-8 -*-
import logging

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

from .bmaglass_api import BMaGlassClient, BMaGlassError, TEST_MODE_MESSAGE

_logger = logging.getLogger(__name__)


class PaymentProvider(models.Model):
    _inherit = "payment.provider"

    code = fields.Selection(
        selection_add=[("bmaglass", "BMaGlass Pay")],
        ondelete={"bmaglass": "set default"},
    )
    bmaglass_api_key = fields.Char(
        string="BMaGlass API key",
        help="Create a key in BMaGlass Pay (Business settings or the API page) with the "
             "wallets:read, payment_links:read and payment_links:write scopes. "
             "A live key (bmp_live_...) is required to take payments.",
        groups="base.group_system",
    )
    bmaglass_webhook_id = fields.Char(string="BMaGlass webhook ID", readonly=True)
    bmaglass_webhook_secret = fields.Char(
        string="BMaGlass webhook secret", readonly=True, groups="base.group_system",
        help="Returned exactly once when the webhook is registered; stored so incoming "
             "events can be HMAC-verified.",
    )

    # -- helpers --------------------------------------------------------
    def _bmaglass_client(self):
        self.ensure_one()
        if not self.bmaglass_api_key:
            raise UserError("Set a BMaGlass API key on the provider first.")
        try:
            return BMaGlassClient(self.bmaglass_api_key.strip())
        except BMaGlassError as e:
            raise UserError(e.user_message())

    def _bmaglass_webhook_url(self):
        base = self.env["ir.config_parameter"].sudo().get_param("web.base.url")
        return "%s/payment/bmaglass/webhook" % base.rstrip("/")

    # -- framework hooks --------------------------------------------------
    def _get_supported_currencies(self):
        """BMaGlass wallets are ZMW and USD — never anything else."""
        currencies = super()._get_supported_currencies()
        if self.code == "bmaglass":
            allowed = self.env["res.currency"].search([("name", "in", ["ZMW", "USD"])])
            return currencies & allowed
        return currencies

    @api.constrains("state", "bmaglass_api_key")
    def _check_bmaglass_enabled_needs_live_key(self):
        """Honest test mode: enabling payments requires a live key.

        A test key may sit on a provider in Odoo's 'test' state for
        connection checks, but it can never take a payment — BMaGlass
        has no test-mode ledger — so 'enabled' demands bmp_live_.
        """
        for provider in self:
            if provider.code != "bmaglass":
                continue
            if provider.state == "enabled":
                key = (provider.bmaglass_api_key or "").strip()
                if not key.startswith("bmp_live_"):
                    raise ValidationError(TEST_MODE_MESSAGE)

    # -- settings actions -------------------------------------------------
    def action_bmaglass_test_connection(self):
        """Read the account's wallets with the configured key."""
        self.ensure_one()
        client = self._bmaglass_client()
        try:
            wallets = client.wallets()
        except BMaGlassError as e:
            raise UserError(e.user_message())
        parts = ["%s %s" % (w.get("currency"), "{:,.2f}".format(float(w.get("balance", 0))))
                 for w in wallets]
        message = "Connected to BMaGlass Pay (%s key). Wallets: %s." % (
            client.mode, " · ".join(parts) or "none")
        if client.mode == "test":
            message += " " + TEST_MODE_MESSAGE
        return {
            "type": "ir.actions.client",
            "tag": "display_notification",
            "params": {"title": "BMaGlass Pay", "message": message, "type": "success", "sticky": False},
        }

    def action_bmaglass_register_webhook(self):
        """Register this Odoo instance's webhook endpoint with BMaGlass."""
        self.ensure_one()
        client = self._bmaglass_client()
        try:
            hook = client.create_webhook(
                self._bmaglass_webhook_url(),
                ["transaction.completed", "payment_link.created", "webhook.test"],
            )
        except BMaGlassError as e:
            raise UserError(e.user_message())
        values = {"bmaglass_webhook_id": hook.get("id")}
        if hook.get("secret"):
            # Shown exactly once by the API — store it now.
            values["bmaglass_webhook_secret"] = hook["secret"]
        self.write(values)
        try:
            client.test_webhook(hook.get("id"))
        except BMaGlassError:
            _logger.info("BMaGlass webhook registered; the test send failed (non-fatal).")
        return {
            "type": "ir.actions.client",
            "tag": "display_notification",
            "params": {
                "title": "BMaGlass Pay",
                "message": "Webhook registered and a signed test event was sent to this instance.",
                "type": "success", "sticky": False,
            },
        }
