<?php

namespace BMaGlass\Pay\Model\Api;

/**
 * BMaGlass Pay Developer API client (PHP).
 *
 * Lifted unchanged in behaviour from the WooCommerce plugin's client
 * (integrations/wordpress) — the same surface the TypeScript and
 * Python SDKs wrap.
 *
 * Auth: an API key created in the BMaGlass Pay app, sent in the
 * X-Api-Key header. bmp_live_ keys move real money; bmp_test_ keys
 * are READ-ONLY — BMaGlass Pay has no test-mode ledger, so a test
 * key can never move money. Write attempts with a test key fail with
 * a typed 403 `test_mode_read_only` (see ApiException::userMessage()).
 *
 * This package lives in the BMaGlass Pay repository (sdk/php). It is
 * not published on Packagist — install it from the repo (see README).
 */
class Client
{
    const DEFAULT_BASE = 'https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/developer-api';
    const SITE_BASE = 'https://bmaglasspay.online';
    /** Currencies that have wallets. Anything else is refused — never converted silently. */
    const SUPPORTED_CURRENCIES = array('ZMW', 'USD');

    /** @var string */
    private $apiKey;
    /** @var string */
    private $baseUrl;
    /** @var callable|null fn(string $method, string $url, array $headers, ?string $body): array{0:int,1:string} */
    private $transport;

    /**
     * @param string        $apiKey    bmp_live_... or bmp_test_... key.
     * @param string|null   $baseUrl   API base override (tests).
     * @param callable|null $transport HTTP transport override (tests).
     */
    public function __construct($apiKey, $baseUrl = null, $transport = null)
    {
        if (!is_string($apiKey) || strpos($apiKey, 'bmp_') !== 0) {
            throw new ApiException(0, 'invalid_api_key',
                'api_key must be a BMaGlass Pay API key (bmp_live_... or bmp_test_...).');
        }
        $this->apiKey = $apiKey;
        $this->baseUrl = rtrim($baseUrl ? $baseUrl : self::DEFAULT_BASE, '/');
        $this->transport = $transport;
    }

    /** 'live' or 'test', from the key prefix — same rule as the other SDKs. */
    public function mode()
    {
        return strpos($this->apiKey, 'bmp_live_') === 0 ? 'live' : 'test';
    }

    public function isLive()
    {
        return $this->mode() === 'live';
    }

    /** Hosted payment page URL for a link code. */
    public static function paymentLinkUrl($linkCode)
    {
        return self::SITE_BASE . '/pay/' . rawurlencode((string) $linkCode);
    }

    /**
     * Guard: only currencies with wallets may be used. Throws a
     * crafted unsupported_currency error — the client never invents
     * an exchange rate.
     */
    public static function assertSupportedCurrency($currency)
    {
        $c = strtoupper((string) $currency);
        if (!in_array($c, self::SUPPORTED_CURRENCIES, true)) {
            throw new ApiException(0, 'unsupported_currency',
                'BMaGlass Pay wallets are ZMW and USD. This store is set to ' . $c
                . ', which has no BMaGlass wallet, so BMaGlass checkout can\'t run — '
                . 'no exchange rate has been applied. Set the store currency to ZMW or USD to use BMaGlass Pay.');
        }
        return $c;
    }

    // ── Endpoints ────────────────────────────────────────────────

    /** GET /wallets — the key owner's wallets with balances. */
    public function wallets()
    {
        return $this->request('GET', 'wallets');
    }

    /** GET /transactions?limit= */
    public function transactions($limit = 25)
    {
        $limit = max(1, min(100, (int) $limit));
        return $this->request('GET', 'transactions?limit=' . $limit);
    }

    /**
     * POST /transfers — wallet-to-wallet transfer (live keys only;
     * 1.5% fee charged on top by the API, exactly like the app).
     */
    public function createTransfer($toUserId, $amount, $currency = 'ZMW', $description = null, $recipientName = null, $idempotencyKey = null)
    {
        $body = array(
            'to_user_id' => $toUserId,
            'amount' => $amount,
            'currency' => self::assertSupportedCurrency($currency),
        );
        if ($description !== null) $body['description'] = $description;
        if ($recipientName !== null) $body['recipient_name'] = $recipientName;
        $headers = $idempotencyKey ? array('Idempotency-Key' => $idempotencyKey) : array();
        return $this->request('POST', 'transfers', $body, $headers);
    }

    /** GET /payment-links */
    public function listPaymentLinks()
    {
        return $this->request('GET', 'payment-links');
    }

    /**
     * POST /payment-links — create a hosted payment link (live keys
     * only). Returns the row including link_code; the buyer-facing
     * URL is self::paymentLinkUrl($row['link_code']).
     */
    public function createPaymentLink($title, $amount = null, $currency = 'ZMW', $description = null, $expiresAt = null)
    {
        $body = array('title' => (string) $title, 'currency' => self::assertSupportedCurrency($currency));
        if ($amount !== null) $body['amount'] = round((float) $amount, 2);
        if ($description !== null) $body['description'] = $description;
        if ($expiresAt !== null) $body['expires_at'] = $expiresAt;
        return $this->request('POST', 'payment-links', $body);
    }

