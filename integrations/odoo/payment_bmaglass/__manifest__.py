# -*- coding: utf-8 -*-
{
    "name": "Payment Provider: BMaGlass Pay",
    "version": "17.0.1.0.0",
    "category": "Accounting/Payment Providers",
    "summary": "Accept BMaGlass Pay payments — same account, same ZMW/USD wallets — via hosted payment links.",
    "description": """
BMaGlass Pay payment provider for Odoo.

Connects this Odoo instance to the merchant's existing BMaGlass Pay
account through the BMaGlass Pay developer API — the same account and
the same ZMW/USD wallets as the app. Buyers are redirected to a hosted
BMaGlass payment page and pay wallet-to-wallet; settlement is
confirmed by scheduled API reconciliation, and an HMAC-verified
webhook endpoint receives BMaGlass's signed events.

Honest limits: a live API key is required to take payments (test
keys are read-only across BMaGlass Pay — there is no test-mode
ledger); only ZMW and USD transactions are supported, because those
are the currencies BMaGlass wallets hold.
""",
    "author": "BMaGlass Pay",
    "website": "https://bmaglasspay.online/developers",
    "license": "LGPL-3",
    "depends": ["payment"],
    "data": [
        "security/ir.model.access.csv",
        "views/payment_provider_views.xml",
        "views/payment_bmaglass_templates.xml",
        "data/payment_provider_data.xml",
        "data/ir_cron.xml",
    ],
    "application": False,
    "installable": True,
}
