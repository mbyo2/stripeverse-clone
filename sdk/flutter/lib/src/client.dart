import 'dart:convert';

import 'package:http/http.dart' as http;

import 'errors.dart';
import 'models.dart';

/// BMaGlass Pay developer API client.
class BMaGlass {
  static const String defaultBase =
      'https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/developer-api';
  static const String siteBase = 'https://bmaglasspay.online';

  /// Currencies that have wallets. Anything else is refused — never
  /// converted silently.
  static const List<String> supportedCurrencies = ['ZMW', 'USD'];

  final String _apiKey;
  final String _baseUrl;
  final http.Client _http;

  /// "live" or "test", from the key prefix — same rule as the other SDKs.
  final String mode;

  BMaGlass({required String apiKey, String? baseUrl, http.Client? httpClient})
      : _apiKey = apiKey,
        _baseUrl = (baseUrl ?? defaultBase).replaceAll(RegExp(r'/$'), ''),
        _http = httpClient ?? http.Client(),
        mode = apiKey.startsWith('bmp_live_') ? 'live' : 'test' {
    if (!apiKey.startsWith('bmp_')) {
      throw const BMaGlassException(
          0, 'invalid_api_key', 'apiKey must be a BMaGlass Pay API key (bmp_live_... or bmp_test_...).');
    }
  }

  bool get isLive => mode == 'live';

  /// Hosted payment page URL for a link code.
  static String paymentLinkUrl(String linkCode) =>
      '$siteBase/pay/${Uri.encodeComponent(linkCode)}';

  /// Only currencies with wallets may be used; never invent an FX rate.
  static String assertSupportedCurrency(String currency) {
    final c = currency.toUpperCase();
    if (!supportedCurrencies.contains(c)) {
      throw BMaGlassException(0, 'unsupported_currency',
          "BMaGlass Pay wallets are ZMW and USD. This is $c, which has no BMaGlass wallet — no exchange rate has been applied. Use ZMW or USD with BMaGlass Pay.");
    }
    return c;
  }

  Future<dynamic> _request(String method, String path,
      {Map<String, dynamic>? body, Map<String, String>? headers}) async {
    final uri = Uri.parse('$_baseUrl/$path');
    final allHeaders = <String, String>{
      'X-Api-Key': _apiKey,
      'Content-Type': 'application/json',
      ...?headers,
    };
    http.Response res;
    try {
      switch (method) {
        case 'GET':
          res = await _http.get(uri, headers: allHeaders);
          break;
        case 'DELETE':
          res = await _http.delete(uri, headers: allHeaders);
          break;
        case 'POST':
          res = await _http.post(uri, headers: allHeaders, body: body == null ? null : jsonEncode(body));
          break;
        default:
          throw BMaGlassException(0, 'request_failed', 'Unsupported method $method');
      }
    } on BMaGlassException {
      rethrow;
    } catch (e) {
      throw BMaGlassException(0, 'network_error', "Couldn't reach BMaGlass Pay. Check the connection and try again. ($e)");
    }
    dynamic parsed = <String, dynamic>{};
    if (res.body.isNotEmpty) {
      try {
        parsed = jsonDecode(res.body);
      } catch (_) {
        parsed = <String, dynamic>{};
      }
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      final map = parsed is Map<String, dynamic> ? parsed : <String, dynamic>{};
      throw BMaGlassException(
        res.statusCode,
        (map['error'] ?? 'request_failed').toString(),
        (map['message'] ?? 'Request failed with HTTP ${res.statusCode}').toString(),
      );
    }
    if (parsed is Map<String, dynamic> && parsed.containsKey('data')) return parsed['data'];
    return parsed;
  }

