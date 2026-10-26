<?php

namespace BMaGlass\Pay\Model;

use BMaGlass\Pay\Model\Api\ApiException;
use BMaGlass\Pay\Model\Api\Client;
use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Sales\Api\OrderRepositoryInterface;
use Magento\Sales\Model\Order;
use Magento\Sales\Model\ResourceModel\Order\CollectionFactory;
use Psr\Log\LoggerInterface;

/**
 * Settlement confirmation, webhook-first with reconciliation as the
 * fallback. The developer API fires a signed payment_link.paid event
 * when a link is paid; the webhook controller then runs
 * reconcileLink() for just that link's order. The cron sweep
 * (reconcilePending) keeps polling GET /payment-links for any order
 * whose delivery was missed. Both paths confirm via the API and
 * complete EXACTLY ONCE (registerCapture + state change under the
 * order's current state check).
 */
class Reconciler
{
    private $scopeConfig;
    private $collectionFactory;
    private $orderRepository;
    private $logger;

    public function __construct(
        ScopeConfigInterface $scopeConfig,
        CollectionFactory $collectionFactory,
        OrderRepositoryInterface $orderRepository,
        LoggerInterface $logger
    ) {
        $this->scopeConfig = $scopeConfig;
        $this->collectionFactory = $collectionFactory;
        $this->orderRepository = $orderRepository;
        $this->logger = $logger;
    }

    public function client()
    {
        $key = (string) $this->scopeConfig->getValue('payment/bmaglasspay/api_key');
        return $key !== '' ? new Client($key) : null;
    }

    /** @return int number of orders completed in this pass */
    public function reconcilePending($limit = 50)
    {
        $client = $this->client();
        if ($client === null) {
            return 0;
        }
        $orders = $this->collectionFactory->create()
            ->addFieldToFilter('state', Order::STATE_PENDING_PAYMENT)
            ->addFieldToFilter('status', 'pending_payment')
            ->setPageSize($limit);
        $orders->getSelect()->joinInner(
            ['sop' => $orders->getTable('sales_order_payment')],
            'sop.parent_id = main_table.entity_id',
            []
        )->where("sop.method = 'bmaglasspay'");

        $pending = [];
        foreach ($orders as $order) {
            $code = $order->getPayment()->getAdditionalInformation('bmaglass_link_code');
            if ($code) {
                $pending[(string) $code] = $order;
            }
        }
        if (!$pending) {
            return 0;
        }
        try {
            $links = $client->listPaymentLinks();
        } catch (ApiException $e) {
            $this->logger->warning('BMaGlass reconcile: ' . $e->getMessage());
            return 0;
        }
        $completed = 0;
        foreach ((array) $links as $link) {
            $code = isset($link['link_code']) ? (string) $link['link_code'] : '';
            if (!isset($pending[$code]) || (int) ($link['payment_count'] ?? 0) < 1) {
                continue;
            }
            if ($this->completeOrder($pending[$code], $code)) {
                $completed++;
            }
        }
        return $completed;
    }

    /**
     * Targeted pass for ONE link code — the payment_link.paid webhook
     * path. Confirms the link via the API and completes its pending
     * order immediately. Returns 1 when the order was completed.
     */
    public function reconcileLink($linkCode)
    {
        $client = $this->client();
        if ($client === null || $linkCode === '') {
            return 0;
        }
        try {
            $links = $client->listPaymentLinks();
        } catch (ApiException $e) {
            $this->logger->warning('BMaGlass reconcileLink: ' . $e->getMessage());
            return 0;
        }
        $paid = false;
        foreach ((array) $links as $link) {
            if ((string) ($link['link_code'] ?? '') === (string) $linkCode
                && (int) ($link['payment_count'] ?? 0) >= 1) {
                $paid = true;
                break;
            }
        }
        if (!$paid) {
            return 0;
        }
        $orders = $this->collectionFactory->create()
            ->addFieldToFilter('state', Order::STATE_PENDING_PAYMENT)
            ->addFieldToFilter('status', 'pending_payment');
        $orders->getSelect()->joinInner(
            ['sop' => $orders->getTable('sales_order_payment')],
            'sop.parent_id = main_table.entity_id',
            []
        )->where("sop.method = 'bmaglasspay'");
        foreach ($orders as $order) {
            $code = $order->getPayment()->getAdditionalInformation('bmaglass_link_code');
            if ((string) $code === (string) $linkCode) {
                return $this->completeOrder($order, (string) $linkCode) ? 1 : 0;
            }
        }
        return 0;
    }

    /** Complete one order for a paid link — exactly once (state-guarded). */
    private function completeOrder($order, $code)
    {
        if ($order->getState() !== Order::STATE_PENDING_PAYMENT) {
            return false;
        }
        try {
            $order->getPayment()->registerCaptureNotification((float) $order->getGrandTotal());
            $order->addCommentToStatusHistory(
                'BMaGlass Pay payment confirmed (link ' . $code . ').'
            );
            $this->orderRepository->save($order);
            return true;
        } catch (\Exception $e) {
            $this->logger->warning('BMaGlass complete order ' . $order->getIncrementId() . ': ' . $e->getMessage());
            return false;
        }
    }
}
