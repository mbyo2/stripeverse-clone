# -*- coding: utf-8 -*-
import logging
from datetime import datetime, timedelta, timezone

from odoo import fields, models

from .bmaglass_api import BMaGlassError, payment_link_url

_logger = logging.getLogger(__name__)


class PaymentTransaction(models.Model):
    _inherit = "payment.transaction"

    bmaglass_link_id = fields.Char(string="BMaGlass payment link ID", readonly=True)
    bmaglass_link_code = fields.Char(string="BMaGlass payment link code", readonly=True)

    # -- checkout ---------------------------------------------------------
    def _bmaglass_create_link(self):
        """Create the per-transaction payment link via the developer API."""
        self.ensure_one()
        provider = self.provider_id
        client = provider._bmaglass_client()
        expires = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        link = client.create_payment_link(
            title="Order %s — %s" % (self.reference, provider.company_id.name or "Odoo"),
            amount=self.amount,
            currency=self.currency_id.name,
            description="Odoo payment %s" % self.reference,
            expires_at=expires,
        )
        self.write({
            "bmaglass_link_id": link.get("id"),
            "bmaglass_link_code": link.get("link_code"),
            "provider_reference": link.get("link_code"),
        })
        return link

    def _get_specific_rendering_values(self, processing_values):
        """Redirect flow: send the buyer to the hosted BMaGlass page."""
        res = super()._get_specific_rendering_values(processing_values)
        if self.provider_code != "bmaglass":
            return res
        try:
            link = self._bmaglass_create_link()
        except BMaGlassError as e:
            # Plain language for the buyer — never a raw API response.
            self._set_error(e.user_message())
            return res
        res["api_url"] = payment_link_url(link.get("link_code"))
        return res

    def _get_specific_processing_values(self, processing_values):
        res = super()._get_specific_processing_values(processing_values)
        if self.provider_code == "bmaglass":
            res["bmaglass_link_code"] = self.bmaglass_link_code
        return res

    # -- reconciliation -----------------------------------------------------
    def _bmaglass_check_paid(self):
        """Settle this transaction if its link shows the money landed.

        Settlement rule, same as the other connectors: payment_count
        has grown AND total_collected covers the transaction amount.
        _set_done() is state-guarded, so repeat runs can't double-settle.
        """
        self.ensure_one()
        if self.state in ("done", "cancel", "error") or not self.bmaglass_link_code:
            return False
        client = self.provider_id._bmaglass_client()
        try:
            links = client.list_payment_links()
        except BMaGlassError as e:
            _logger.warning("BMaGlass reconcile check failed for %s: %s", self.reference, e.user_message())
            return False
        for link in links or []:
            if link.get("link_code") != self.bmaglass_link_code:
                continue
            count = int(link.get("payment_count") or 0)
            collected = float(link.get("total_collected") or 0.0)
            if count > 0 and collected + 0.009 >= float(self.amount):
                self._set_done()
                self._log_message_on_transaction(
                    "BMaGlass Pay payment confirmed by reconciliation — link %s, collected %s %s."
                    % (self.bmaglass_link_code, "{:,.2f}".format(collected), self.currency_id.name)
                )
                return True
            return False
        return False

    def _bmaglass_reconcile_pending(self):
        """Cron entry point: sweep unsettled BMaGlass transactions.

        The developer API does not yet emit a 'payment link paid'
        webhook event, so settlement is confirmed by this scheduled
        reconciliation (the signed webhook endpoint is live and will
        carry the event the moment the API adds it).
        """
        providers = self.env["payment.provider"].search([("code", "=", "bmaglass")])
        txs = self.search([
            ("provider_id", "in", providers.ids),
            ("state", "in", ("pending", "draft")),
            ("bmaglass_link_code", "!=", False),
            ("create_date", ">", fields.Datetime.now() - timedelta(days=7)),
        ], limit=100)
        for tx in txs:
            try:
                tx._bmaglass_check_paid()
            except Exception:  # one bad tx must not stop the sweep
                _logger.exception("BMaGlass reconcile failed for tx %s", tx.reference)
