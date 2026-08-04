// Device geolocation seam for the PM check-in (B-242 slice / F-1).
//
// The PM check-in POSTs a REAL device coordinate to
//   POST /pm/workorders/{id}/checkin { gps }   (pm.ts — gps is REQUIRED, 400 on blank)
// so the app must obtain an honest fix. This seam keeps the geolocator plugin behind
// a one-method interface so:
//   - the screen depends on [GpsSource], never on Geolocator directly;
//   - tests + CI inject a fake and NEVER touch a device sensor / platform channel;
//   - a denied / disabled / no-fix outcome is a plain `null` (the screen renders an
//     honest "can't check in" state) — a coordinate is NEVER fabricated.
import 'package:geolocator/geolocator.dart';

/// A source of the device's current coordinate.
abstract interface class GpsSource {
  /// The current fix as the string the endpoint stores ("<lat>, <long>"), or null
  /// when a real coordinate cannot be obtained (permission denied, location services
  /// off, or no fix). NEVER a fabricated coordinate.
  Future<String?> currentFix();
}

/// [GpsSource] backed by the geolocator plugin. Requests permission when needed,
/// reads one fix, and formats it. Any failure (denied, services off, sensor error)
/// resolves to null — the honest "no coordinate" outcome.
///
/// NATIVE PERMISSION CONFIG — required per platform when it is scaffolded. This app
/// is currently web-only (`.metadata` registers root + web); the browser Geolocation
/// API prompts at runtime and needs NO manifest. When iOS / Android are added
/// (`flutter create --platforms=ios,android`), add the following (native config, not
/// UI copy — a neutral English usage string is correct):
///   - iOS  ios/Runner/Info.plist:
///       <key>NSLocationWhenInUseUsageDescription</key>
///       <string>Your location confirms an on-site check-in for a work order.</string>
///   - Android android/app/src/main/AndroidManifest.xml (inside <manifest>):
///       <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
///       <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
class GeolocatorGpsSource implements GpsSource {
  const GeolocatorGpsSource();

  @override
  Future<String?> currentFix() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return null;

      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return null;
      }

      // whileInUse / always / (web) unableToDetermine → attempt a fix; the call
      // itself prompts on web browsers without the Permission API.
      final Position pos = await Geolocator.getCurrentPosition();
      return formatGpsFix(pos.latitude, pos.longitude);
    } on Object {
      // Any sensor/permission/transport error is an honest "no fix", never a
      // fabricated coordinate.
      return null;
    }
  }
}

/// Format a coordinate as "<lat>, <long>" — the shape checkin_gps is stored in
/// (pm.ts). Six decimals is ~0.1 m precision, plenty for a site check-in. Pure +
/// testable; carries no device dependency.
String formatGpsFix(double lat, double lng) {
  String c(double v) => v.toStringAsFixed(6);
  return '${c(lat)}, ${c(lng)}';
}
