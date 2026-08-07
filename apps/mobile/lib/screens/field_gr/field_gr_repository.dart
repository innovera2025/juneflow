// Data access for the mobile site goods-receipt screen (route `field-gr`).
// money = NONE — this file has no write method at all, so no monetary value can
// leave the client by any path.
//
// READ — raw Dio, like pm_close / st_grlist / field_progress:
//   GET /gr   (gr.ts L388) — the tenant's recorded receipts. Each row already
//              carries the resolved `vendor` (gr -> po/wo -> vendor, gr.ts
//              L206-219) and the per-line `items[]` from gr_item, so the screen's
//              whole body comes from this ONE read.
//   GET /po   (po.ts poWire) — id -> `no`, to print the receipt's `po_id` FK as a
//   GET /wo   (wo.ts woWire)   human document number in the header eyebrow.
//
// All three answer the B-014 paginated envelope `{ data, ... }`.
//
// WHY THE ANCHOR NEEDS TWO EXTRA READS. `grWire` exposes the anchor as a raw
// UUID (`po_id` / `wo_id`) and there is no `GET /gr/{id}` in the contract at all
// (openapi.yaml declares /gr, /gr/{id}/return and /gr/{id}/cancel only), so there
// is no per-receipt endpoint that could embed the anchor's number. The FK ->
// real-id join over a list read is the established idiom (st_grlist's vendor map,
// the web gr-rows refNoMap). BOTH anchors are read because a GR hangs off EITHER
// a PO or a WO — gr.ts UNIONs the same two chains — and reading only the PO side
// would em-dash the header of every subcon-work receipt for no reason.
//
// WHY THERE IS NO WRITE METHOD. This is the screen named after two footer
// actions, so their absence is a decision, not an oversight:
//
//   * the sign-receipt CTA (the ok-tone primary, L419) has NO endpoint. There is
//     no GR approval or signature route, and apps/api/src/routes/boq.ts L466-468
//     says so in as many words: "There is NO GR approval endpoint in the
//     contract, so the prototype's 'approved' badge maps to the recorded
//     `received` state." A GR is `received` from the moment it is created (the
//     `gr.status` column default), so the signature the prototype collects has
//     already happened by the time this screen can show the document.
//
//   * the return/reject button (the ghost secondary, L418) DOES have one:
//     POST /gr/:id/return (gr.ts L727) flips a received receipt to `returned`,
//     atomically, the pre-state folded into the final UPDATE so a concurrent
//     return re-matches 0 rows and 409s (B-156).
//     It is nonetheless NOT wired here, for two reasons that are both blocking:
//       1. i18n. The button's label has no key. `common.reject` is byte-exact for
//          the reject HALF and drops the return half — which is the half that
//          names what the endpoint does — so it would MISDESCRIBE the action, not
//          merely under-claim it. `gr.list.kpiReturns` carries the right words
//          but is a KPI-tile id; a translator filling en/zh/ar would render it as
//          the noun "Returns" on a button. Neither is honest enough for a control
//          that changes a document's state, and this slice mints nothing.
//       2. Irreversibility. There is no un-return endpoint, the prototype offers
//          no confirmation step, and the screen has no status pill with which to
//          show the result. Shipping a one-tap, undoable-by-nobody state change
//          behind borrowed copy is not a call this port should make alone.
//     Both are raised in BLOCKERS.md B-324; the endpoint is real and the wiring
//     is a small follow-up once the label is ruled.
//
// So the screen reads and renders, and claims nothing about what it could do.
//
// Why raw Dio, not the generated typed client: the contract models a GR, a PO and
// a WO as the OPAQUE `Entity` (lib/api/generated/models/entity.dart), which
// declares NO fields and therefore DISCARDS items/vendor/no/status on
// deserialisation. Inventing contract fields is forbidden (PLAN.md §0). So this
// reads the raw JSON maps off the shared Dio, as the web ports read
// `Record<string, unknown>`.
import 'package:dio/dio.dart';

import 'field_gr_agg.dart';

/// Read access to the tenant's recorded receipts and the documents they anchor on.
///
/// Deliberately has no mutating method — see the file header (B-324).
abstract class FieldGrRepository {
  /// The tenant's goods receipts as opaque wire rows (GET /gr), each carrying its
  /// resolved vendor and its `items[]` lines.
  Future<List<FieldGrEnt>> listGrs();

  /// The tenant's POs as opaque wire rows (GET /po) — anchor-number join source.
  Future<List<FieldGrEnt>> listPos();

  /// The tenant's WOs as opaque wire rows (GET /wo) — the other anchor chain.
  Future<List<FieldGrEnt>> listWos();
}

/// [FieldGrRepository] over the app's shared Dio (the generated client's own
/// transport, so it inherits the auth interceptor + tenant scope).
class DioFieldGrRepository implements FieldGrRepository {
  const DioFieldGrRepository(this._dio);

  final Dio _dio;

  @override
  Future<List<FieldGrEnt>> listGrs() => _listData('/gr');

  @override
  Future<List<FieldGrEnt>> listPos() => _listData('/po');

  @override
  Future<List<FieldGrEnt>> listWos() => _listData('/wo');

  /// GET [path] and read the B-014 envelope's `data` array as opaque rows. A body
  /// that is not the expected `{ data: [...] }` shape yields an empty list, so the
  /// view renders honest-empty rather than crashing on an unexpected shape.
  Future<List<FieldGrEnt>> _listData(String path) async {
    final Response<Object?> res = await _dio.get<Object?>(path);
    final Object? body = res.data;
    if (body is! Map) return const <FieldGrEnt>[];
    final Object? data = body['data'];
    if (data is! List) return const <FieldGrEnt>[];
    return <FieldGrEnt>[
      for (final Object? item in data)
        if (item is Map)
          item.map<String, Object?>(
            (Object? k, Object? v) => MapEntry<String, Object?>('$k', v),
          ),
    ];
  }
}
