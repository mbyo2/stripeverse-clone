/// Typed API error: HTTP status + the API's stable error code.
/// Mirrors BMaGlassError in the TypeScript SDK.
class BMaGlassException implements Exception {
  final int status;
  final String code;
  final String message;

  const BMaGlassException(this.status, this.code, this.message);

  bool get isTestModeReadOnly => code == 'test_mode_read_only';

  /// Plain-language message safe to show a user — never raw.
  String userMessage() {
    switch (code) {
      case 'test_mode_read_only':
        return "This BMaGlass API key is a test key. Test keys can check the "
            "connection and read wallets, but they can't take payments — "
            "BMaGlass Pay has no test-mode ledger, so a test key can never "
            "move money. Use a live key (bmp_live_...) to accept payments.";
      case 'invalid_api_key':
      case 'api_key_revoked':
      case 'api_key_expired':
        return "That BMaGlass API key wasn't accepted. Check the key in your "
            "BMaGlass Pay account (Business settings or the API page) and try again.";
      case 'insufficient_scope':
        return "This BMaGlass API key doesn't have permission for that action. "
            "Create a key with the needed scopes in BMaGlass Pay and try again.";
      case 'unsupported_currency':
        return message;
      default:
        return message.isNotEmpty
            ? message
            : "BMaGlass Pay couldn't complete that request (HTTP $status). Please try again.";
    }
  }

  @override
  String toString() => 'BMaGlassException($status, $code): $message';
}
