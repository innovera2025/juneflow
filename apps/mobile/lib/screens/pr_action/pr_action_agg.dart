// Pure parse + honest derivations for the mobile PR approve / reject action
// sheets (routes `approve`, `reject`; pototype/mobile.jsx MobileApproveSheet
// L393-458 + MobileRejectSheet L460-541). authority = SERVER.
//
// The prototype is a MOCK: both sheets hardcode a single PR (a fixed no + amount)
// and, for approve, a hardcoded next-approver card (name / role / tier position).
// Per §0 rule 3 (strip mock mechanics) none of that mock data is
// reproduced. This module parses the OPAQUE Entity the real GET /pr/{id} handler
// returns (apps/api/src/routes/pr.ts prWire) into a typed projection, then derives
// ONLY what the real wire columns support.
//
// This mirrors apps/web/src/screens/pr/pr-form-rows.ts (the merged web port of the
// SAME endpoint family). The real detail wire is
//   { id, no, type, project_id, need_date, status, approval_step, currency_code,
//     amount, title, phase, vendor_id, requester_id, submitted_at, approved_at,
//     vendor, requester, items:[{id, pr_id, boq_item_id, qty, price, amount}] }.
// authority = SERVER: `amount` is the server Σ of the priced lines (never
// client-computed here — this module only READS it), and the tiered approval
// decision (B-070) is the server's. The prototype's next-approver card + budget
// bar + attachments have NO basic wire (the generalized detail endpoint is B-252,
// deferred) → the view omits them, never invents them.
//
// No Flutter, no i18n, no Dio here — every derivation stays unit-testable.

/// An opaque contract Entity — GET /pr/{id} returns `{ [k]: unknown }`.
typedef PrEnt = Map<String, Object?>;

/// Non-empty string at [key], else null.
String? prStr(PrEnt e, String key) {
  final Object? v = e[key];
  if (v is String) return v.isEmpty ? null : v;
  return null;
}

/// Number at [key] as a double (JSON may serialise it as int or double), else 0.
double prNum(PrEnt e, String key) {
  final Object? v = e[key];
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v) ?? 0;
  return 0;
}

/// A typed projection of one PR detail row (only the columns the sheets show).
class PrDetail {
  const PrDetail({
    required this.id,
    required this.no,
    required this.status,
    required this.currencyCode,
    required this.amount,
    required this.itemCount,
  });

  /// The PR id (path id the action endpoints act on).
  final String id;

  /// The document number (e.g. "PR-2026-0418"), or null when absent → em-dash.
  final String? no;

  /// Lifecycle status — draft | pending | approved | rejected.
  final String status;

  /// Currency code of the server-derived amount (money always carries currency).
  final String currencyCode;

  /// Server Σ of the priced lines (ex-VAT). READ only — never recomputed here.
  final double amount;

  /// Count of real priced lines (the honest lines-summary).
  final int itemCount;

  /// Only a pending PR can be approved or rejected (pr.ts returns 409 otherwise);
  /// the SERVER enforces this, this flag lets the sheet gate its action honestly.
  bool get isPending => status == 'pending';
}

/// Parse one opaque Entity detail row into a typed [PrDetail]. `null` in →
/// `null` out (the caller renders an honest "no PR" state, never a fabricated PR).
PrDetail? parsePrDetail(PrEnt? e) {
  if (e == null) return null;
  final String id = prStr(e, 'id') ?? '';
  if (id.isEmpty) return null; // no real id → nothing honest to act on
  final Object? items = e['items'];
  return PrDetail(
    id: id,
    no: prStr(e, 'no'),
    status: prStr(e, 'status') ?? '',
    currencyCode: prStr(e, 'currency_code') ?? '',
    amount: prNum(e, 'amount'),
    itemCount: items is List ? items.length : 0,
  );
}

/// Group a FULL-unit amount with thousands separators ("902475" -> "902,475"),
/// matching the prototype's fmt (mobile.jsx integer-baht display) and the merged
/// web pr-rows.ts formatMoney (Intl th-TH maximumFractionDigits 0). ASCII digits +
/// comma only; NaN / non-finite -> "0". This FORMATS a server value — it never
/// computes a money total (authority = SERVER).
String formatMoney(double n) {
  if (!n.isFinite) return '0';
  final int rounded = n.round();
  final String sign = rounded < 0 ? '-' : '';
  final String digits = rounded.abs().toString();
  final StringBuffer out = StringBuffer();
  for (int i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) out.write(',');
    out.write(digits[i]);
  }
  return '$sign$out';
}

/// One segment of a split i18n template: either a literal run or a `{name}` slot.
class TemplateSeg {
  const TemplateSeg.literal(this.text) : token = null;
  const TemplateSeg.token(this.token) : text = '';

  /// Literal text (empty for a token segment).
  final String text;

  /// The placeholder name (without braces), or null for a literal segment.
  final String? token;

  bool get isToken => token != null;
}

/// Split an i18n phrase template into ordered [TemplateSeg]s around the given
/// `{name}` tokens, so a screen can style the substituted DATA (the PR no / the
/// amount) differently from the surrounding copy WITHOUT writing any Thai literal
/// in Dart — the template is the resolved i18n key, the tokens name the wire
/// values. A `{name}` whose name is not in [tokens] is left as literal text (a
/// visible marker that template + call site disagree, never a silent drop —
/// mirrors JuneflowI18n.format's honest-gap philosophy). Pure + testable.
List<TemplateSeg> splitTemplate(String template, Set<String> tokens) {
  final List<TemplateSeg> out = <TemplateSeg>[];
  final RegExp re = RegExp(r'\{([A-Za-z_]\w*)\}');
  int last = 0;
  for (final RegExpMatch m in re.allMatches(template)) {
    final String name = m.group(1)!;
    if (!tokens.contains(name)) continue; // unknown token → keep as literal
    if (m.start > last) {
      out.add(TemplateSeg.literal(template.substring(last, m.start)));
    }
    out.add(TemplateSeg.token(name));
    last = m.end;
  }
  if (last < template.length) {
    out.add(TemplateSeg.literal(template.substring(last)));
  }
  return out;
}