    /** GET /bitcoin/balance */
    public function bitcoinBalance()
    {
        return $this->request('GET', 'bitcoin/balance');
    }

    /** GET /bitcoin/deposit-address (404 no_deposit_address if none issued). */
    public function bitcoinDepositAddress()
    {
        return $this->request('GET', 'bitcoin/deposit-address');
    }

    /** POST /bitcoin/quote — quote only; execution stays in the app. */
    public function bitcoinQuote($side, $amountZmw = null, $amountSats = null)
    {
        $body = array('side' => $side === 'sell' ? 'sell' : 'buy');
        if ($amountZmw !== null) $body['amount_zmw'] = $amountZmw;
        if ($amountSats !== null) $body['amount_sats'] = $amountSats;
        return $this->request('POST', 'bitcoin/quote', $body);
    }

    /** GET /webhooks (secrets are never returned). */
    public function listWebhooks()
    {
        return $this->request('GET', 'webhooks');
    }

    /**
     * POST /webhooks — register an endpoint. The response includes
     * the signing secret EXACTLY ONCE; store it immediately.
     */
    public function createWebhook($url, $events = null)
    {
        $body = array('url' => $url);
        if ($events !== null) $body['events'] = array_values($events);
        return $this->request('POST', 'webhooks', $body);
    }

    /** DELETE /webhooks/{id} */
    public function deleteWebhook($webhookId)
    {
        return $this->request('DELETE', 'webhooks/' . rawurlencode((string) $webhookId));
    }

    /** POST /webhooks/{id}/test — send a signed webhook.test event. */
    public function testWebhook($webhookId)
    {
        return $this->request('POST', 'webhooks/' . rawurlencode((string) $webhookId) . '/test');
    }

    /** GET /webhook-deliveries */
    public function webhookDeliveries()
    {
        return $this->request('GET', 'webhook-deliveries');
    }

    // ── Webhook verification ─────────────────────────────────────

    /**
     * Verify an X-BMaGlass-Signature header ("sha256=<hex>") over
     * the exact raw request body. Same scheme as the TS/Python SDKs.
     */
    public static function verifyWebhookSignature($rawBody, $signatureHeader, $secret)
    {
        if (!is_string($signatureHeader) || strpos($signatureHeader, 'sha256=') !== 0 || !$secret) {
            return false;
        }
        $expected = 'sha256=' . hash_hmac('sha256', (string) $rawBody, (string) $secret);
        return hash_equals($expected, $signatureHeader);
    }

    /** Verify + decode a webhook payload; null when invalid. */
    public static function parseWebhookEvent($rawBody, $signatureHeader, $secret)
    {
        if (!self::verifyWebhookSignature($rawBody, $signatureHeader, $secret)) {
            return null;
        }
        $decoded = json_decode((string) $rawBody, true);
        return is_array($decoded) ? $decoded : null;
    }

    // ── Transport ────────────────────────────────────────────────

    private function request($method, $path, $body = null, $headers = array())
    {
        $url = $this->baseUrl . '/' . ltrim($path, '/');
        // Normalise headers to "Name: value" strings — callers may
        // pass either full strings or name => value pairs.
        $allHeaders = array('X-Api-Key: ' . $this->apiKey, 'Content-Type: application/json');
        foreach ($headers as $name => $value) {
            $allHeaders[] = is_int($name) ? (string) $value : ($name . ': ' . $value);
        }
        $rawBody = $body !== null ? json_encode($body) : null;

        if ($this->transport !== null) {
            list($status, $text) = call_user_func($this->transport, $method, $url, $allHeaders, $rawBody);
        } else {
            list($status, $text) = $this->curlRequest($method, $url, $allHeaders, $rawBody);
        }

        $parsed = $text !== '' && $text !== null ? json_decode($text, true) : array();
        if (!is_array($parsed)) $parsed = array();
        if ($status < 200 || $status >= 300) {
            $code = isset($parsed['error']) ? $parsed['error'] : 'request_failed';
            $msg = isset($parsed['message']) ? $parsed['message'] : ('Request failed with HTTP ' . $status);
            throw new ApiException($status, $code, $msg);
        }
        return array_key_exists('data', $parsed) ? $parsed['data'] : $parsed;
    }

    private function curlRequest($method, $url, $headers, $rawBody)
    {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        if ($rawBody !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $rawBody);
        $text = curl_exec($ch);
        if ($text === false) {
            $err = curl_error($ch);
            curl_close($ch);
            throw new ApiException(0, 'network_error',
                'Couldn\'t reach BMaGlass Pay. Check the connection and try again. (' . $err . ')');
        }
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return array($status, $text);
    }
}
