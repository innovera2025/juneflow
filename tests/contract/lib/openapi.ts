/**
 * Contract-test engine (Gate G2) — P0-QA-02
 *
 * Loads the SINGLE system contract `packages/contracts/openapi.yaml`
 * (PLAN.md §5: "OpenAPI = contract เดียว") and turns it into a flat list of
 * operations + a minimal schema validator. Every expected value used by the
 * contract tests is DERIVED from this file — no hand-written models
 * (tests/CLAUDE.md: "expected จาก contract เท่านั้น · ห้ามอ่าน implementation").
 *
 * openapi.yaml is a sacred file: this module only READS it, never writes.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const SPEC_REL = 'packages/contracts/openapi.yaml';
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

/** Minimal view of an OpenAPI node — the contract is untyped JSON at runtime. */
type Json = any;

export interface ContractResponse {
  status: string;
  description?: string;
  /** Response body schema (JSON media type), resolved one $ref level. */
  schema?: Json;
}

export interface ContractOperation {
  /** Upper-case HTTP verb, e.g. "POST". */
  method: string;
  /** Path template as written, e.g. "/boq/{id}/approve". */
  path: string;
  operationId: string;
  tags: string[];
  summary?: string;
  /** Effective security is non-empty (global bearerAuth unless op sets security: []). */
  authRequired: boolean;
  hasRequestBody: boolean;
  requestBodyRequired: boolean;
  /** Request body media types, e.g. ["application/json"] or ["multipart/form-data"]. */
  requestMediaTypes: string[];
  /** Request body schema (JSON preferred, else first media type), resolved one $ref level. */
  requestBodySchema?: Json;
  responses: ContractResponse[];
  /** All documented status codes, e.g. ["200","401","404"]. */
  statusCodes: string[];
  /** Documented 2xx status codes. */
  successStatuses: string[];
  /** True when the path template contains a {param} placeholder. */
  hasPathParams: boolean;
}

/** Locate openapi.yaml by walking up from this module (override with OPENAPI_PATH). */
export function specPath(): string {
  const override = process.env.OPENAPI_PATH;
  if (override) return isAbsolute(override) ? override : resolve(process.cwd(), override);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = join(dir, SPEC_REL);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Cannot locate ${SPEC_REL} above ${fileURLToPath(import.meta.url)}`);
}

let cachedDoc: Json | undefined;

/** Parse and cache the contract document. */
export function loadSpec(): Json {
  if (!cachedDoc) cachedDoc = load(readFileSync(specPath(), 'utf8')) as Json;
  return cachedDoc;
}

/** Resolve a local "#/a/b/c" JSON pointer against the document root. */
export function resolveRef(doc: Json, ref: string): Json {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    throw new Error(`Only local #/ refs are supported, got: ${ref}`);
  }
  const parts = ref
    .slice(2)
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let node: Json = doc;
  for (const part of parts) {
    if (node == null || !(part in node)) throw new Error(`Unresolvable ref: ${ref}`);
    node = node[part];
  }
  return node;
}

/** Follow a single `$ref` if present, otherwise return the node unchanged. */
export function deref(doc: Json, node: Json): Json {
  return node && typeof node === 'object' && node.$ref ? resolveRef(doc, node.$ref) : node;
}

function jsonSchemaOf(doc: Json, holder: Json): Json | undefined {
  const resolved = deref(doc, holder);
  return resolved?.content?.['application/json']?.schema;
}

/** Media types present on a requestBody/response content object (resolved one $ref level). */
function mediaTypesOf(doc: Json, holder: Json): string[] {
  return Object.keys(deref(doc, holder)?.content ?? {});
}

/** Body schema for a requestBody: prefer application/json, else the first media type. */
function bodySchemaOf(doc: Json, holder: Json): Json | undefined {
  const content = deref(doc, holder)?.content ?? {};
  const media = content['application/json'] ? 'application/json' : Object.keys(content)[0];
  return media ? content[media]?.schema : undefined;
}

