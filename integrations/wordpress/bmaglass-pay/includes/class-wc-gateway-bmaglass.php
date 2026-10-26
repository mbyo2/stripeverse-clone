<?php
/**
 * WooCommerce payment gateway: BMaGlass Pay.
 *
 * Checkout flow (honest about how the API works today):
 *  1. The gateway creates ONE BMaGlass payment link for the exact
 *     order total (live key required) and redirects the buyer to the
 *     hosted BMaGlass payment page, where they pay wallet-to-wallet
 *     from their BMaGlass Pay account.
 *  2. The order is confirmed by reconciliation: a WP-Cron job (plus an
 *     immediate check on the thank-you page and a "Check BMaGlass
 *     payment" order action) polls the API for the link's
 *     payment_count / total_collected and completes the order exactly
 *     once when the money has landed.
 *
 * Why polling? The developer API's signed webhooks today fire for
 * payment_link.created and for the account's own API transfers
 * (transaction.completed) — the API does not yet emit a "link paid"
 * event, so no honest webhook-only design exists. This plugin still
 * registers an HMAC-verified webhook endpoint (connectivity proof via
 * webhook.test, signed event log) so it is ready the day the API
 * adds that event. See README.md.
 *
 * @package BMaGlassPay
 */

if (!defined('ABSPATH')) {
    exit;
}

class WC_Gateway_BMaGlass extends WC_Payment_Gateway
{
    public function __construct()
    {
        $this->id = 'bmaglass';
        $this->method_title = 'BMaGlass Pay';
        $this->method_description = 'Accept payments into your BMaGlass Pay wallets (ZMW / USD) via hosted BMaGlass payment links. '
            . 'Uses the developer API key from your BMaGlass Pay account — the same account and wallets as the app.';
        $this->has_fields = false;
        $this->supports = array('products');

        $this->init_form_fields();
        $this->init_settings();

        $this->enabled = $this->get_option('enabled');
        $this->title = $this->get_option('title');
        $this->description = $this->get_option('description');

        add_action('woocommerce_update_options_payment_gateways_' . $this->id, array($this, 'process_admin_options'));
    }

    public function init_form_fields()
    {
        $this->form_fields = array(
            'enabled' => array(
                'title' => 'Enable/Disable',
                'type' => 'checkbox',
                'label' => 'Enable BMaGlass Pay',
                'default' => 'no',
            ),
            'title' => array(
                'title' => 'Title',
                'type' => 'text',
                'description' => 'Shown to the buyer at checkout.',
                'default' => 'BMaGlass Pay',
                'desc_tip' => true,
            ),
            'description' => array(
                'title' => 'Description',
                'type' => 'textarea',
                'description' => 'Shown to the buyer at checkout.',
                'default' => 'Pay with your BMaGlass Pay wallet. You\'ll be taken to BMaGlass Pay to complete the payment; '
                    . 'your order is confirmed automatically once the payment lands.',
            ),
            'api_key' => array(
                'title' => 'API key',
                'type' => 'password',
                'description' => 'Create a key in BMaGlass Pay (Business settings or the API page) with the payment_links '
                    . 'and wallets scopes. A live key (bmp_live_...) is required to take payments. A test key '
                    . '(bmp_test_...) can only check the connection and read wallets — BMaGlass Pay has no test-mode '
                    . 'ledger, so a test key can never move money.',
            ),
            'webhook_id' => array(
                'title' => 'Webhook ID',
                'type' => 'text',
                'description' => 'Filled automatically by "Register webhook" below. The webhook proves connectivity '
                    . '(signed webhook.test events) and logs signed events; order confirmation itself runs on '
                    . 'automatic reconciliation (see the plugin README for why).',
                'custom_attributes' => array('readonly' => 'readonly'),
            ),
            'webhook_secret' => array(
                'title' => 'Webhook secret',
                'type' => 'password',
                'description' => 'The webhook signing secret (whsec_...), shown once by BMaGlass when the webhook is '
                    . 'registered and stored here so incoming events can be verified.',
                'custom_attributes' => array('readonly' => 'readonly'),
            ),
        );
    }

