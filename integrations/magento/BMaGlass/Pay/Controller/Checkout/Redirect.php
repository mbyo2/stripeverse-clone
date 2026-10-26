<?php

namespace BMaGlass\Pay\Controller\Checkout;

use BMaGlass\Pay\Model\Api\ApiException;
use BMaGlass\Pay\Model\Api\Client;
use BMaGlass\Pay\Model\Reconciler;
use Magento\Checkout\Model\Session as CheckoutSession;
use Magento\Framework\App\Action\Action;
use Magento\Framework\App\Action\Context;
use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Sales\Api\OrderRepositoryInterface;

/**
 * Creates (once) the BMaGlass payment link for the just-placed order
 * and redirects the buyer to the hosted payment page.
 */
class Redirect extends Action
{
    private $checkoutSession;
    private $scopeConfig;
    private $orderRepository;

    public function __construct(
        Context $context,
        CheckoutSession $checkoutSession,
        ScopeConfigInterface $scopeConfig,
        OrderRepositoryInterface $orderRepository
    ) {
        parent::__construct($context);
        $this->checkoutSession = $checkoutSession;
        $this->scopeConfig = $scopeConfig;
        $this->orderRepository = $orderRepository;
    }

    public function execute()
    {
        $order = $this->checkoutSession->getLastRealOrder();
        if (!$order || !$order->getId()) {
            $this->messageManager->addErrorMessage(__('We couldn\'t find your order. Please contact us for help.'));
            return $this->_redirect('checkout/cart');
        }
        $payment = $order->getPayment();
        $existing = $payment->getAdditionalInformation('bmaglass_link_code');
        if ($existing) {
            return $this->_redirectUrl(Client::paymentLinkUrl($existing));
        }
        try {
            $currency = Client::assertSupportedCurrency($order->getOrderCurrencyCode());
            $key = (string) $this->scopeConfig->getValue('payment/bmaglasspay/api_key');
            $client = new Client($key);
            $link = $client->createPaymentLink(
                'Order #' . $order->getIncrementId(),
                (float) $order->getGrandTotal(),
                $currency,
                'Magento order ' . $order->getIncrementId()
            );
            $payment->setAdditionalInformation('bmaglass_link_code', $link['link_code']);
            $payment->setAdditionalInformation('bmaglass_url', Client::paymentLinkUrl($link['link_code']));
            $this->orderRepository->save($order);
            return $this->_redirectUrl(Client::paymentLinkUrl($link['link_code']));
        } catch (ApiException $e) {
            $this->messageManager->addErrorMessage(__($e->userMessage()));
            return $this->_redirect('checkout/cart');
        }
    }
}
