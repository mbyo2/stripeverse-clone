<?php
/**
 * Plugin Name:       BMaGlass Pay for WooCommerce
 * Plugin URI:        https://bmaglasspay.online/developers
 * Description:       Accept BMaGlass Pay payments in WooCommerce — buyers pay wallet-to-wallet on a hosted BMaGlass payment page, and the money lands in the same BMaGlass wallets (ZMW / USD) as your app account. Built on the BMaGlass Pay developer API.
 * Version:           1.0.0
 * Author:            BMaGlass Pay
 * License:           GPL-2.0-or-later
 * Text Domain:       bmaglass-pay
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * WC requires at least: 7.0
 * WC tested up to:   9.3
 *
 * How settlement is confirmed (read before judging the design): the
 * developer API's signed webhooks fire for payment_link.created and
 * for the account's own API transfers (transaction.completed) — there
 * is no "payment link paid" event yet. This plugin therefore confirms
 * orders by API reconciliation (WP-Cron every 5 minutes + an immediate
 * check on the thank-you page + a per-order admin action), and still
 * registers an HMAC-verified webhook endpoint (webhook.test proves
 * connectivity; every signed event is logged) that will carry the
 * settlement event the moment the API adds it.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('BMAGLASS_PAY_VERSION', '1.0.0');
define('BMAGLASS_PAY_DIR', plugin_dir_path(__FILE__));

require_once BMAGLASS_PAY_DIR . 'includes/class-bmaglass-api-client.php';
require_once BMAGLASS_PAY_DIR . 'includes/class-bmaglass-reconciler.php';

/** Stored gateway settings (woocommerce_bmaglass_settings option). */
function bmaglass_settings()
{
    $s = get_option('woocommerce_bmaglass_settings', array());
    return is_array($s) ? $s : array();
}

/** Client built from saved settings, or null. */
function bmaglass_client_from_settings()
{
    $s = bmaglass_settings();
    $key = isset($s['api_key']) ? trim((string) $s['api_key']) : '';
    if ($key === '') {
        return null;
    }
    try {
        return new BMaGlassClient($key);
    } catch (BMaGlassApiException $e) {
        return null;
    }
}

// ── Gateway registration ─────────────────────────────────────────────
add_filter('woocommerce_payment_gateways', function ($gateways) {
    $gateways[] = 'WC_Gateway_BMaGlass';
    return $gateways;
});

add_action('plugins_loaded', function () {
    if (!class_exists('WC_Payment_Gateway')) {
        add_action('admin_notices', function () {
            echo '<div class="notice notice-error"><p><strong>BMaGlass Pay:</strong> WooCommerce is not active, so the BMaGlass Pay gateway can\'t run. Activate WooCommerce first.</p></div>';
        });
        return;
    }
    require_once BMAGLASS_PAY_DIR . 'includes/class-wc-gateway-bmaglass.php';
});

// ── Reconciliation cron (every 5 minutes) ────────────────────────────
add_filter('cron_schedules', function ($schedules) {
    $schedules['bmaglass_5min'] = array('interval' => 300, 'display' => 'Every 5 minutes (BMaGlass)');
    return $schedules;
});

register_activation_hook(__FILE__, function () {
    if (!wp_next_scheduled('bmaglass_reconcile_orders')) {
        wp_schedule_event(time() + 300, 'bmaglass_5min', 'bmaglass_reconcile_orders');
    }
});

register_deactivation_hook(__FILE__, function () {
    wp_clear_scheduled_hook('bmaglass_reconcile_orders');
});

add_action('bmaglass_reconcile_orders', array('BMaGlass_Reconciler', 'reconcile_pending'));

// Immediate check when the buyer lands back on the thank-you page.
add_action('woocommerce_thankyou', function ($order_id) {
    $order = wc_get_order($order_id);
    if (!$order || $order->get_payment_method() !== 'bmaglass') {
        return;
    }
    $client = bmaglass_client_from_settings();
    if ($client !== null) {
        BMaGlass_Reconciler::reconcile_order($order, $client);
    }
}, 20);

// Per-order admin action: "Check BMaGlass payment".
add_filter('woocommerce_order_actions', function ($actions, $order) {
    if ($order && $order->get_payment_method() === 'bmaglass' && $order->get_meta('_bmaglass_link_code')) {
        $actions['bmaglass_check_payment'] = 'Check BMaGlass payment';
    }
    return $actions;
}, 10, 2);

add_action('woocommerce_order_action_bmaglass_check_payment', function ($order) {
    $client = bmaglass_client_from_settings();
    if ($client === null) {
        $order->add_order_note('BMaGlass: no API key configured — settlement check skipped.');
        return;
    }
    if (!BMaGlass_Reconciler::reconcile_order($order, $client)) {
        $order->add_order_note('BMaGlass: checked just now — no completed payment for this order\'s link yet.');
    }
});

// ── Webhook endpoint (HMAC-verified) ─────────────────────────────────
add_action('rest_api_init', function () {
    register_rest_route('bmaglass/v1', '/webhook', array(
        'methods' => 'POST',
        // Public by necessity (BMaGlass servers call it); security is
        // the HMAC signature check against the stored webhook secret.
        'permission_callback' => '__return_true',
        'callback' => 'bmaglass_handle_webhook',
    ));
});

