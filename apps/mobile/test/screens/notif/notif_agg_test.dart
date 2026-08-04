// Unit tests for the mobile Notifications honest-derivation logic (route notif).
//
// These assert the parse/derive rules that keep the screen honest: display is
// derived from the REAL wire columns only, never a fabricated sentence, and the
// per-row kind comes from the real `type` enum (contract gap B-039 precedent).
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/screens/notif/notif_agg.dart';

void main() {
  group('parseNotif', () {
    test('projects the real wire columns onto a typed row', () {
      final NotifRow r = parseNotif(<String, Object?>{
        'id': 'n1',
        'type': 'approval',
        'ref': 'pr:abc-123',
        'read': false,
        'created_at': '2026-08-04T09:00:00.000Z',
      });
      expect(r.id, 'n1');
      expect(r.type, 'approval');
      expect(r.ref, 'pr:abc-123');
      expect(r.read, isFalse);
      expect(r.createdAt, DateTime.parse('2026-08-04T09:00:00.000Z'));
    });

    test('read is a strict boolean; a missing/absent value is unread', () {
      expect(parseNotif(<String, Object?>{'read': true}).read, isTrue);
      expect(parseNotif(<String, Object?>{'read': 'true'}).read, isFalse);
      expect(parseNotif(<String, Object?>{}).read, isFalse);
    });

    test('an unparsable/absent created_at yields a null timestamp', () {
      expect(
        parseNotif(<String, Object?>{'created_at': 'nope'}).createdAt,
        isNull,
      );
      expect(parseNotif(<String, Object?>{}).createdAt, isNull);
    });
  });

  group('displayTitle — never a fabricated sentence', () {
    test('prefers a stored title if a future schema adds one (B-039)', () {
      final NotifRow r = parseNotif(<String, Object?>{
        'title': 'PR ready',
        'ref': 'pr:abc-123',
      });
      expect(r.displayTitle, 'PR ready');
    });

    test('falls back to the real ref when there is no stored title', () {
      final NotifRow r = parseNotif(<String, Object?>{'ref': 'po:xyz-9'});
      expect(r.displayTitle, 'po:xyz-9');
    });

    test('is null (→ em-dash in the view) with neither title nor ref', () {
      expect(
        parseNotif(<String, Object?>{'type': 'info'}).displayTitle,
        isNull,
      );
    });
  });

  group('notifKind — derived from the real type enum only', () {
    test('maps the known types', () {
      expect(notifKind('approval'), NotifKind.approval);
      expect(notifKind('alert'), NotifKind.alert);
      expect(notifKind('info'), NotifKind.info);
    });

    test('any unknown/empty type falls back to the neutral kind', () {
      expect(notifKind('weird'), NotifKind.other);
      expect(notifKind(''), NotifKind.other);
    });
  });

  group('parseNotifs — newest-first over the real created_at', () {
    test('sorts by created_at desc; null timestamps sort last', () {
      final List<NotifRow> rows = parseNotifs(<Map<String, Object?>>[
        <String, Object?>{'id': 'mid', 'created_at': '2026-08-04T10:00:00Z'},
        <String, Object?>{'id': 'none'},
        <String, Object?>{'id': 'new', 'created_at': '2026-08-04T12:00:00Z'},
        <String, Object?>{'id': 'old', 'created_at': '2026-08-04T08:00:00Z'},
      ]);
      expect(rows.map((NotifRow r) => r.id).toList(), <String>[
        'new',
        'mid',
        'old',
        'none',
      ]);
    });
  });

  group('unread helpers', () {
    final List<NotifRow> rows = parseNotifs(<Map<String, Object?>>[
      <String, Object?>{'id': 'a', 'read': false},
      <String, Object?>{'id': 'b', 'read': true},
      <String, Object?>{'id': 'c', 'read': false},
      <String, Object?>{'id': '', 'read': false},
    ]);

    test('unreadCount counts every unread row', () {
      expect(unreadCount(rows), 3);
    });

    test('unreadIds excludes read rows and rows with no id', () {
      expect(unreadIds(rows), <String>['a', 'c']);
    });
  });
}
