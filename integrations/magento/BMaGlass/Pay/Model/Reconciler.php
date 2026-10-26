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
 * Settlement confirmation by reconciliation: the developer API does
 * not emit a per-payment-link webhook today, so paid links are
 * detected by polling GET /payment-links and matching each pending
 * order's stored link_code — completed EXACTLY ONCE (registerCapture
 * + state change under the order's current state check).
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
            $order = $pending[$code];
            if ($order->getState() !== Order::STATE_PENDING_PAYMENT) {
                continue;
            }
            try {
                $order->getPayment()->registerCaptureNotification((float) $order->getGrandTotal());
                $order->addCommentToStatusHistory(
                    'BMaGlass Pay payment confirmed (link ' . $code . ').'
                );
                $this->orderRepository->save($order);
                $completed++;
            } catch (\Exception $e) {
                $this->logger->warning('BMaGlass complete order ' . $order->getIncrementId() . ': ' . $e->getMessage());
            }
        }
        return $completed;
    }
}
