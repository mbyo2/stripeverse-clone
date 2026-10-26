import 'dart:convert';

import 'package:convert/convert.dart';
import 'package:crypto/crypto.dart';

/// Verify an `X-BMaGlass-Signature` header (`sha256=<hex>`) over the
/// exact raw request body. Same scheme as the other SDKs.
bool verifyWebhookSignature(String rawBody, String signatureHeader, String secret) {
  if (!signatureHeader.startsWith('sha256=') || secret.isEmpty) return false;
  final mac = Hmac(sha256, utf8.encode(secret));
  final expected = 'sha256=${hex.encode(mac.convert(utf8.encode(rawBody)).bytes)}';
  return _timingSafeEquals(expected, signatureHeader);
}

/// Verify + decode a webhook payload; null when invalid.
Map<String, dynamic>? parseWebhookEvent(String rawBody, String signatureHeader, String secret) {
  if (!verifyWebhookSignature(rawBody, signatureHeader, secret)) return null;
  try {
    final decoded = jsonDecode(rawBody);
    return decoded is Map<String, dynamic> ? decoded : null;
  } catch (_) {
    return null;
  }
}

bool _timingSafeEquals(String a, String b) {
  if (a.length != b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.codeUnitAt(i) ^ b.codeUnitAt(i);
  }
  return diff == 0;
}
