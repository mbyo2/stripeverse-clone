<?php

namespace BMaGlass\Pay\Controller\Webhook;

use BMaGlass\Pay\Model\Api\Client;
use BMaGlass\Pay\Model\Reconciler;
use Magento\Framework\App\Action\Action;
use Magento\Framework\App\Action\Context;
use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Framework\App\CsrfAwareActionInterface;
use Magento\Framework\App\Request\InvalidRequestException;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\Controller\ResultFactory;

/**
 * Webhook receiver: /bmaglass/webhook
 *
 * Verifies the HMAC signature with the configured secret. A
 * payment_link.paid event carries the paid link's code, so its order
 * is reconciled (and completed) immediately and specifically; any
 * other valid event nudges a full reconciliation pass. Settlement
 * itself is always confirmed via the API, exactly once, by the
 * Reconciler. Invalid signatures get a 400 and are never processed.
 */
class Index extends Action implements CsrfAwareActionInterface
{
    private $scopeConfig;
    private $reconciler;

    public function __construct(Context $context, ScopeConfigInterface $scopeConfig, Reconciler $reconciler)
    {
        parent::__construct($context);
        $this->scopeConfig = $scopeConfig;
        $this->reconciler = $reconciler;
    }

    public function createCsrfValidationException(RequestInterface $request)
    {
        return null;
    }

    public function validateForCsrf(RequestInterface $request)
    {
        return true;
    }

    public function execute()
    {
        $result = $this->resultFactory->create(ResultFactory::TYPE_RAW);
        $secret = (string) $this->scopeConfig->getValue('payment/bmaglasspay/webhook_secret');
        $raw = (string) $this->getRequest()->getContent();
        $signature = (string) $this->getRequest()->getHeader('X-BMaGlass-Signature');
        if ($secret === '' || !Client::verifyWebhookSignature($raw, $signature, $secret)) {
            $result->setHttpResponseCode(400);
            $result->setContents('invalid signature');
            return $result;
        }
        $event = json_decode($raw, true);
        if (is_array($event)
            && ($event['type'] ?? '') === 'payment_link.paid'
            && !empty($event['data']['link_code'])) {
            $this->reconciler->reconcileLink((string) $event['data']['link_code']);
        } else {
            $this->reconciler->reconcilePending();
        }
        $result->setHttpResponseCode(200);
        $result->setContents('ok');
        return $result;
    }
}
