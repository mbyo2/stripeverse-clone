<?php
/**
 * Webhook receiver. Verifies the HMAC signature, then nudges a
 * reconciliation pass (settlement itself is confirmed via the API —
 * exactly once — because link payments carry no per-link webhook
 * identity today).
 */

require_once _PS_MODULE_DIR_ . 'bmaglasspay/classes/sdk/ApiException.php';
require_once _PS_MODULE_DIR_ . 'bmaglasspay/classes/sdk/Client.php';

use BMaGlass\Sdk\Client;

class BmaglasspayWebhookModuleFrontController extends ModuleFrontController
{
    public function initContent()
    {
        $raw = (string) file_get_contents('php://input');
        $signature = isset($_SERVER['HTTP_X_BMGLASS_SIGNATURE']) ? (string) $_SERVER['HTTP_X_BMGLASS_SIGNATURE'] : '';
        $secret = $this->module->webhookSecret();
        header('Content-Type: text/plain');
        if ($secret === '' || !Client::verifyWebhookSignature($raw, $signature, $secret)) {
            http_response_code(400);
            die('invalid signature');
        }
        $this->module->reconcilePendingOrders();
        http_response_code(200);
        die('ok');
    }
}
