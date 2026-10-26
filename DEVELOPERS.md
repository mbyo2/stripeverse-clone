# Developer artefacts live in the connectors repo

The BMaGlass Pay **SDKs, plugins and integrations** (TypeScript / Python /
PHP / React Native / Flutter SDKs; WooCommerce, Odoo, Magento, PrestaShop
and OpenCart connectors; the universal embed button; the Zapier/Make pack)
are **not in this repository**. Their public home — and the repo outside
developers should use — is:

**https://github.com/mbyo2/bmaglasspay-connectors**

This app repository keeps only the developer platform itself (the
`developer-api` edge function) and the API contract it serves at
`/openapi.json` (`public/openapi.json`). A copy of that spec also ships in
the connectors repo under `sdk/openapi.json`.

Developer documentation: https://bmaglasspay.online/developers
