// Public surface of the mobile i18n runtime (MOB-I18N-01).
//
//   import 'package:juneflow_mobile/i18n/i18n.dart';
//
//   final i18n = await JuneflowI18n.load();
//   final s    = await ScreenStrings.load('approval_inbox');
//   Text(i18n.tp(s['title']));   // key comes from the sidecar, text from the file
//
// See juneflow_theme.dart for the styling half of the same rule: values come from
// generated sources, never from literals typed into a screen.
export 'juneflow_i18n.dart';
export 'screen_strings.dart';
