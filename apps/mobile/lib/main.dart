import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'app/app_scope.dart';
import 'app/app_services.dart';
import 'app/sync_resume_drain.dart';
import 'i18n/i18n.dart';
import 'shell/mobile_shell.dart';
import 'theme/juneflow_theme.dart';

// Juneflow mobile — app shell (MOB-SHELL-00).
//
// Boots the runtime services (i18n, Dio + generated API client, the durable
// offline queue + its one shared drain processor — see AppServices), wraps the home
// in the queue's resume-drain trigger, then runs the 5-tab shell. Screens are ported
// one by
// one from pototype/mobile*.jsx under the Design Fidelity Protocol (PLAN.md §0);
// until a screen lands the router shows an honest placeholder.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final AppServices services = await AppServices.bootstrap();
  runApp(JuneflowApp(services: services));
}

class JuneflowApp extends StatelessWidget {
  const JuneflowApp({super.key, required this.services});

  final AppServices services;

  @override
  Widget build(BuildContext context) {
    // Locale + layout direction come from the i18n runtime (langs[].dir in the
    // sacred source), never hardcoded (PLAN.md §0 rule 2). Thai is ltr today; an
    // Arabic tenant would flip the whole app to rtl through this one path.
    final TextDirection direction = services.i18n.isRTL()
        ? TextDirection.rtl
        : TextDirection.ltr;

    return AppScope(
      services: services,
      child: MaterialApp(
        title: 'Juneflow',
        debugShowCheckedModeBanner: false,
        // ThemeData GENERATED from packages/tokens (fiori). Never hand-edited —
        // change tokens at the source and regenerate (apps/mobile/CLAUDE.md).
        theme: juneflowFioriTheme(),
        locale: Locale(services.i18n.lang),
        // The app's languages come from the i18n runtime (langs in the sacred
        // source). The Global delegates supply Material/Cupertino strings for
        // each, so forcing a non-en locale never leaves a widget without
        // localizations.
        supportedLocales: <Locale>[
          for (final LangDef l in services.i18n.langs) Locale(l.code),
        ],
        localizationsDelegates: const <LocalizationsDelegate<Object>>[
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        builder: (BuildContext context, Widget? child) => Directionality(
          textDirection: direction,
          child: child ?? const SizedBox.shrink(),
        ),
        // The offline queue's app-lifecycle drain trigger (B-262). It wraps the
        // HOME rather than a screen: that is what makes a queued write replay on
        // app resume regardless of which screen is showing — or whether any screen
        // that can enqueue is mounted at all.
        home: SyncResumeDrain(
          processor: services.syncProcessor,
          child: const MobileShell(),
        ),
      ),
    );
  }
}
