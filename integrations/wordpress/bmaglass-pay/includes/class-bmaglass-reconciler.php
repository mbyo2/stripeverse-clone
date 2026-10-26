<?php
/**
 * Order/payment settlement for BMaGlass Pay.
 *
 * Primary path (push): the developer API emits a signed
 * `payment_link.paid` webhook the moment a link is paid;
 * complete_order_from_event() finishes the matching order immediately.
 *
 * Fallback path (poll): reconciliation checks the link's counters via
 * the API — when payment_count has grown past what we last saw AND
 * total_collected covers the order total, the order is completed.
 * It runs on WP-Cron, on the thank-you page and from the order action,
 * and covers any webhook delivery the site missed.
 *
 * Both paths complete the order EXACTLY ONCE (status + settled-flag
 * guard), with the link code as the transaction reference, so the two
 * paths racing the same payment cannot double-complete it.
 *
 * @package BMaGlassPay
 */

if (!defined('ABSPATH')) {
    exit;
}

class BMaGlass_Reconciler
{
    /** Fetch the payment-link row for an order, or null. */
    private static function fetch_link(BMaGlassClient $client, $linkCode)
    {
        $links = $client->listPaymentLinks();
        if (!is_array($links)) {
            return null;
        }
        foreach ($links as $link) {
            if (isset($link['link_code']) && $link['link_code'] === $linkCode) {
                return $link;
            }
        }
        return null;
    }

    /**
     * Check one order; completes it when its link has been paid.
     * Returns true when the order is settled after this check.
     */
    public static function reconcile_order($order, BMaGlassClient $client)
    {
        if (!$order || $order->get_meta('_bmaglass_settled') === 'yes') {
            return $order && $order->get_meta('_bmaglass_settled') === 'yes';
        }
        if (!in_array($order->get_status(), array('on-hold', 'pending'), true)) {
            return false;
        }
        $code = (string) $order->get_meta('_bmaglass_link_code');
        if ($code === '') {
            return false;
        }
        try {
            $link = self::fetch_link($client, $code);
        } catch (BMaGlassApiException $e) {
            $order->add_order_note('BMaGlass: settlement check failed — ' . $e->userMessage());
            return false;
        }
        if ($link === null) {
            return false;
        }
        $seen = (int) $order->get_meta('_bmaglass_payment_count_seen');
        $count = isset($link['payment_count']) ? (int) $link['payment_count'] : 0;
        $collected = isset($link['total_collected']) ? (float) $link['total_collected'] : 0.0;
        $total = round((float) $order->get_total(), 2);

        if ($count > $seen) {
            $order->update_meta_data('_bmaglass_payment_count_seen', $count);
        }
        if ($count > 0 && $collected + 0.009 >= $total) {
            $order->update_meta_data('_bmaglass_settled', 'yes');
            $order->payment_complete($code);
            $order->add_order_note(sprintf(
                'BMaGlass Pay payment confirmed by reconciliation — link %s, collected %s %s.',
                $code,
                number_format($collected, 2),
                $order->get_currency()
            ));
            $order->save();
            return true;
        }
        $order->save();
        return false;
    }

    /** Find the unsettled order carrying a link code, or null. */
    public static function find_order_by_link_code($linkCode)
    {
        $orders = wc_get_orders(array(
            'limit' => 1,
            'status' => array('on-hold', 'pending'),
            'meta_query' => array(
                array('key' => '_bmaglass_link_code', 'value' => (string) $linkCode),
            ),
        ));
        return $orders ? $orders[0] : null;
    }

    /**
     * Complete an order directly from a verified payment_link.paid
     * event. The webhook route HMAC-verified the payload before this
     * runs; we still cross-check the link code, currency and amount
     * against the order before completing. The settled flag is
     * persisted BEFORE payment_complete so a racing reconciler pass
     * (or a duplicate delivery) sees the claim and stands down.
     *
     * Returns true when the order is settled after this call —
     * including "was already settled" — and false when the event does
     * not match a completable order (the caller then falls back to
     * API reconciliation for the order).
     */
    public static function complete_order_from_event($linkCode, $amount, $currency)
    {
        $order = self::find_order_by_link_code($linkCode);
        if (!$order) {
            return false;
        }
        if ($order->get_meta('_bmaglass_settled') === 'yes') {
            return true;
        }
        if (strtoupper((string) $currency) !== strtoupper((string) $order->get_currency())) {
            return false;
        }
        if ((float) $amount + 0.009 < round((float) $order->get_total(), 2)) {
            return false;
        }
        $order->update_meta_data('_bmaglass_settled', 'yes');
        $order->save();
        $order->payment_complete((string) $linkCode);
        $order->add_order_note(sprintf(
            'BMaGlass Pay payment confirmed by webhook (payment_link.paid) — link %s, %s %s.',
            $linkCode,
            number_format((float) $amount, 2),
            strtoupper((string) $currency)
        ));
        $order->save();
        return true;
    }

    /** Cron entry point: sweep recent unsettled BMaGlass orders. */
    public static function reconcile_pending()
    {
        $gateways = WC()->payment_gateways()->payment_gateways();
        if (!isset($gateways['bmaglass'])) {
            return;
        }
        $client = $gateways['bmaglass']->client();
        if ($client === null || !$client->isLive()) {
            return;
        }
        $orders = wc_get_orders(array(
            'status' => array('on-hold', 'pending'),
            'limit' => 50,
            'date_created' => '>' . (time() - 7 * DAY_IN_SECONDS),
            'meta_query' => array(
                array('key' => '_bmaglass_link_code', 'compare' => 'EXISTS'),
                array('key' => '_bmaglass_settled', 'compare' => 'NOT EXISTS'),
            ),
        ));
        foreach ($orders as $order) {
            self::reconcile_order($order, $client);
        }
    }
}