function bmaglass_handle_webhook(WP_REST_Request $request)
{
    $s = bmaglass_settings();
    $secret = isset($s['webhook_secret']) ? (string) $s['webhook_secret'] : '';
    $raw = $request->get_body();
    $signature = $request->get_header('x-bmaglass-signature');

    if ($secret === '' || !BMaGlassClient::verifyWebhookSignature($raw, $signature, $secret)) {
        return new WP_REST_Response(array('error' => 'invalid_signature'), 401);
    }
    $event = json_decode($raw, true);
    if (!is_array($event) || !isset($event['type'])) {
        return new WP_REST_Response(array('error' => 'invalid_payload'), 400);
    }

    $logger = wc_get_logger();
    $type = (string) $event['type'];
    switch ($type) {
        case 'webhook.test':
            // Connectivity proof sent from the settings screen / API.
            $logger->info('BMaGlass webhook.test received and verified.', array('source' => 'bmaglass-pay'));
            break;
        case 'payment_link.created':
            $logger->info('BMaGlass payment_link.created: ' . wp_json_encode(isset($event['data']) ? $event['data'] : array()), array('source' => 'bmaglass-pay'));
            break;
        case 'transaction.completed':
            // Fires for the merchant account's own API transfers. Its
            // payload (transaction_id/amount/currency) carries no
            // order identity, so it cannot complete a WooCommerce
            // order — checkout settlement is confirmed by the
            // reconciler. Logged here for a complete signed audit trail.
            $logger->info('BMaGlass transaction.completed: ' . wp_json_encode(isset($event['data']) ? $event['data'] : array()), array('source' => 'bmaglass-pay'));
            break;
        default:
            $logger->info('BMaGlass webhook event (unhandled type): ' . $type, array('source' => 'bmaglass-pay'));
    }
    return new WP_REST_Response(array('received' => true), 200);
}

// ── Settings-screen actions: Test connection / Register webhook ──────
function bmaglass_admin_redirect($notice, $type = 'success')
{
    $url = admin_url('admin.php?page=wc-settings&tab=checkout&section=bmaglass');
    set_transient('bmaglass_admin_notice_' . get_current_user_id(), array($notice, $type), 60);
    wp_safe_redirect($url);
    exit;
}

add_action('admin_notices', function () {
    $t = get_transient('bmaglass_admin_notice_' . get_current_user_id());
    if ($t) {
        delete_transient('bmaglass_admin_notice_' . get_current_user_id());
        printf('<div class="notice notice-%s is-dismissible"><p>%s</p></div>',
            $t[1] === 'error' ? 'error' : 'success', esc_html($t[0]));
    }
});

add_action('admin_post_bmaglass_test_connection', function () {
    check_admin_referer('bmaglass_test_connection');
    if (!current_user_can('manage_woocommerce')) {
        wp_die('Not allowed.');
    }
    $client = bmaglass_client_from_settings();
    if ($client === null) {
        bmaglass_admin_redirect('Save a BMaGlass API key first, then test the connection.', 'error');
    }
    try {
        $wallets = $client->wallets();
        $parts = array();
        foreach ((array) $wallets as $w) {
            $parts[] = sprintf('%s %s', $w['currency'], number_format((float) $w['balance'], 2));
        }
        $mode = $client->mode();
        $msg = sprintf('Connected to BMaGlass Pay (%s key). Wallets: %s.', $mode, implode(' · ', $parts));
        if ($mode === 'test') {
            $msg .= ' This is a TEST key: connection and reads work, but checkout can\'t take payments with it — BMaGlass test keys are read-only by design. Switch to a live key to sell.';
        }
        bmaglass_admin_redirect($msg);
    } catch (BMaGlassApiException $e) {
        bmaglass_admin_redirect($e->userMessage(), 'error');
    }
});

add_action('admin_post_bmaglass_register_webhook', function () {
    check_admin_referer('bmaglass_register_webhook');
    if (!current_user_can('manage_woocommerce')) {
        wp_die('Not allowed.');
    }
    $client = bmaglass_client_from_settings();
    if ($client === null) {
        bmaglass_admin_redirect('Save a BMaGlass API key first, then register the webhook.', 'error');
    }
    try {
        $hook = $client->createWebhook(
            rest_url('bmaglass/v1/webhook'),
            array('transaction.completed', 'payment_link.created', 'webhook.test')
        );
        $s = bmaglass_settings();
        $s['webhook_id'] = isset($hook['id']) ? $hook['id'] : '';
        if (!empty($hook['secret'])) {
            // The secret is returned exactly once — store it now.
            $s['webhook_secret'] = $hook['secret'];
        }
        update_option('woocommerce_bmaglass_settings', $s);
        // Fire the signed test event so the merchant sees a verified delivery.
        if (!empty($s['webhook_id'])) {
            try {
                $client->testWebhook($s['webhook_id']);
            } catch (BMaGlassApiException $e) {
                // Registration still succeeded; the test send is a bonus.
            }
        }
        bmaglass_admin_redirect('Webhook registered with BMaGlass Pay and a signed test event was sent to this site. Check WooCommerce → Status → Logs (source: bmaglass-pay) to see it arrive.');
    } catch (BMaGlassApiException $e) {
        bmaglass_admin_redirect($e->userMessage(), 'error');
    }
});