  /// GET /wallets — the key owner's wallets with balances.
  Future<List<Wallet>> wallets() async {
    final data = await _request('GET', 'wallets') as List<dynamic>;
    return data.map((e) => Wallet.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// GET /transactions?limit=
  Future<List<Map<String, dynamic>>> transactions({int limit = 25}) async {
    final clamped = limit.clamp(1, 100);
    final data = await _request('GET', 'transactions?limit=$clamped') as List<dynamic>;
    return data.map((e) => e as Map<String, dynamic>).toList();
  }

  /// POST /transfers — wallet-to-wallet transfer (live keys only;
  /// 1.5% fee charged on top by the API, exactly like the app).
  Future<Map<String, dynamic>> createTransfer({
    required String toUserId,
    required num amount,
    String currency = 'ZMW',
    String? description,
    String? recipientName,
    String? idempotencyKey,
  }) async {
    final body = <String, dynamic>{
      'to_user_id': toUserId,
      'amount': amount,
      'currency': assertSupportedCurrency(currency),
      if (description != null) 'description': description,
      if (recipientName != null) 'recipient_name': recipientName,
    };
    final data = await _request('POST', 'transfers',
        body: body,
        headers: idempotencyKey == null ? null : {'Idempotency-Key': idempotencyKey});
    return data as Map<String, dynamic>;
  }

  /// GET /payment-links
  Future<List<PaymentLink>> listPaymentLinks() async {
    final data = await _request('GET', 'payment-links') as List<dynamic>;
    return data.map((e) => PaymentLink.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// POST /payment-links — create a hosted payment link (live keys only).
  Future<PaymentLink> createPaymentLink({
    required String title,
    double? amount,
    String currency = 'ZMW',
    String? description,
    String? expiresAt,
  }) async {
    final body = <String, dynamic>{
      'title': title,
      'currency': assertSupportedCurrency(currency),
      if (amount != null) 'amount': amount,
      if (description != null) 'description': description,
      if (expiresAt != null) 'expires_at': expiresAt,
    };
    final data = await _request('POST', 'payment-links', body: body) as Map<String, dynamic>;
    return PaymentLink.fromJson(data);
  }

  /// GET /bitcoin/balance
  Future<List<Map<String, dynamic>>> bitcoinBalance() async {
    final data = await _request('GET', 'bitcoin/balance') as List<dynamic>;
    return data.map((e) => e as Map<String, dynamic>).toList();
  }

  /// GET /bitcoin/deposit-address (throws 404 no_deposit_address if none issued).
  Future<Map<String, dynamic>> bitcoinDepositAddress() async {
    final data = await _request('GET', 'bitcoin/deposit-address') as Map<String, dynamic>;
    return data;
  }

  /// POST /bitcoin/quote — quote only; execution stays in the app.
  Future<Map<String, dynamic>> bitcoinQuote({required String side, num? amountZmw, num? amountSats}) async {
    final body = <String, dynamic>{
      'side': side == 'sell' ? 'sell' : 'buy',
      if (amountZmw != null) 'amount_zmw': amountZmw,
      if (amountSats != null) 'amount_sats': amountSats,
    };
    final data = await _request('POST', 'bitcoin/quote', body: body) as Map<String, dynamic>;
    return data;
  }

  /// GET /webhooks (secrets are never returned).
  Future<List<WebhookEndpoint>> listWebhooks() async {
    final data = await _request('GET', 'webhooks') as List<dynamic>;
    return data.map((e) => WebhookEndpoint.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// POST /webhooks — the response includes the signing [secret]
  /// exactly once; store it immediately.
  Future<WebhookEndpoint> createWebhook({required String url, List<String>? events}) async {
    final body = <String, dynamic>{
      'url': url,
      if (events != null) 'events': events,
    };
    final data = await _request('POST', 'webhooks', body: body) as Map<String, dynamic>;
    return WebhookEndpoint.fromJson(data);
  }

  /// DELETE /webhooks/{id}
  Future<Map<String, dynamic>> deleteWebhook(String webhookId) async {
    final data = await _request('DELETE', 'webhooks/${Uri.encodeComponent(webhookId)}') as Map<String, dynamic>;
    return data;
  }

  /// POST /webhooks/{id}/test — send a signed webhook.test event.
  Future<dynamic> testWebhook(String webhookId) =>
      _request('POST', 'webhooks/${Uri.encodeComponent(webhookId)}/test');

  /// GET /webhook-deliveries
  Future<List<Map<String, dynamic>>> webhookDeliveries() async {
    final data = await _request('GET', 'webhook-deliveries') as List<dynamic>;
    return data.map((e) => e as Map<String, dynamic>).toList();
  }
}
