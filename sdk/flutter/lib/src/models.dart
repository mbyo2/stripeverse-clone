/// Response models for the BMaGlass developer API. Field names match
/// the API (and the other SDKs) exactly.
class Wallet {
  final String id;
  final String currency;
  final double balance;
  final String status;

  const Wallet({required this.id, required this.currency, required this.balance, required this.status});

  factory Wallet.fromJson(Map<String, dynamic> json) => Wallet(
        id: json['id'] as String,
        currency: json['currency'] as String,
        balance: (json['balance'] as num).toDouble(),
        status: json['status'] as String? ?? 'active',
      );
}

class PaymentLink {
  final String id;
  final String title;
  final double? amount;
  final String currency;
  final String linkCode;
  final String status;
  final int paymentCount;
  final double totalCollected;

  const PaymentLink({
    required this.id,
    required this.title,
    required this.amount,
    required this.currency,
    required this.linkCode,
    required this.status,
    required this.paymentCount,
    required this.totalCollected,
  });

  factory PaymentLink.fromJson(Map<String, dynamic> json) => PaymentLink(
        id: json['id'] as String,
        title: json['title'] as String,
        amount: (json['amount'] as num?)?.toDouble(),
        currency: json['currency'] as String,
        linkCode: json['link_code'] as String,
        status: json['status'] as String,
        paymentCount: (json['payment_count'] as num?)?.toInt() ?? 0,
        totalCollected: (json['total_collected'] as num?)?.toDouble() ?? 0,
      );
}

class WebhookEndpoint {
  final String id;
  final String url;
  final List<String> events;
  final bool isActive;

  /// The signing secret — returned exactly once, at creation.
  final String? secret;

  const WebhookEndpoint({
    required this.id,
    required this.url,
    required this.events,
    required this.isActive,
    this.secret,
  });

  factory WebhookEndpoint.fromJson(Map<String, dynamic> json) => WebhookEndpoint(
        id: json['id'] as String,
        url: json['url'] as String,
        events: ((json['events'] as List?) ?? const []).map((e) => e.toString()).toList(),
        isActive: json['is_active'] as bool? ?? false,
        secret: json['secret'] as String?,
      );
}