/** Flatten paths × methods into a testable operation list, effective security applied. */
export function listOperations(doc: Json = loadSpec()): ContractOperation[] {
  const globalSecurity: Json[] | undefined = doc.security;
  const ops: ContractOperation[] = [];
  for (const [path, pathItem] of Object.entries<Json>(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = (pathItem as Json)[method];
      if (!op) continue;

      const effSecurity = op.security !== undefined ? op.security : globalSecurity;
      const authRequired = !(Array.isArray(effSecurity) && effSecurity.length === 0);

      const responses: ContractResponse[] = Object.entries<Json>(op.responses ?? {}).map(
        ([status, res]) => {
          const resolved = deref(doc, res);
          return { status, description: resolved?.description, schema: jsonSchemaOf(doc, res) };
        },
      );
      const statusCodes = responses.map((r) => r.status);

      ops.push({
        method: method.toUpperCase(),
        path,
        operationId: op.operationId,
        tags: op.tags ?? [],
        summary: op.summary,
        authRequired,
        hasRequestBody: Boolean(op.requestBody),
        requestBodyRequired: Boolean(deref(doc, op.requestBody)?.required),
        requestMediaTypes: op.requestBody ? mediaTypesOf(doc, op.requestBody) : [],
        requestBodySchema: op.requestBody ? bodySchemaOf(doc, op.requestBody) : undefined,
        responses,
        statusCodes,
        successStatuses: statusCodes.filter((s) => /^2\d\d$/.test(s)),
        hasPathParams: /\{[^}]+\}/.test(path),
      });
    }
  }
  return ops;
}

/** Collect every local `$ref` string used anywhere in the document. */
export function collectRefs(node: Json, acc: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, acc);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') acc.push(value);
      else collectRefs(value, acc);
    }
  }
  return acc;
}

/**
 * Minimal structural validator: returns a list of violation messages (empty = valid).
 * Supports $ref / allOf / type / required / properties / items / enum / const.
 * Intentionally permissive (additional properties allowed, unknown keywords ignored) —
 * it checks that a live payload HONORS the contract shape, not that it matches exactly.
 */
export function validate(value: Json, schema: Json, doc: Json = loadSpec(), pathLabel = '$'): string[] {
  const errors: string[] = [];
  const s = deref(doc, schema);
  if (!s || typeof s !== 'object') return errors;

  if (Array.isArray(s.allOf)) {
    for (const sub of s.allOf) errors.push(...validate(value, sub, doc, pathLabel));
  }

  if (s.const !== undefined && value !== s.const) {
    errors.push(`${pathLabel}: expected const ${JSON.stringify(s.const)}, got ${JSON.stringify(value)}`);
  }
  if (Array.isArray(s.enum) && !s.enum.includes(value)) {
    errors.push(`${pathLabel}: value ${JSON.stringify(value)} not in enum ${JSON.stringify(s.enum)}`);
  }

  if (s.type && !matchesType(value, s.type)) {
    errors.push(`${pathLabel}: expected type ${s.type}, got ${jsType(value)}`);
    return errors; // shape mismatch — deeper checks are meaningless
  }

  if ((s.type === 'object' || s.properties || s.required) && value && typeof value === 'object') {
    for (const req of s.required ?? []) {
      if (!(req in value)) errors.push(`${pathLabel}: missing required property "${req}"`);
    }
    for (const [prop, propSchema] of Object.entries<Json>(s.properties ?? {})) {
      if (prop in value) errors.push(...validate(value[prop], propSchema, doc, `${pathLabel}.${prop}`));
    }
  }

  if (s.type === 'array' && Array.isArray(value) && s.items) {
    value.forEach((item, i) => errors.push(...validate(item, s.items, doc, `${pathLabel}[${i}]`)));
  }

  return errors;
}

function jsType(value: Json): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value: Json, type: string | string[]): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => {
    switch (t) {
      case 'integer':
        return typeof value === 'number' && Number.isInteger(value);
      case 'number':
        return typeof value === 'number';
      case 'string':
        return typeof value === 'string';
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return value != null && typeof value === 'object' && !Array.isArray(value);
      case 'null':
        return value === null;
      default:
        return true;
    }
  });
}
