<?php
/**
 * Creates the order (awaiting payment), creates ONE BMaGlass payment
 * link for it, and redirects the buyer to the hosted payment page.
 */

require_once _PS_MODULE_DIR_ . 'bmaglasspay/classes/sdk/ApiException.php';
require_once _PS_MODULE_DIR_ . 'bmaglasspay/classes/sdk/Client.php';

use BMaGlass\Sdk\ApiException;
use BMaGlass\Sdk\Client;

class BmaglasspayRedirectModuleFrontController extends ModuleFrontController
{
    public function postProcess()
    {
        $cart = $this->context->cart;
        if (!$cart || !$cart->id || !$cart->getOrderTotal(true)) {
            Tools::redirect('index.php?controller=order');
        }
        $currency = new Currency((int) $cart->id_currency);
        try {
            $currencyCode = Client::assertSupportedCurrency($currency->iso_code);
        } catch (ApiException $e) {
            $this->errors[] = $e->userMessage();
            $this->redirectWithNotifications('index.php?controller=order');
            return;
        }
        $customer = new Customer((int) $cart->id_customer);
        $orderId = Order::getIdByCartId((int) $cart->id);
        if (!$orderId) {
            $this->module->validateOrder(
                (int) $cart->id,
                (int) Configuration::get('BMGLASS_OS_WAITING'),
                (float) $cart->getOrderTotal(true),
                $this->module->displayName,
                null,
                array(),
                (int) $cart->id_currency,
                false,
                $customer->secure_key
            );
            $orderId = (int) $this->module->currentOrder;
        }
        $order = new Order((int) $orderId);
        try {
            $link = $this->module->client()->createPaymentLink(
                'Order #' . $order->reference,
                (float) $order->total_paid,
                $currencyCode,
                'PrestaShop order ' . $order->reference
            );
            $this->module->recordLink((int) $orderId, $link['link_code']);
            Tools::redirect(Client::paymentLinkUrl($link['link_code']));
        } catch (ApiException $e) {
            $this->errors[] = $e->userMessage();
            $this->redirectWithNotifications('index.php?controller=order');
        }
    }
}
