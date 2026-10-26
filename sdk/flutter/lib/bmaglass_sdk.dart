/// BMaGlass Pay SDK for Flutter / Dart.
///
/// A thin client over the BMaGlass Pay developer API — the same
/// surface as the TypeScript, Python, PHP and React Native SDKs.
///
/// Auth: an API key created in the BMaGlass Pay app. `bmp_live_`
/// keys move real money; `bmp_test_` keys are READ-ONLY — BMaGlass
/// Pay has no test-mode ledger, so a test key can never move money.
/// Writes with a test key throw a [BMaGlassException] with code
/// `test_mode_read_only`.
library bmaglass_sdk;

export 'src/client.dart';
export 'src/errors.dart';
export 'src/models.dart';
export 'src/webhook.dart';
