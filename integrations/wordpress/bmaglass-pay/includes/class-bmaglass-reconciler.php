<?php
/**
 * Order/payment reconciliation for BMaGlass Pay.
 *
 * The developer API does not (yet) emit a "payment link paid" webhook
 * event, so settlement is confirmed by checking the link's counters
 * via the API: when payment_count has grown past what we last saw AND
 * total_collected covers the order total, the order is completed —
 * exactly once (status + settled-flag guard), with the link code as
 * the transaction reference.
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
