<?php
/**
 * BMaGlass Pay for PrestaShop (1.7+ / 8.x).
 *
 * Buyers pay on BMaGlass's hosted payment page from their BMaGlass
 * wallet; the money lands in the same BMaGlass account and wallets.
 * The API client is the PHP SDK (sdk/php), vendored verbatim in
 * classes/sdk/ — verified byte-identical by
 * integrations/check-vendored-clients.sh.
 *
 * Settlement: the developer API does not emit a per-link webhook
 * today, so paid links are confirmed by reconciliation polling
 * (GET /payment-links matched to the stored per-order link code),
 * triggered by the HMAC-verified webhook and by the module's
 * "Check pending orders" action. Orders complete exactly once.
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

require_once __DIR__ . '/classes/sdk/ApiException.php';
require_once __DIR__ . '/classes/sdk/Client.php';

use BMaGlass\Sdk\ApiException;
use BMaGlass\Sdk\Client;
use PrestaShop\PrestaShop\Core\Payment\PaymentOption;

class Bmaglasspay extends PaymentModule
{
    public function __construct()
    {
        $this->name = 'bmaglasspay';
        $this->tab = 'payments_gateways';
        $this->version = '1.0.0';
        $this->author = 'BMaGlass Pay';
        $this->is_eu_compatible = 1;
        $this->bootstrap = true;
        parent::__construct();
        $this->displayName = $this->l('BMaGlass Pay');
        $this->description = $this->l('Accept payments from BMaGlass wallets (ZMW/USD) via a hosted BMaGlass payment page.');
        $this->confirmUninstall = $this->l('Remove BMaGlass Pay from this shop?');
    }

    public function install()
    {
        if (!parent::install()
            || !$this->registerHook('paymentOptions')
            || !$this->registerHook('paymentReturn')
        ) {
            return false;
        }
        Db::getInstance()->execute(
            'CREATE TABLE IF NOT EXISTS `' . _DB_PREFIX_ . 'bmaglasspay_orders` (
                `id_order` INT UNSIGNED NOT NULL PRIMARY KEY,
                `link_code` VARCHAR(64) NOT NULL,
                `paid` TINYINT NOT NULL DEFAULT 0
            ) ENGINE=' . _MYSQL_ENGINE_ . ' DEFAULT CHARSET=utf8mb4'
        );
        if (!Configuration::get('BMGLASS_OS_WAITING')) {
            $state = new OrderState();
            $state->name = array((int) Configuration::get('PS_LANG_DEFAULT') => 'Awaiting BMaGlass payment');
            $state->module_name = $this->name;
            $state->color = '#F7931A';
            $state->send_email = false;
            $state->unremovable = false;
            $state->delivery = false;
            $state->paid = false;
            $state->logable = false;
            if ($state->add()) {
                Configuration::updateValue('BMGLASS_OS_WAITING', (int) $state->id);
            }
        }
        return true;
    }

    public function uninstall()
    {
        Configuration::deleteByName('BMGLASS_API_KEY');
        Configuration::deleteByName('BMGLASS_WEBHOOK_SECRET');
        return parent::uninstall();
    }

    // ── Configuration ────────────────────────────────────────────

    public function getContent()
    {
        $output = '';
        if (Tools::isSubmit('submitBmaglassConfig')) {
            Configuration::updateValue('BMGLASS_API_KEY', trim((string) Tools::getValue('BMGLASS_API_KEY')));
            Configuration::updateValue('BMGLASS_WEBHOOK_SECRET', trim((string) Tools::getValue('BMGLASS_WEBHOOK_SECRET')));
            $output .= $this->displayConfirmation($this->l('Settings saved.'));
        }
        if (Tools::isSubmit('submitBmaglassTest')) {
            try {
                $client = $this->client();
                $wallets = $client->wallets();
                $parts = array();
                foreach ((array) $wallets as $w) {
                    $parts[] = $w['currency'] . ' ' . number_format((float) $w['balance'], 2);
                }
                $output .= $this->displayConfirmation(
                    $this->l('Connected to BMaGlass Pay.') . ' ' . implode(' · ', $parts)
                    . (!$client->isLive() ? ' ' . $this->l('This is a TEST key: read-only — checkout needs a live key.') : '')
                );
            } catch (ApiException $e) {
                $output .= $this->displayError($e->userMessage());
            }
        }
        if (Tools::isSubmit('submitBmaglassReconcile')) {
            $done = $this->reconcilePendingOrders();
            $output .= $this->displayConfirmation(sprintf($this->l('Check complete: %d order(s) confirmed paid.'), $done));
        }
        return $output . $this->renderConfigForm();
    }

    private function renderConfigForm()
    {
        $helper = new HelperForm();
        $helper->module = $this;
        $helper->currentIndex = $this->context->link->getAdminLink('AdminModules', false) . '&configure=' . $this->name;
        $helper->token = Tools::getAdminTokenLite('AdminModules');
        $helper->submit_action = 'submitBmaglassConfig';
        $webhookUrl = $this->context->link->getModuleLink($this->name, 'webhook', array(), true);
        $form = array(
            'form' => array(
                'legend' => array('title' => $this->l('BMaGlass Pay settings')),
                'description' => $this->l('Webhook URL to register in BMaGlass Pay: ') . $webhookUrl
                    . '<br>' . $this->l('Test keys are read-only (connection and balance checks only); checkout requires a live key. Currencies: ZMW and USD only.'),
                'input' => array(
                    array('type' => 'text', 'label' => $this->l('API key'), 'name' => 'BMGLASS_API_KEY', 'required' => true, 'desc' => $this->l('bmp_live_... (or bmp_test_... for a connection check)')),
                    array('type' => 'text', 'label' => $this->l('Webhook signing secret'), 'name' => 'BMGLASS_WEBHOOK_SECRET', 'desc' => $this->l('Shown once when you register the webhook in BMaGlass Pay.')),
                ),
                'buttons' => array(
                    array('title' => $this->l('Save'), 'class' => 'btn btn-default pull-right', 'type' => 'submit', 'name' => 'submitBmaglassConfig'),
                    array('title' => $this->l('Test connection'), 'class' => 'btn btn-default', 'type' => 'submit', 'name' => 'submitBmaglassTest'),
                    array('title' => $this->l('Check pending orders'), 'class' => 'btn btn-default', 'type' => 'submit', 'name' => 'submitBmaglassReconcile'),
                ),
            ),
        );
        $helper->fields_value = array(
            'BMGLASS_API_KEY' => (string) Configuration::get('BMGLASS_API_KEY'),
            'BMGLASS_WEBHOOK_SECRET' => (string) Configuration::get('BMGLASS_WEBHOOK_SECRET'),
        );
        return $helper->generateForm(array($form));
    }

    // ── Checkout ─────────────────────────────────────────────────

    public function hookPaymentOptions($params)
    {
        if (!$this->active) {
            return array();
        }
        $key = (string) Configuration::get('BMGLASS_API_KEY');
        if (strpos($key, 'bmp_live_') !== 0) {
            return array(); // Test key: connection checks only; never a fake sandbox checkout.
        }
        $currency = new Currency((int) $params['cart']->id_currency);
        if (!in_array(strtoupper($currency->iso_code), Client::SUPPORTED_CURRENCIES, true)) {
            return array(); // No BMaGlass wallet for this currency; no invented FX rate.
        }
        $option = new PaymentOption();
        $option->setModuleName($this->name)
            ->setCallToActionText($this->l('Pay with BMaGlass Pay'))
            ->setAction($this->context->link->getModuleLink($this->name, 'redirect', array(), true))
            ->setAdditionalInformation($this->fetch('module:bmaglasspay/views/templates/front/payment_infos.tpl'));
        return array($option);
    }

    public function hookPaymentReturn($params)
    {
        $this->smarty->assign(array(
            'order_reference' => $params['order']->reference,
            'shop_name' => $this->context->shop->name,
        ));
        return $this->fetch('module:bmaglasspay/views/templates/front/payment_return.tpl');
    }

    // ── Shared helpers ───────────────────────────────────────────

    public function client()
    {
        return new Client((string) Configuration::get('BMGLASS_API_KEY'));
    }

    public function webhookSecret()
    {
        return (string) Configuration::get('BMGLASS_WEBHOOK_SECRET');
    }

    public function recordLink($orderId, $linkCode)
    {
        Db::getInstance()->execute(
            'INSERT INTO `' . _DB_PREFIX_ . 'bmaglasspay_orders` (`id_order`, `link_code`, `paid`) VALUES ('
            . (int) $orderId . ', \'' . pSQL($linkCode) . '\', 0)
             ON DUPLICATE KEY UPDATE `link_code` = VALUES(`link_code`)'
        );
    }

    /** Complete orders whose BMaGlass link has been paid. Exactly once per order. */
    public function reconcilePendingOrders($limit = 50)
    {
        $rows = Db::getInstance()->executeS(
            'SELECT `id_order`, `link_code` FROM `' . _DB_PREFIX_ . 'bmaglasspay_orders` WHERE `paid` = 0 LIMIT ' . (int) $limit
        );
        if (!$rows) {
            return 0;
        }
        try {
            $links = $this->client()->listPaymentLinks();
        } catch (ApiException $e) {
            return 0;
        }
        $paidCounts = array();
        foreach ((array) $links as $link) {
            $paidCounts[(string) $link['link_code']] = (int) $link['payment_count'];
        }
        return $this->settleRows($rows, $paidCounts);
    }

    /**
     * Complete the order recorded for ONE link code — the
     * payment_link.paid webhook path (immediate, targeted). The link
     * is still confirmed via the API before anything completes.
     */
    public function reconcileOrderByLink($linkCode)
    {
        $rows = Db::getInstance()->executeS(
            'SELECT `id_order`, `link_code` FROM `' . _DB_PREFIX_ . 'bmaglasspay_orders` WHERE `paid` = 0 AND `link_code` = \''
            . pSQL((string) $linkCode) . '\' LIMIT 1'
        );
        if (!$rows) {
            return 0;
        }
        try {
            $links = $this->client()->listPaymentLinks();
        } catch (ApiException $e) {
            return 0;
        }
        $paidCounts = array();
        foreach ((array) $links as $link) {
            $paidCounts[(string) $link['link_code']] = (int) $link['payment_count'];
        }
        return $this->settleRows($rows, $paidCounts);
    }

    /** Shared completion step: settle recorded rows whose link shows paid. */
    private function settleRows($rows, $paidCounts)
    {
        $completed = 0;
        foreach ($rows as $row) {
            if (($paidCounts[$row['link_code']] ?? 0) < 1) {
                continue;
            }
            $order = new Order((int) $row['id_order']);
            if (!Validate::isLoadedObject($order)) {
                continue;
            }
            $order->setCurrentState((int) Configuration::get('PS_OS_PAYMENT'));
            Db::getInstance()->execute(
                'UPDATE `' . _DB_PREFIX_ . 'bmaglasspay_orders` SET `paid` = 1 WHERE `id_order` = ' . (int) $row['id_order']
            );
            $order->addOrderPayment((float) $order->total_paid, 'BMaGlass Pay', $row['link_code']);
            $completed++;
        }
        return $completed;
    }
}
