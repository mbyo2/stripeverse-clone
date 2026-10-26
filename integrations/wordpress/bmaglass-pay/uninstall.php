<?php
/**
 * BMaGlass Pay for WooCommerce — uninstall.
 * Removes the gateway settings (which hold the API key + webhook
 * secret) and the reconciliation schedule. Order meta is kept: it is
 * the store's own payment audit trail.
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

delete_option('woocommerce_bmaglass_settings');
wp_clear_scheduled_hook('bmaglass_reconcile_orders');
