<?php
/**
 * Webhook receiver. Verifies the HMAC signature, then settles: a
 * payment_link.paid event completes its order immediately via a
 * targeted reconciliation of that link (settlement itself is always
 * confirmed via the API — exactly once); any other valid event
 * nudges a full reconciliation pass.
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
        $event = json_decode($raw, true);
        if (is_array($event)
            && ($event['type'] ?? '') === 'payment_link.paid'
            && !empty($event['data']['link_code'])) {
            $this->module->reconcileOrderByLink((string) $event['data']['link_code']);
        } else {
            $this->module->reconcilePendingOrders();
        }
        http_response_code(200);
        die('ok');
    }
}
