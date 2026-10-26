<?php

namespace Opencart\Catalog\Model\Extension\Bmaglasspay\Payment;

/**
 * Checkout availability: enabled + LIVE key + a currency that has a
 * BMaGlass wallet (ZMW/USD). A test key never unlocks checkout and
 * no exchange rate is ever invented.
 */
class Bmaglasspay extends \Opencart\System\Engine\Model
{
    public function getMethod(array $address = []): array
    {
        $methods = $this->getMethods($address);
        return $methods[0] ?? [];
    }

    public function getMethods(array $address = []): array
    {
        if (!$this->config->get('payment_bmaglasspay_status')) {
            return [];
        }
        $key = (string) $this->config->get('payment_bmaglasspay_api_key');
        if (strpos($key, 'bmp_live_') !== 0) {
            return [];
        }
        $currency = strtoupper((string) $this->session->data['currency']);
        if (!in_array($currency, ['ZMW', 'USD'], true)) {
            return [];
        }
        $this->load->language('extension/bmaglasspay/payment/bmaglasspay');
        return [[
            'code' => 'bmaglasspay',
            'name' => $this->language->get('text_title'),
            'sort_order' => (int) $this->config->get('payment_bmaglasspay_sort_order'),
        ]];
    }
}
