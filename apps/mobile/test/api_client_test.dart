// Compile + smoke test for the GENERATED OpenAPI Dart client (P0-MOB-03).
//
// The client under lib/api/generated/** is codegen'd from the sacred contract
// packages/contracts/openapi.yaml (see tool/gen_api_client.sh) — retrofit-on-dio
// clients + json_serializable models. This test's real job is to force the whole
// generated graph (including the retrofit `_$XApi` and `*.g.dart` serializers)
// through the compiler and confirm the clients wire onto a Dio instance and the
// models round-trip through JSON. Endpoints are exercised in Phase 4 against a
// live API; here we only assert the generated surface is well-formed.
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:juneflow_mobile/api/generated/export.dart';

void main() {
  group('generated API client (P0-MOB-03)', () {
    test('root client exposes every tag-scoped sub-client on one Dio', () {
      final client = JuneflowApiClient(Dio(), baseUrl: '/api/v1');

      // One accessor per OpenAPI tag — instantiating each forces the generated
      // retrofit implementation (_$XApi) to compile and construct.
      expect(client.auth, isA<AuthApi>());
      expect(client.admin, isA<AdminApi>());
      expect(client.master, isA<MasterApi>());
      expect(client.boq, isA<BoqApi>());
      expect(client.subcon, isA<SubconApi>());
      expect(client.pm, isA<PmApi>());
      expect(client.finance, isA<FinanceApi>());
      expect(client.landSales, isA<LandSalesApi>());
      expect(client.dms, isA<DmsApi>());
      expect(client.files, isA<FilesApi>());
      expect(client.exports, isA<ExportsApi>());
      expect(client.line, isA<LineApi>());
      expect(JuneflowApiClient.version, isNotEmpty);
    });

    test('explicitly-modeled schema round-trips through generated json', () {
      // AuthLoginInput is one of the few named schemas in the contract.
      const input = AuthLoginInput(email: 'a@b.co', password: 'secret');
      final json = input.toJson();
      expect(json, {'email': 'a@b.co', 'password': 'secret'});

      final back = AuthLoginInput.fromJson(json);
      expect(back.email, input.email);
      expect(back.password, input.password);
    });

    test('opaque Entity resource is a real class that round-trips json', () {
      // Entity is the contract's opaque resource: it declares NO fields yet
      // (they live in the data-dictionary schema tasks, not the contract), so it
      // generates as an empty JsonSerializable class — not `dynamic`. Regen will
      // fill in fields once the contract names them.
      final e = Entity.fromJson(const {});
      expect(e, isA<Entity>());
      expect(e.toJson(), isA<Map<String, Object?>>());
    });
  });
}
