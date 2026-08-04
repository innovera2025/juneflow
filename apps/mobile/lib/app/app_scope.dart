// InheritedWidget that exposes [AppServices] to the widget tree (MOB-SHELL-00).
//
// No third-party state-management package is in pubspec.yaml, and the shell does
// not need one: the services are built once and never replaced, so a plain
// InheritedWidget is the lightest correct way to reach them from any screen with
// `AppScope.of(context)`.
import 'package:flutter/widgets.dart';

import 'app_services.dart';

class AppScope extends InheritedWidget {
  const AppScope({super.key, required this.services, required super.child});

  final AppServices services;

  /// The services for the nearest [AppScope] above [context].
  static AppServices of(BuildContext context) {
    final AppScope? scope = context
        .dependOnInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, 'AppScope.of() called with no AppScope in the tree');
    return scope!.services;
  }

  @override
  bool updateShouldNotify(AppScope oldWidget) =>
      !identical(services, oldWidget.services);
}
