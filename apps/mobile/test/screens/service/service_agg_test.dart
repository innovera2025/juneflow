// Unit tests for the shared after-sales SERVICE derivations (service_agg.dart).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard.
// Everything under test is PURE (no Flutter, no Dio, no i18n), so these assertions
// pin the real behaviours: the SV-3 machine, the opaque-row narrowing, the timeline's
// honest date gaps, the unit-scoped history, the "mine" scoping, the two derivable
// stat counts, and the create body's refusal to send a key no column backs.
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/screens/service/service_agg.dart';

ServiceEnt _row({
  String id = 't1',
  String no = 'SR-2026-0048',
  String unitId = 'u1',
  String category = 'ระบบประปา',
  String title = 'ก๊อกน้ำห้องครัวรั่ว',
  String priority = 'normal',
  String status = 'received',
  String assignee = 'me',
  String opened = '2026-05-23',
  String scheduled = '',
  Object? warrantyMonths,
}) => <String, Object?>{
  'id': id,
  'no': no,
  'unit_id': unitId,
  'customer_id': 'c1',
  'channel': 'LINE',
  'category': category,
  'title': title,
  'priority': priority,
  'status': status,
  'assignee_user_id': assignee,
  'opened_date': opened,
  'scheduled_date': scheduled,
  'warranty': true,
  'warranty_months_remaining': warrantyMonths,
};

