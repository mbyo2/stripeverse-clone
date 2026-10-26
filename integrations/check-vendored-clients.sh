#!/usr/bin/env bash
# Verify that every PHP connector's vendored API client is the PHP
# SDK client — byte-identical where the platform allows the
# BMaGlass\Sdk namespace, equal-after-namespace-normalisation where
# the platform's autoloader dictates its own namespace (Magento).
# This is the "client-level reuse proof" for the PHP connectors.
set -u
cd "$(dirname "$0")/.."
fail=0

check_verbatim() {
    if diff -q "sdk/php/src/$2" "$1/$2" >/dev/null; then
        echo "OK   verbatim  $1/$2"
    else
        echo "FAIL drift     $1/$2 differs from sdk/php/src/$2"; fail=1
    fi
}

check_namespaced() {
    if diff <(sed 's/^namespace BMaGlass\\Pay\\Model\\Api;/namespace BMaGlass\\Sdk;/' "$1/$2") "sdk/php/src/$2" >/dev/null; then
        echo "OK   namespaced $1/$2 (equal modulo namespace)"
    else
        echo "FAIL drift     $1/$2 differs from sdk/php/src/$2 beyond the namespace"; fail=1
    fi
}

# Note: the WooCommerce plugin's client (class-bmaglass-api-client.php)
# is the SDK's origin, not a vendored copy — it is covered by its own
# unit tests + the live protocol proof instead.

for f in Client.php ApiException.php; do
    check_verbatim integrations/prestashop/bmaglasspay/classes/sdk "$f"
    check_verbatim integrations/opencart/upload/system/library/bmaglass "$f"
    check_namespaced integrations/magento/BMaGlass/Pay/Model/Api "$f"
done

exit $fail
