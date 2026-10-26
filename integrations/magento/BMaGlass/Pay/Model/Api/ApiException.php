<?php

namespace BMaGlass\Pay\Model\Api;

use Exception;

/**
 * Typed API error: HTTP status + the API's stable error code.
 * Mirrors BMaGlassError in the TypeScript and Python SDKs.
 */
class ApiException extends Exception
{
    /** @var int HTTP status (0 for client-side validation). */
    public $status;
    /** @var string Stable API error code, e.g. test_mode_read_only. */
    public $errorCode;

    public function __construct($status, $errorCode, $message)
    {
        parent::__construct($message);
        $this->status = (int) $status;
        $this->errorCode = (string) $errorCode;
    }

    public function isTestModeReadOnly()
    {
        return $this->errorCode === 'test_mode_read_only';
    }

    /**
     * Plain-language message safe to show a merchant or buyer —
     * never a raw system response.
     */
    public function userMessage()
    {
        switch ($this->errorCode) {
            case 'test_mode_read_only':
                return 'This BMaGlass API key is a test key. Test keys can check the '
                    . 'connection and read wallets, but they can\'t take payments — '
                    . 'BMaGlass Pay has no test-mode ledger, so a test key can never '
                    . 'move money. Use a live key (bmp_live_...) to accept payments.';
            case 'invalid_api_key':
            case 'api_key_revoked':
            case 'api_key_expired':
                return 'That BMaGlass API key wasn\'t accepted. Check the key in your '
                    . 'BMaGlass Pay account (Business settings or the API page) and try again.';
            case 'insufficient_scope':
                return 'This BMaGlass API key doesn\'t have permission for that action. '
                    . 'Create a key with the needed scopes in BMaGlass Pay and try again.';
            case 'unsupported_currency':
                return $this->getMessage();
            default:
                $msg = $this->getMessage();
                return $msg !== '' ? $msg
                    : 'BMaGlass Pay couldn\'t complete that request (HTTP ' . $this->status . '). Please try again.';
        }
    }
}
