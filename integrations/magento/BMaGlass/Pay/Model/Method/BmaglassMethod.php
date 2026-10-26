<?php

namespace BMaGlass\Pay\Model\Method;

use BMaGlass\Pay\Model\Api\Client;
use Magento\Payment\Model\Method\AbstractMethod;

/**
 * BMaGlass Pay payment method (redirect gateway).
 *
 * The order is placed in pending_payment; the buyer is redirected
 * (Controller/Checkout/Redirect) to a BMaGlass hosted payment link.
 * Settlement is confirmed by Model/Reconciler (webhook nudge + cron).
 */
class BmaglassMethod extends AbstractMethod
{
    protected $_code = 'bmaglasspay';
    protected $_isGateway = true;
    protected $_canAuthorize = true;
    protected $_canUseCheckout = true;
    protected $_canUseForMultishipping = false;

    /**
     * Available only when: enabled, a LIVE key is configured, and the
     * quote currency has a BMaGlass wallet (ZMW/USD). A test key can
     * never take a payment — the method hides rather than faking a
     * sandbox checkout.
     */
    public function isAvailable(\Magento\Quote\Api\Data\CartInterface $quote = null)
    {
        if (!parent::isAvailable($quote)) {
            return false;
        }
        $key = (string) $this->getConfigData('api_key');
        if ($key === '' || strpos($key, 'bmp_live_') !== 0) {
            return false;
        }
        if ($quote !== null) {
            $currency = $quote->getQuoteCurrencyCode();
            if ($currency && !in_array(strtoupper($currency), Client::SUPPORTED_CURRENCIES, true)) {
                return false;
            }
        }
        return true;
    }

    public function canUseForCurrency($currencyCode)
    {
        return in_array(strtoupper((string) $currencyCode), Client::SUPPORTED_CURRENCIES, true);
    }

    /**
     * Nothing is captured at placement — payment happens on the
     * hosted page. Mark the payment pending; the reconciler
     * registers the capture when the link settles.
     */
    public function authorize(\Magento\Payment\Model\InfoInterface $payment, $amount)
    {
        $payment->setIsTransactionPending(true);
        $payment->setIsFraudDetected(false);
        return $this;
    }

    /** After placement, checkout sends the buyer to our redirect controller. */
    public function getOrderPlaceRedirectUrl()
    {
        return $this->_urlBuilder->getUrl('bmaglass/checkout/redirect', ['_secure' => true]);
    }
}
