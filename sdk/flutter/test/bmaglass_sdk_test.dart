// Tests for the BMaGlass Flutter/Dart SDK.
//
// Run where a Dart/Flutter toolchain exists:
//   cd sdk/flutter && dart test        (or: flutter test)
//
// Uses http's MockClient (package:http/testing.dart) — no network.
// The webhook checks use the SHARED cross-SDK known-answer vector,
// identical in the TS, Python, PHP, Odoo, WooCommerce and React
// Native test suites.
import 'dart:convert';

import 'package:bmaglass_sdk/bmaglass_sdk.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

http.Client stubClient() {
  return MockClient((req) async {
    final key = req.headers['x-api-key'] ?? '';
    if (!key.startsWith('bmp_')) {
      return http.Response(jsonEncode({'error': 'invalid_api_key', 'message': 'nope'}), 401);
    }
    if (req.url.path.endsWith('/wallets')) {
      return http.Response(
          jsonEncode({
            'data': [
              {'id': 'w1', 'currency': 'ZMW', 'balance': 42, 'status': 'active'}
            ],
            'mode': 'test'
          }),
          200);
    }
    if (req.url.path.endsWith('/payment-links') && req.method == 'POST') {
      if (key.startsWith('bmp_test_')) {
        return http.Response(
            jsonEncode({'error': 'test_mode_read_only', 'message': 'Test keys are read-only'}), 403);
      }
      final body = jsonDecode(req.body) as Map<String, dynamic>;
      return http.Response(
          jsonEncode({
            'data': {
              'id': 'pl1',
              'title': body['title'],
              'amount': body['amount'],
              'currency': body['currency'],
              'link_code': 'ABC123',
              'status': 'active',
              'payment_count': 0,
              'total_collected': 0
            },
            'mode': 'live'
          }),
          201);
    }
    return http.Response(jsonEncode({'error': 'not_found', 'message': 'no route'}), 404);
  });
}

void main() {
  group('webhook verification (shared known-answer vector)', () {
    const raw = '{"id":"evt_1","type":"webhook.test","created":"2026-10-26T00:00:00.000Z","data":{"ping":true}}';
    const sig = 'sha256=ff522c97ada5bfd4f6c09a0457823f89546896708e8e1f5bbb72d2ad59d68535';
    test('valid signature verifies', () {
      expect(verifyWebhookSignature(raw, sig, 'whsec_testsecret'), isTrue);
    });
    test('wrong secret fails', () {
      expect(verifyWebhookSignature(raw, sig, 'whsec_wrong'), isFalse);
    });
    test('parseWebhookEvent returns the event', () {
      expect(parseWebhookEvent(raw, sig, 'whsec_testsecret')?['type'], 'webhook.test');
    });
  });

  group('client', () {
    test('mode from prefix', () {
      expect(BMaGlass(apiKey: 'bmp_test_contract', httpClient: stubClient()).mode, 'test');
      expect(BMaGlass(apiKey: 'bmp_live_contract', httpClient: stubClient()).mode, 'live');
    });
    test('foreign key rejected', () {
      expect(() => BMaGlass(apiKey: 'sk_live_nope', httpClient: stubClient()),
          throwsA(isA<BMaGlassException>()));
    });
    test('wallets parse', () async {
      final client = BMaGlass(apiKey: 'bmp_test_contract', baseUrl: 'http://local.test', httpClient: stubClient());
      final wallets = await client.wallets();
      expect(wallets.single.balance, 42);
      expect(wallets.single.currency, 'ZMW');
    });
    test('payment link create (live key)', () async {
      final client = BMaGlass(apiKey: 'bmp_live_contract', baseUrl: 'http://local.test', httpClient: stubClient());
      final link = await client.createPaymentLink(title: 'Order #7', amount: 10.5, currency: 'zmw');
      expect(link.linkCode, 'ABC123');
      expect(BMaGlass.paymentLinkUrl('ABC123'), 'https://bmaglasspay.online/pay/ABC123');
    });
    test('test-key write maps to crafted message', () async {
      final client = BMaGlass(apiKey: 'bmp_test_contract', baseUrl: 'http://local.test', httpClient: stubClient());
      try {
        await client.createPaymentLink(title: 'Nope', amount: 5);
        fail('should have thrown');
      } on BMaGlassException catch (e) {
        expect(e.code, 'test_mode_read_only');
        expect(e.isTestModeReadOnly, isTrue);
        expect(e.userMessage(), contains('no test-mode ledger'));
      }
    });
    test('unsupported currency refused client-side', () async {
      final client = BMaGlass(apiKey: 'bmp_live_contract', baseUrl: 'http://local.test', httpClient: stubClient());
      expect(() async => client.createPaymentLink(title: 'Euro', amount: 5, currency: 'EUR'),
          throwsA(predicate((e) => e is BMaGlassException && e.code == 'unsupported_currency')));
    });
  });
}
