<?php

namespace Opencart\Catalog\Controller\Extension\Bmaglasspay\Payment;

use BMaGlass\Sdk\ApiException;
use BMaGlass\Sdk\Client;

/**
 * Checkout confirm + webhook callback.
 *
 * Settlement: the developer API does not emit a per-link webhook
 * today, so the HMAC-verified callback nudges reconciliation
 * polling (GET /payment-links matched to the stored per-order
 * link_code). Orders complete exactly once. For hands-off shops,
 * any storefront visit to the confirm view also reconciles.
 */
class Bmaglasspay extends \Opencart\System\Engine\Controller
{
    private function apiClient(): Client
    {
        require_once DIR_SYSTEM . 'library/bmaglass/ApiException.php';
        require_once DIR_SYSTEM . 'library/bmaglass/Client.php';
        return new Client((string) $this->config->get('payment_bmaglasspay_api_key'));
    }

    public function index(): string
    {
        $this->load->language('extension/bmaglasspay/payment/bmaglasspay');
        $data['text_confirm'] = $this->language->get('button_confirm');
        $data['text_loading'] = $this->language->get('text_loading');
        $data['confirm_url'] = $this->url->link('extension/bmaglasspay/payment/bmaglasspay.confirm');
        return $this->load->view('extension/bmaglasspay/payment/bmaglasspay', $data);
    }

    /** Create (once) the payment link for this order and return its URL. */
    public function confirm(): void
    {
        $this->load->language('extension/bmaglasspay/payment/bmaglasspay');
        $json = [];
        $orderId = (int) ($this->session->data['order_id'] ?? 0);
        $this->load->model('checkout/order');
        $order = $orderId ? $this->model_checkout_order->getOrder($orderId) : null;
        if (!$order) {
            $json['error'] = $this->language->get('error_order');
        } else {
            $row = $this->db->query('SELECT `link_code` FROM `' . DB_PREFIX . 'bmaglasspay_orders` WHERE `order_id` = ' . $orderId)->row;
            if ($row) {
                $json['redirect'] = Client::paymentLinkUrl($row['link_code']);
            } else {
                try {
                    $currency = Client::assertSupportedCurrency($order['currency_code']);
                    $link = $this->apiClient()->createPaymentLink(
                        'Order #' . $orderId,
                        (float) $order['total'],
                        $currency,
                        'OpenCart order ' . $orderId
                    );
                    $this->db->query('INSERT INTO `' . DB_PREFIX . 'bmaglasspay_orders` SET `order_id` = ' . $orderId
                        . ', `link_code` = \'' . $this->db->escape($link['link_code']) . '\', `paid` = 0');
                    $json['redirect'] = Client::paymentLinkUrl($link['link_code']);
                } catch (ApiException $e) {
                    $json['error'] = $e->userMessage();
                }
            }
        }
        $this->response->addHeader('Content-Type: application/json');
        $this->response->setOutput(json_encode($json));
    }

    /**
     * Webhook receiver: …?route=extension/bmaglasspay/payment/bmaglasspay.callback
     * HMAC-verified; nudges reconciliation.
     */
    public function callback(): void
    {
        $raw = (string) file_get_contents('php://input');
        $signature = (string) ($this->request->server['HTTP_X_BMGLASS_SIGNATURE'] ?? '');
        $secret = (string) $this->config->get('payment_bmaglasspay_webhook_secret');
        require_once DIR_SYSTEM . 'library/bmaglass/ApiException.php';
        require_once DIR_SYSTEM . 'library/bmaglass/Client.php';
        if ($secret === '' || !Client::verifyWebhookSignature($raw, $signature, $secret)) {
            $this->response->addHeader('HTTP/1.1 400 Bad Request');
            $this->response->setOutput('invalid signature');
            return;
        }
        $this->reconcile();
        $this->response->setOutput('ok');
    }

    /** Complete orders whose link has been paid. Exactly once per order. */
    public function reconcile(): int
    {
        $rows = $this->db->query('SELECT `order_id`, `link_code` FROM `' . DB_PREFIX . 'bmaglasspay_orders` WHERE `paid` = 0 LIMIT 50')->rows;
        if (!$rows) {
            return 0;
        }
        try {
            $links = $this->apiClient()->listPaymentLinks();
        } catch (ApiException $e) {
            return 0;
        }
        $counts = [];
        foreach ((array) $links as $link) {
            $counts[(string) $link['link_code']] = (int) $link['payment_count'];
        }
        $this->load->model('checkout/order');
        $completed = 0;
        foreach ($rows as $row) {
            if (($counts[$row['link_code']] ?? 0) < 1) {
                continue;
            }
            $this->model_checkout_order->addHistory(
                (int) $row['order_id'],
                (int) $this->config->get('payment_bmaglasspay_order_status_id'),
                'BMaGlass Pay payment confirmed (link ' . $row['link_code'] . ').',
                true
            );
            $this->db->query('UPDATE `' . DB_PREFIX . 'bmaglasspay_orders` SET `paid` = 1 WHERE `order_id` = ' . (int) $row['order_id']);
            $completed++;
        }
        return $completed;
    }
}
