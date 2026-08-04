// MobileScreenRouter — maps a route id to its screen widget (MOB-SHELL-00).
//
// Structural equivalent of pototype/mobile-preview.jsx:109-145: a route id in,
// the matching screen out. A BUILT screen (registered in [mobileScreenBuilders])
// renders itself; every other KNOWN route (kMobileRoutes) renders an honest
// [ScreenPlaceholder]; an UNKNOWN id also renders a placeholder rather than
// crashing. This task registers no screens — each screen port adds one builder
// here and its id to kBuiltRouteIds.
import 'package:flutter/widgets.dart';

import 'mobile_routes.dart';
import 'screen_placeholder.dart';

/// Builders for the routes that have a real ported screen. Empty at
/// MOB-SHELL-00; a screen port adds `'<id>': (context) => const XScreen()` here
/// and its id to [kBuiltRouteIds].
const Map<String, WidgetBuilder> mobileScreenBuilders =
    <String, WidgetBuilder>{};

/// Resolves [routeId] to its widget: the built screen if registered, otherwise an
/// honest placeholder. Pure lookup, usable without pumping a widget.
Widget resolveMobileScreen(BuildContext context, String routeId) {
  final WidgetBuilder? builder = mobileScreenBuilders[routeId];
  if (builder != null) return builder(context);
  return ScreenPlaceholder(routeId: routeId);
}

class MobileScreenRouter extends StatelessWidget {
  const MobileScreenRouter({super.key, required this.route});

  /// The route id to render.
  final String route;

  @override
  Widget build(BuildContext context) => resolveMobileScreen(context, route);
}