    /** The configured client, or null when no key is set. */
    public function client()
    {
        $key = trim((string) $this->get_option('api_key'));
        if ($key === '') {
            return null;
        }
        try {
            return new BMaGlassClient($key);
        } catch (BMaGlassApiException $e) {
            return null;
        }
    }

    public function is_available()
    {
        if (!parent::is_available()) {
            return false;
        }
        return $this->client() !== null;
    }

    /**
     * Settings screen + connection tools (Test connection / Register
     * webhook), handled by admin-post actions in the main plugin file.
     */
    public function admin_options()
    {
        parent::admin_options();
        $webhookUrl = rest_url('bmaglass/v1/webhook');
        ?>
        <table class="form-table">
            <tr>
                <th scope="row">Connection tools</th>
                <td>
                    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:inline-block;margin-right:8px;">
                        <?php wp_nonce_field('bmaglass_test_connection'); ?>
                        <input type="hidden" name="action" value="bmaglass_test_connection" />
                        <button type="submit" class="button">Test connection</button>
                    </form>
                    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:inline-block;">
                        <?php wp_nonce_field('bmaglass_register_webhook'); ?>
                        <input type="hidden" name="action" value="bmaglass_register_webhook" />
                        <button type="submit" class="button">Register webhook</button>
                    </form>
                    <p class="description">
                        Save your API key first, then test the connection. Register webhook points BMaGlass at
                        <code><?php echo esc_html($webhookUrl); ?></code> and stores the signing secret here.
                        With a test key the connection check works (wallets are read), but checkout stays
                        disabled for payments — test keys are read-only by design.
                    </p>
                </td>
            </tr>
        </table>
        <?php
    }

    /**
     * Create (or reuse) a payment link for the order and redirect the
     * buyer to the hosted BMaGlass payment page.
     */
    public function process_payment($order_id)
    {
        $order = wc_get_order($order_id);
        if (!$order) {
            return array('result' => 'failure');
        }
        $client = $this->client();
        if ($client === null) {
            wc_add_notice('BMaGlass Pay isn\'t configured on this store yet. Please choose another payment method.', 'error');
            return array('result' => 'failure');
        }

        // Currency guard: ZMW/USD wallets only — never a silent conversion.
        try {
            $currency = BMaGlassClient::assertSupportedCurrency($order->get_currency());
        } catch (BMaGlassApiException $e) {
            wc_add_notice($e->userMessage(), 'error');
            return array('result' => 'failure');
        }

        // Honest test-mode refusal, before touching the API.
        if (!$client->isLive()) {
            wc_add_notice(
                'This store\'s BMaGlass key is a test key, which can\'t take payments. The store owner needs to '
                . 'switch to a live BMaGlass key before checkout can run.',
                'error'
            );
            return array('result' => 'failure');
        }

        // Reuse an existing active link for this order (retries, double-clicks).
        $existingCode = (string) $order->get_meta('_bmaglass_link_code');
        if ($existingCode !== '') {
            return array(
                'result' => 'success',
                'redirect' => BMaGlassClient::paymentLinkUrl($existingCode),
            );
        }

        $total = round((float) $order->get_total(), 2);
        try {
            $link = $client->createPaymentLink(
                sprintf('Order #%s — %s', $order->get_order_number(), get_bloginfo('name')),
                $total,
                $currency,
                sprintf('WooCommerce order %s', $order->get_order_key()),
                gmdate('c', time() + 7 * DAY_IN_SECONDS)
            );
        } catch (BMaGlassApiException $e) {
            wc_add_notice($e->userMessage(), 'error');
            $order->add_order_note('BMaGlass: payment link creation failed — ' . $e->getMessage());
            return array('result' => 'failure');
        }

        $order->update_meta_data('_bmaglass_link_id', isset($link['id']) ? $link['id'] : '');
        $order->update_meta_data('_bmaglass_link_code', isset($link['link_code']) ? $link['link_code'] : '');
        $order->update_meta_data('_bmaglass_payment_count_seen', 0);
        $order->update_status('on-hold', 'Awaiting BMaGlass Pay payment — link ' . (isset($link['link_code']) ? $link['link_code'] : '') . '.');
        $order->save();

        WC()->cart->empty_cart();

        return array(
            'result' => 'success',
            'redirect' => BMaGlassClient::paymentLinkUrl($link['link_code']),
        );
    }
}
