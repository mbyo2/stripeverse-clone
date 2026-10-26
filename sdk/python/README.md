# bmaglass-sdk (Python)

Python client for the BMaGlass Pay Developer API. Install: `pip install ./sdk/python`.

```python
from bmaglass_sdk import BMaGlass, verify_webhook_signature

client = BMaGlass("bmp_test_...")  # test keys are read-only
print(client.wallets.list())
print(client.bitcoin.quote("buy", amount_zmw=100))

# Webhook handler:
ok = verify_webhook_signature(request.data, request.headers["X-BMaGlass-Signature"], webhook_secret)
```

Tests: `python3 -m unittest discover sdk/tests -v` from the repo root.
Errors raise `BMaGlassError` with `.status` and `.code` (e.g. `test_mode_read_only`).
