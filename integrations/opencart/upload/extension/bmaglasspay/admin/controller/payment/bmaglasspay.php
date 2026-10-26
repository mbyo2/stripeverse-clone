<?php

namespace Opencart\Admin\Controller\Extension\Bmaglasspay\Payment;

use BMaGlass\Sdk\ApiException;
use BMaGlass\Sdk\Client;

/**
 * Admin: BMaGlass Pay settings + connection test + install.
 * The API client is the PHP SDK, vendored verbatim under
 * system/library/bmaglass/ (BMaGlass\Sdk namespace).
 */
class Bmaglasspay extends \Opencart\System\Engine\Controller
{
    public function index(): void
    {
        $this->load->language('extension/bmaglasspay/payment/bmaglasspay');
        $this->document->setTitle($this->language->get('heading_title'));
        $this->load->model('setting/setting');

        $data['action'] = $this->url->link('extension/bmaglasspay/payment/bmaglasspay.save', 'user_token=' . $this->session->data['user_token']);
        $data['test_action'] = $this->url->link('extension/bmaglasspay/payment/bmaglasspay.test', 'user_token=' . $this->session->data['user_token']);
        $data['webhook_url'] = HTTP_CATALOG . 'index.php?route=extension/bmaglasspay/payment/bmaglasspay.callback';
        $data['payment_bmaglasspay_status'] = $this->config->get('payment_bmaglasspay_status');
        $data['payment_bmaglasspay_api_key'] = $this->config->get('payment_bmaglasspay_api_key');
        $data['payment_bmaglasspay_webhook_secret'] = $this->config->get('payment_bmaglasspay_webhook_secret');
        $data['payment_bmaglasspay_order_status_id'] = $this->config->get('payment_bmaglasspay_order_status_id') ?: 2;
        $data['payment_bmaglasspay_sort_order'] = $this->config->get('payment_bmaglasspay_sort_order');

        $this->load->model('localisation/order_status');
        $data['order_statuses'] = $this->model_localisation_order_status->getOrderStatuses();
        $data['header'] = $this->load->controller('common/header');
        $data['column_left'] = $this->load->controller('common/column_left');
        $data['footer'] = $this->load->controller('common/footer');
        $this->response->setOutput($this->load->view('extension/bmaglasspay/payment/bmaglasspay', $data));
    }

    public function save(): void
    {
        $this->load->language('extension/bmaglasspay/payment/bmaglasspay');
        $json = [];
        if (!$this->user->hasPermission('modify', 'extension/bmaglasspay/payment/bmaglasspay')) {
            $json['error'] = $this->language->get('error_permission');
        }
        if (!$json) {
            $this->load->model('setting/setting');
            $this->model_setting_setting->editSetting('payment_bmaglasspay', $this->request->post);
            $json['success'] = $this->language->get('text_success');
        }
        $this->response->addHeader('Content-Type: application/json');
        $this->response->setOutput(json_encode($json));
    }

    /** Connection check: GET /wallets with the configured key. */
    public function test(): void
    {
        $this->load->language('extension/bmaglasspay/payment/bmaglasspay');
        $json = [];
        require_once DIR_SYSTEM . 'library/bmaglass/ApiException.php';
        require_once DIR_SYSTEM . 'library/bmaglass/Client.php';
        try {
            $client = new Client((string) $this->config->get('payment_bmaglasspay_api_key'));
            $parts = [];
            foreach ((array) $client->wallets() as $w) {
                $parts[] = $w['currency'] . ' ' . number_format((float) $w['balance'], 2);
            }
            $json['success'] = $this->language->get('text_connected') . ' ' . implode(' · ', $parts)
                . (!$client->isLive() ? ' ' . $this->language->get('text_test_key_notice') : '');
        } catch (ApiException $e) {
            $json['error'] = $e->userMessage();
        }
        $this->response->addHeader('Content-Type: application/json');
        $this->response->setOutput(json_encode($json));
    }

    public function install(): void
    {
        $this->db->query('CREATE TABLE IF NOT EXISTS `' . DB_PREFIX . 'bmaglasspay_orders` (
            `order_id` INT NOT NULL PRIMARY KEY,
            `link_code` VARCHAR(64) NOT NULL,
            `paid` TINYINT NOT NULL DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    }

    public function uninstall(): void
    {
        $this->db->query('DROP TABLE IF EXISTS `' . DB_PREFIX . 'bmaglasspay_orders`');
    }
}
