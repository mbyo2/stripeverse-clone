<?php
/**
 * Standalone tests for the PHP SDK (sdk/php). Uses a minimal PSR-4
 * autoloader (no Composer binary needed) and a stub transport that
 * mirrors the developer-api contract, like the TS/Python SDK tests.
 *
 * Run: php sdk/php/tests/run-tests.php
 */

spl_autoload_register(function ($class) {
    $prefix = 'BMaGlass\\Sdk\\';
    if (strpos($class, $prefix) === 0) {
        $file = dirname(__DIR__) . '/src/' . substr($class, strlen($prefix)) . '.php';
        if (file_exists($file)) require $file;
    }
});

use BMaGlass\Sdk\ApiException;
use BMaGlass\Sdk\Client;

$failures = 0;
function check($label, $cond)
{
    global $failures;
    if ($cond) { echo "PASS  $label\n"; } else { $failures++; echo "FAIL  $label\n"; }
}
function eq($label, $a, $b) { check($label . ' (got ' . var_export($a, true) . ')', $a === $b); }

$calls = array();
$transport = function ($method, $url, $headers, $body) use (&$calls) {
    $calls[] = array('method' => $method, 'url' => $url, 'headers' => $headers, 'body' => $body);
    $flat = implode(' ', $headers);
    if (strpos($flat, 'bmp_test_contract') === false && strpos($flat, 'bmp_live_contract') === false) {
        return array(401, json_encode(array('error' => 'invalid_api_key', 'message' => 'nope')));
    }
    if (str_ends_with($url, '/wallets')) {
        return array(200, json_encode(array('data' => array(array('id' => 'w1', 'currency' => 'ZMW', 'balance' => 42)), 'mode' => 'test')));
    }
    if (str_ends_with($url, '/payment-links') && $method === 'POST') {
        if (strpos($flat, 'bmp_test_') !== false) {
            return array(403, json_encode(array('error' => 'test_mode_read_only', 'message' => 'Test keys are read-only')));
        }
        $req = json_decode($body, true);
        return array(201, json_encode(array('data' => array('id' => 'pl1', 'title' => $req['title'], 'amount' => $req['amount'], 'currency' => $req['currency'], 'link_code' => 'ABC123'), 'mode' => 'live')));
    }
    if (str_ends_with($url, '/transfers')) {
        return array(201, json_encode(array('data' => array('transaction_id' => 'tx1'), 'mode' => 'live')));
    }
    return array(404, json_encode(array('error' => 'not_found', 'message' => 'no route')));
};

$test = new Client('bmp_test_contract', 'http://local.test', $transport);
eq('test key mode', $test->mode(), 'test');
eq('live key mode', (new Client('bmp_live_contract', 'http://local.test', $transport))->mode(), 'live');
try {
    new Client('sk_live_nope', 'http://local.test', $transport);
    check('non-bmaglass key rejected', false);
} catch (ApiException $e) {
    eq('non-bmaglass key rejected', $e->errorCode, 'invalid_api_key');
}

$wallets = $test->wallets();
eq('wallets balance', $wallets[0]['balance'], 42);
$last = end($calls);
check('X-Api-Key header sent', strpos(implode(' ', $last['headers']), 'X-Api-Key: bmp_test_contract') !== false);

$live = new Client('bmp_live_contract', 'http://local.test', $transport);
$link = $live->createPaymentLink('Order #7', 10.5, 'zmw');
eq('link code', $link['link_code'], 'ABC123');
eq('link URL', Client::paymentLinkUrl('ABC123'), 'https://bmaglasspay.online/pay/ABC123');

try {
    $test->createPaymentLink('Nope', 5, 'ZMW');
    check('test-key write throws', false);
} catch (ApiException $e) {
    eq('test-key code', $e->errorCode, 'test_mode_read_only');
    check('userMessage honest', strpos($e->userMessage(), 'no test-mode ledger') !== false);
}

try {
    $live->createPaymentLink('Euro', 5, 'EUR');
    check('EUR refused', false);
} catch (ApiException $e) {
    eq('EUR code', $e->errorCode, 'unsupported_currency');
}

$live->createTransfer('user-2', 25, 'ZMW', null, null, 'idem-7');
$last = end($calls);
check('Idempotency-Key header', strpos(implode(' ', $last['headers']), 'Idempotency-Key: idem-7') !== false);

// Shared cross-SDK HMAC known-answer vector.
$raw = '{"id":"evt_1","type":"webhook.test","created":"2026-10-26T00:00:00.000Z","data":{"ping":true}}';
$sig = 'sha256=ff522c97ada5bfd4f6c09a0457823f89546896708e8e1f5bbb72d2ad59d68535';
check('KAT verifies', Client::verifyWebhookSignature($raw, $sig, 'whsec_testsecret'));
check('KAT wrong secret fails', !Client::verifyWebhookSignature($raw, $sig, 'whsec_wrong'));
$event = Client::parseWebhookEvent($raw, $sig, 'whsec_testsecret');
eq('KAT event type', $event['type'], 'webhook.test');

echo $failures === 0 ? "\nALL PHP SDK TESTS PASSED\n" : "\n$failures FAILURE(S)\n";
exit($failures === 0 ? 0 : 1);
