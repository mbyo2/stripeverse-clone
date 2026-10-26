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
 * Verifies the HMAC signature with the configured secret. Any valid
 * event nudges a reconciliation pass (the payload carries no
 * payment-link identity today, so settlement itself is confirmed via
 * the API, exactly once, by the Reconciler). Invalid signatures get
 * a 400 and are never processed.
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
        $this->reconciler->reconcilePending();
        $result->setHttpResponseCode(200);
        $result->setContents('ok');
        return $result;
    }
}
