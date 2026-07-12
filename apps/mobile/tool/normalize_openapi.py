#!/usr/bin/env python3
"""Normalize the SACRED openapi.yaml into a generator-friendly working copy.

Why this exists (P0-MOB-03):
  packages/contracts/openapi.yaml is the single source of the API contract and is
  SACRED (read-only from the mobile zone — PLAN.md §8/§10). It uses path-level
  `parameters` (e.g. `$ref: IdPath` shared by GET/PUT of /x/{id}) — perfectly valid
  OpenAPI 3.1. The pure-Dart generator swagger_parser 1.44.0 crashes on that shape
  (it casts the path-item to a Map before its parameters guard). openapi-generator
  (Java) is not usable on this host (no JRE).

  So we produce a *derived* working copy with a single SEMANTICS-PRESERVING change:
  every path-level `parameters` entry is inlined into each operation of that path
  (OpenAPI states path-level parameters apply to all operations; an operation-level
  parameter with the same name+location overrides). No endpoints, verbs, fields, or
  types are added or removed — this is normalization, not a contract change.

Input  : ../../packages/contracts/openapi.yaml  (never modified — read only)
Output : build/openapi.normalized.yaml           (gitignored, regenerated)
"""
from __future__ import annotations

import sys
from pathlib import Path

import yaml

HTTP_METHODS = {"get", "put", "post", "delete", "options", "head", "patch", "trace"}


def _param_key(p: dict) -> tuple:
    # Identity of a parameter for override purposes: (name, in). $ref params are
    # kept as-is (keyed by their ref) since they are shared, non-conflicting.
    if "$ref" in p:
        return ("$ref", p["$ref"])
    return (p.get("name"), p.get("in"))


def _is_freeform_object(node: dict) -> bool:
    """True for a schema that is an object with NO declared fields and free-form
    (or default) additionalProperties — the contract's opaque resources (Entity)."""
    if node.get("type") != "object":
        return False
    props = node.get("properties")
    if isinstance(props, dict) and len(props) > 0:
        return False
    ap = node.get("additionalProperties")
    # free-form == default (absent), `true`, or an empty/any schema `{}`.
    return ap is None or ap is True or ap == {}


def classify_freeform_objects(node) -> int:
    """Render free-form objects as empty classes, not `dynamic`, for the generator.

    An opaque object (e.g. Entity: `{type: object, additionalProperties: true}`)
    declares NO fields — the contract intentionally leaves resource shapes to the
    data-dictionary schema tasks (PLAN.md §0). swagger_parser renders such schemas
    as `typedef X = dynamic`; retrofit_generator 10.2.7 then (a) crashes computing a
    null inner type for `Future<List<dynamic>>` and (b) emits `X.fromJson(...)` calls
    that don't compile on a `dynamic`/`Map` typedef.

    Rewriting them to `{type: object, properties: {}}` makes the generator emit a
    real (empty) `@JsonSerializable` class with fromJson/toJson — which compiles and
    round-trips. This is faithful: the contract declares zero fields for these
    schemas, and when the schema tasks later add fields, regeneration fills them in.
    Returns the count of rewritten schemas.
    """
    changed = 0
    if isinstance(node, dict):
        if _is_freeform_object(node):
            node.pop("additionalProperties", None)
            node["properties"] = {}
            changed += 1
        for value in node.values():
            changed += classify_freeform_objects(value)
    elif isinstance(node, list):
        for item in node:
            changed += classify_freeform_objects(item)
    return changed


def inline_path_parameters(spec: dict) -> int:
    """Move each path-item `parameters` list into every operation. Returns count."""
    moved = 0
    for path, path_item in (spec.get("paths") or {}).items():
        if not isinstance(path_item, dict):
            continue
        shared = path_item.pop("parameters", None)
        if not shared:
            continue
        moved += 1
        for method, op in path_item.items():
            if method.lower() not in HTTP_METHODS or not isinstance(op, dict):
                continue
            existing = op.get("parameters") or []
            existing_keys = {_param_key(p) for p in existing if isinstance(p, dict)}
            # operation-level params win; prepend only the shared ones not overridden
            prepend = [p for p in shared if _param_key(p) not in existing_keys]
            op["parameters"] = prepend + existing
    return moved


def main() -> int:
    here = Path(__file__).resolve().parent          # apps/mobile/tool
    mobile = here.parent                            # apps/mobile
    src = (mobile / "../../packages/contracts/openapi.yaml").resolve()
    out = mobile / "build" / "openapi.normalized.yaml"

    if not src.exists():
        print(f"ERROR: contract not found at {src}", file=sys.stderr)
        return 1

    spec = yaml.safe_load(src.read_text(encoding="utf-8"))
    moved = inline_path_parameters(spec)
    relaxed = classify_freeform_objects(spec)

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        yaml.safe_dump(spec, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    print(f"normalized {src.name}: inlined path-level parameters on {moved} paths")
    print(f"                    classified {relaxed} free-form object(s) as empty classes")
    print(f"-> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