void main() {
  group('the SV-3 machine is the single source of the legal move', () {
    test('each status offers exactly its one legal transition', () {
      expect(nextServiceTransition('received')!.op, ServiceOp.schedule);
      expect(nextServiceTransition('received')!.next, 'scheduled');
      expect(nextServiceTransition('scheduled')!.op, ServiceOp.start);
      expect(nextServiceTransition('scheduled')!.next, 'fixing');
      expect(nextServiceTransition('fixing')!.op, ServiceOp.fix);
      expect(nextServiceTransition('fixing')!.next, 'fixed');
      expect(nextServiceTransition('fixed')!.op, ServiceOp.close);
      expect(nextServiceTransition('fixed')!.next, 'closed');
    });

    test('closed is terminal and an unknown status offers nothing', () {
      // No screen may render an advance button for either — an illegal jump is
      // exactly what the server 409s, and the affordance must not suggest it.
      expect(nextServiceTransition('closed'), isNull);
      expect(nextServiceTransition(''), isNull);
      expect(nextServiceTransition('cancelled'), isNull);
    });

    test('op paths match the four registered routes', () {
      expect(serviceOpPath(ServiceOp.schedule), 'schedule');
      expect(serviceOpPath(ServiceOp.start), 'start');
      expect(serviceOpPath(ServiceOp.fix), 'fix');
      expect(serviceOpPath(ServiceOp.close), 'close');
    });

    test('the status order and steps mirror the server machine', () {
      expect(kServiceStatuses, <String>[
        'received',
        'scheduled',
        'fixing',
        'fixed',
        'closed',
      ]);
      expect(serviceStep('received'), 1);
      expect(serviceStep('closed'), 5);
      // An unknown status has no step: progress is unknown, not step 1.
      expect(serviceStep('nope'), isNull);
    });
  });

  group('parseTicket narrows the opaque wire without inventing', () {
    test('reads the real columns, snake_case or camelCase', () {
      final ServiceTicket t = parseTicket(_row(warrantyMonths: 11));
      expect(t.no, 'SR-2026-0048');
      expect(t.title, 'ก๊อกน้ำห้องครัวรั่ว');
      expect(t.category, 'ระบบประปา');
      expect(t.unitId, 'u1');
      expect(t.openedDate, '2026-05-23');
      expect(t.warranty, isTrue);
      expect(t.warrantyMonthsRemaining, 11);

      final ServiceTicket camel = parseTicket(<String, Object?>{
        'id': 'x',
        'unitId': 'u9',
        'assigneeUserId': 'me',
        'scheduledDate': '2026-05-27',
        'warrantyMonthsRemaining': '7',
      });
      expect(camel.unitId, 'u9');
      expect(camel.assigneeUserId, 'me');
      expect(camel.scheduledDate, '2026-05-27');
      expect(camel.warrantyMonthsRemaining, 7);
    });

    test('a missing warranty number stays null — never defaulted to 0/12', () {
      expect(parseTicket(_row()).warrantyMonthsRemaining, isNull);
      expect(
        parseTicket(_row(warrantyMonths: '')).warrantyMonthsRemaining,
        isNull,
      );
      expect(
        parseTicket(_row(warrantyMonths: 'n/a')).warrantyMonthsRemaining,
        isNull,
      );
      // 0 is a REAL value (an expired warranty) and must survive as 0.
      expect(parseTicket(_row(warrantyMonths: 0)).warrantyMonthsRemaining, 0);
    });

    test('absent string columns read as "" — never the text "null"', () {
      final ServiceTicket t = parseTicket(<String, Object?>{'id': 'x'});
      expect(t.no, '');
      expect(t.title, '');
      expect(t.scheduledDate, '');
      expect(t.warranty, isFalse);
    });
  });

  group('timelineFor is honest about the dates the schema does not have', () {
    test('only received and scheduled can ever carry a date', () {
      final List<ServiceTimelineStep> steps = timelineFor(
        parseTicket(
          _row(status: 'closed', opened: '2026-05-23', scheduled: '2026-05-27'),
        ),
      );
      expect(steps.map((ServiceTimelineStep s) => s.date).toList(), <String>[
        '2026-05-23',
        '2026-05-27',
        // fixing / fixed / closed have NO timestamp column on service_ticket.
        '',
        '',
        '',
      ]);
    });

    test('done/current follow the real status', () {
      final List<ServiceTimelineStep> steps = timelineFor(
        parseTicket(_row(status: 'fixing')),
      );
      expect(steps.map((ServiceTimelineStep s) => s.done).toList(), <bool>[
        true,
        true,
        true,
        false,
        false,
      ]);
      expect(steps.map((ServiceTimelineStep s) => s.current).toList(), <bool>[
        false,
        false,
        true,
        false,
        false,
      ]);
    });

    test(
      'an unknown status marks nothing done rather than claiming step 1',
      () {
        final List<ServiceTimelineStep> steps = timelineFor(
          parseTicket(_row(status: 'weird')),
        );
        expect(steps.every((ServiceTimelineStep s) => !s.done), isTrue);
        expect(steps.every((ServiceTimelineStep s) => !s.current), isTrue);
      },
    );
  });

  group('serviceDateText renders the house numeric date, never the wire', () {
    test('a wire date becomes d/m/yyyy (the merged pr-detail contract)', () {
      expect(serviceDateText('2026-05-23'), '23/5/2026');
      expect(serviceDateText('2026-12-25'), '25/12/2026');
      // The raw wire string never reaches a screen.
      expect(serviceDateText('2026-05-23'), isNot(contains('-')));
    });

    test('an ISO datetime keeps its DATE part (no timezone shift)', () {
      expect(serviceDateText('2026-05-23T00:00:00.000Z'), '23/5/2026');
    });

    test('anything that is not a date em-dashes, never leaks through', () {
      expect(serviceDateText(''), kServiceDash);
      expect(serviceDateText('not-a-date'), kServiceDash);
      expect(serviceDateText('2026-05'), kServiceDash);
    });
  });

  group('the tracked ticket and its unit history', () {
    final List<ServiceTicket> rows = parseTickets(<ServiceEnt>[
      _row(id: 'a', no: 'SR-1', unitId: 'u1'),
      _row(id: 'b', no: 'SR-2', unitId: 'u1'),
      _row(id: 'c', no: 'SR-3', unitId: 'u2'),
    ]);

    test('no selection follows the register\'s newest (first) row', () {
      // GET /sales/service is ordered created_at desc server-side.
      expect(trackedTicket(rows, null)!.id, 'a');
      expect(trackedTicket(rows, '')!.id, 'a');
    });

    test('a selected id wins, and an unknown id is honest-null', () {
      expect(trackedTicket(rows, 'c')!.id, 'c');
      // NOT a silent fall-through to somebody else's ticket.
      expect(trackedTicket(rows, 'missing'), isNull);
      expect(trackedTicket(const <ServiceTicket>[], null), isNull);
    });

    test('history is the same unit only, excluding the tracked ticket', () {
      final List<ServiceTicket> h = unitHistory(rows, rows.first);
      expect(h.map((ServiceTicket t) => t.id).toList(), <String>['b']);
    });

    test(
      'a ticket with no unit gets an EMPTY history, not everyone else\'s',
      () {
        final ServiceTicket noUnit = parseTicket(_row(id: 'z', unitId: ''));
        expect(unitHistory(<ServiceTicket>[...rows, noUnit], noUnit), isEmpty);
      },
    );
  });

  group('tech-jobs scoping and the two derivable stat counts', () {
    final List<ServiceTicket> rows = parseTickets(<ServiceEnt>[
      _row(id: 'a', assignee: 'me', priority: 'high', scheduled: '2026-08-05'),
      _row(
        id: 'b',
        assignee: 'me',
        priority: 'normal',
        scheduled: '2026-08-06',
      ),
      _row(
        id: 'c',
        assignee: 'other',
        priority: 'high',
        scheduled: '2026-08-05',
      ),
    ]);

    test('only my assigned tickets survive the filter', () {
      expect(assignedTo(rows, 'me').map((ServiceTicket t) => t.id), <String>[
        'a',
        'b',
      ]);
    });

    test('no identity => EMPTY, never the whole tenant register', () {
      // The screen's title claims "my jobs"; with no id nothing can be claimed.
      expect(assignedTo(rows, ''), isEmpty);
    });

    test('the stat tiles are real counts off real columns', () {
      final List<ServiceTicket> mine = assignedTo(rows, 'me');
      expect(countScheduledOn(mine, '2026-08-05'), 1);
      expect(countScheduledOn(mine, '2026-08-06'), 1);
      expect(countScheduledOn(mine, '2026-01-01'), 0);
      // An unknown "today" counts nothing rather than matching blank columns.
      expect(countScheduledOn(mine, ''), 0);
      expect(countHighPriority(mine), 1);
    });

    test('todayIso is a zero-padded local ISO date', () {
      expect(serviceTodayIso(DateTime(2026, 1, 9)), '2026-01-09');
    });
  });

  group('newTicketBody sends only keys the schema really has', () {
    test('title is always sent and trimmed', () {
      expect(newTicketBody(title: '  leak  '), <String, Object?>{
        'title': 'leak',
      });
    });

    test('unit and category ride along only when present', () {
      expect(
        newTicketBody(title: 'leak', unitId: 'u1', category: 'ระบบประปา'),
        <String, Object?>{
          'title': 'leak',
          'unit_id': 'u1',
          'category': 'ระบบประปา',
        },
      );
      // Blank => the column stays NULL rather than storing a placeholder.
      expect(
        newTicketBody(title: 'leak', unitId: '   ', category: '').keys,
        <String>['title'],
      );
    });

    test('never sends a key no column backs, nor a server-owned one', () {
      final Map<String, Object?> body = newTicketBody(
        title: 'leak',
        unitId: 'u1',
        category: 'ระบบประปา',
      );
      for (final String forbidden in <String>[
        'description', // no column (BLOCKERS.md B-293)
        'photos',
        'note',
        'scheduled_date', // means "the appointment set", not a wish
        'channel', // the form never asks
        'priority', // no control on the mobile form
        'status', // server start state
        'no', // server allocator
        'opened_date', // server stamp
        'rating', // no column anywhere (B-294)
      ]) {
        expect(
          body.containsKey(forbidden),
          isFalse,
          reason: 'create body must not carry "$forbidden"',
        );
      }
    });

    test('submission is gated on the server\'s one required field', () {
      expect(canSubmitNewTicket(''), isFalse);
      expect(canSubmitNewTicket('   '), isFalse);
      expect(canSubmitNewTicket('leak'), isTrue);
    });
  });

  group('parseMeUser', () {
    test('reads the /me profile shape', () {
      final ServiceUser u = parseMeUser(<String, Object?>{
        'user': <String, Object?>{'id': 'u-1', 'name': 'ช่างวิชัย'},
        'role': null,
      });
      expect(u.id, 'u-1');
      expect(u.name, 'ช่างวิชัย');
    });

    test('an unexpected body yields empty fields, never a fake identity', () {
      expect(parseMeUser(<String, Object?>{}).id, '');
      expect(parseMeUser(<String, Object?>{'user': 'nope'}).name, '');
    });
  });
}
