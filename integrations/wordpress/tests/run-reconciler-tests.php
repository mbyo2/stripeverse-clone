<?php
/**
 * Standalone tests for the BMaGlass WooCommerce reconciler — the
 * settlement logic (payment_link.paid webhook path + polling
 * fallback). No WordPress: ABSPATH is defined here and the small
 * WP/WC surface the reconciler touches (wc_get_orders + the order
 * object) is stubbed with the same semantics WooCommerce has —
 * notably payment_complete() only transitioning an unpaid order.
 *
 * Run: php integrations/wordpress/tests/run-reconciler-tests.php
 */

define('ABSPATH', __DIR__ . '/');
error_reporting(E_ALL & ~E_DEPRECATED);

require_once dirname(__DIR__) . '/bmaglass-pay/includes/class-bmaglass-api-client.php';
require_once dirname(__DIR__) . '/bmaglass-pay/includes/class-bmaglass-reconciler.php';

$failures = 0;
function check($label, $cond)
{
    global $failures;
    if ($cond) {
        echo "PASS  $label\n";
    } else {
        $failures++;
        echo "FAIL  $label\n";
    }
}

// ── Stubs ────────────────────────────────────────────────────────────
class FakeOrder
{
    public $meta = array();
    public $status;
    public $total;
    public $currency;
    public $complete_calls = 0;
    public $notes = array();

    public function __construct($status, $total, $currency, $meta)
    {
        $this->status = $status;
        $this->total = $total;
        $this->currency = $currency;
        $this->meta = $meta;
    }
    public function get_meta($k) { return isset($this->meta[$k]) ? $this->meta[$k] : ''; }
    public function update_meta_data($k, $v) { $this->meta[$k] = $v; }
    public function get_status() { return $this->status; }
    public function get_total() { return $this->total; }
    public function get_currency() { return $this->currency; }
    public function add_order_note($n) { $this->notes[] = $n; }
    public function save() {}
    /** Mirrors WC: only an unpaid order transitions (and counts). */
    public function payment_complete($txn = '')
    {
        if (!in_array($this->status, array('on-hold', 'pending'), true)) {
            return false;
        }
        $this->status = 'processing';
        $this->complete_calls++;
        return true;
    }
}

$GLOBALS['orders'] = array();
function wc_get_orders($args)
{
    $out = array();
    $wantCode = null;
    if (!empty($args['meta_query'])) {
        foreach ($args['meta_query'] as $clause) {
            if (isset($clause['key']) && $clause['key'] === '_bmaglass_link_code' && isset($clause['value'])) {
                $wantCode = $clause['value'];
            }
        }
    }
    foreach ($GLOBALS['orders'] as $order) {
        if (isset($args['status']) && !in_array($order->get_status(), $args['status'], true)) {
            continue;
        }
        if ($wantCode !== null && $order->get_meta('_bmaglass_link_code') !== $wantCode) {
            continue;
        }
        $out[] = $order;
    }
    if (!empty($args['limit'])) {
        $out = array_slice($out, 0, $args['limit']);
    }
    return $out;
}

/** Client whose transport reports one paid link: LK1, count 1, K5 collected. */
function paid_link_client()
{
    $transport = function ($method, $url, $headers, $body) {
        if (str_ends_with($url, '/payment-links') && $method === 'GET') {
            return array(200, json_encode(array('data' => array(
                array('id' => 'pl1', 'link_code' => 'LK1', 'payment_count' => 1, 'total_collected' => 5),
            ), 'mode' => 'live')));
        }
        return array(404, json_encode(array('error' => 'not_found', 'message' => 'no route')));
    };
    return new BMaGlassClient('bmp_live_reconciler_test', null, $transport);
}

function fresh_order()
{
    $order = new FakeOrder('on-hold', 5.00, 'ZMW', array('_bmaglass_link_code' => 'LK1'));
    $GLOBALS['orders'] = array($order);
    return $order;
}

// ── payment_link.paid webhook path ───────────────────────────────────
$order = fresh_order();
check('paid event completes the matching order',
    BMaGlass_Reconciler::complete_order_from_event('LK1', 5, 'ZMW') === true
    && $order->complete_calls === 1
    && $order->get_meta('_bmaglass_settled') === 'yes'
    && strpos(implode(' ', $order->notes), 'payment_link.paid') !== false);

check('duplicate paid event does NOT complete twice',
    BMaGlass_Reconciler::complete_order_from_event('LK1', 5, 'ZMW') === false
    && $order->complete_calls === 1);

$order = fresh_order();
check('paid event with too-small amount is declined',
    BMaGlass_Reconciler::complete_order_from_event('LK1', 2, 'ZMW') === false
    && $order->complete_calls === 0);

$order = fresh_order();
check('paid event with wrong currency is declined',
    BMaGlass_Reconciler::complete_order_from_event('LK1', 5, 'USD') === false
    && $order->complete_calls === 0);

check('paid event for an unknown link is declined',
    BMaGlass_Reconciler::complete_order_from_event('NOPE', 5, 'ZMW') === false);

// ── Polling fallback still works, and cannot double-complete ─────────
$order = fresh_order();
$client = paid_link_client();
check('polling reconciliation completes a paid order',
    BMaGlass_Reconciler::reconcile_order($order, $client) === true
    && $order->complete_calls === 1);
check('polling after completion is a no-op (settled flag)',
    BMaGlass_Reconciler::reconcile_order($order, $client) === true
    && $order->complete_calls === 1);

$order = fresh_order();
check('webhook settles first...',
    BMaGlass_Reconciler::complete_order_from_event('LK1', 5, 'ZMW') === true);
check('...then polling stands down (no double-complete)',
    BMaGlass_Reconciler::reconcile_order($order, $client) === true
    && $order->complete_calls === 1);

echo $failures === 0 ? "\nALL PASS\n" : "\n$failures FAILURE(S)\n";
exit($failures === 0 ? 0 : 1);
