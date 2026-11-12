/**
 * Generate `src/services/browserbase.ts` from the Browserbase OpenAPI spec.
 *
 *   node scripts/generate.ts [specs/openapi.v1.yaml]
 *
 * Every operation becomes a typed `API.make` / `API.makePaginated` call on
 * top of `@distilled.cloud/core`: TS interfaces for inputs and outputs, lite
 * schemas carrying the HTTP bindings (path labels, query params, body
 * members), a shared error channel and per-operation pagination traits.
 *
 * What the spec does not say -- friendly operation names, pagination styles,
 * sensitive members, alternate media types -- lives in the tables below.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const specPath = path.resolve(root, process.argv[2] ?? "specs/openapi.v1.yaml");
const outPath = path.resolve(root, "src/services/browserbase.ts");

type Json = any;
const spec: Json = parse(fs.readFileSync(specPath, "utf8"));

// =============================================================================
// Tables: what the spec does not encode
// =============================================================================

/** operationId -> SDK function name. Every operation must be listed. */
const NAMES: Record<string, string> = {
  Agents_create: "createAgent",
  Agents_list: "listAgents",
  Agents_get: "getAgent",
  Agents_update: "updateAgent",
  Agents_delete: "deleteAgent",
  AgentRuns_create: "createAgentRun",
  AgentRuns_list: "listAgentRuns",
  AgentRuns_get: "getAgentRun",
  AgentRuns_messages: "listAgentRunMessages",
  AgentRuns_resume: "resumeAgentRun",
  AgentRuns_stop: "stopAgentRun",
  Certificates_upload: "uploadCertificate",
  Certificates_list: "listCertificates",
  Certificates_get: "getCertificate",
  Certificates_delete: "deleteCertificate",
  Contexts_create: "createContext",
  Contexts_get: "getContext",
  Contexts_delete: "deleteContext",
  Downloads_list: "listDownloads",
  Downloads_get: "getDownload",
  Downloads_delete: "deleteDownload",
  Extensions_upload: "uploadExtension",
  Extensions_get: "getExtension",
  Extensions_delete: "deleteExtension",
  Fetch_create: "fetchPage",
  Functions_list: "listFunctions",
  Functions_get: "getFunction",
  Functions_invoke: "invokeFunction",
  Functions_listSecrets: "listFunctionSecrets",
  Functions_attachSecret: "attachFunctionSecret",
  Functions_detachSecret: "detachFunctionSecret",
  Functions_listVersions: "listFunctionVersions",
  FunctionBuilds_list: "listFunctionBuilds",
  FunctionBuilds_get: "getFunctionBuild",
  FunctionBuilds_getLogs: "getFunctionBuildLogs",
  FunctionVersions_get: "getFunctionVersion",
  FunctionVersions_listInvocations: "listFunctionVersionInvocations",
  Invocations_get: "getFunctionInvocation",
  Invocations_getLogs: "getFunctionInvocationLogs",
  Labels_list: "listLabels",
  Labels_create: "createLabel",
  Labels_update: "updateLabel",
  Labels_delete: "deleteLabel",
  NavigationPolicies_create: "createNavigationPolicy",
  NavigationPolicies_list: "listNavigationPolicies",
  NavigationPolicies_get: "getNavigationPolicy",
  NavigationPolicies_update: "updateNavigationPolicy",
  NavigationPolicies_delete: "deleteNavigationPolicy",
  Projects_list: "listProjects",
  Projects_get: "getProject",
  Projects_usage: "getProjectUsage",
  Search_web: "searchWeb",
  Secrets_list: "listSecrets",
  Secrets_create: "createSecret",
  Secrets_getKeypair: "getSecretsKeypair",
  Secrets_get: "getSecret",
  Secrets_update: "updateSecret",
  Secrets_delete: "deleteSecret",
  Sessions_list: "listSessions",
  Sessions_create: "createSession",
  Sessions_get: "getSession",
  Sessions_update: "updateSession",
  Sessions_getDebug: "getSessionLiveUrls",
  Sessions_setLabels: "setSessionLabels",
  Sessions_getLogs: "getSessionLogs",
  Sessions_createRecordingDownloads: "createSessionRecordingDownloads",
  Sessions_listRecordingDownloads: "listSessionRecordingDownloads",
  Sessions_getReplay: "getSessionReplay",
  Sessions_getReplayPage: "getSessionReplayPage",
  Sessions_uploadFile: "uploadSessionFile",
  Webhooks_create: "createWebhook",
  Webhooks_list: "listWebhooks",
  Webhooks_get: "getWebhook",
  Webhooks_update: "updateWebhook",
  Webhooks_delete: "deleteWebhook",
  Webhooks_rotateSecret: "rotateWebhookSecret",
};

interface PaginationSpec {
  readonly strategy: "paginateCursor" | "paginateOffset" | "paginateSince";
  readonly mode?: "cursor";
  readonly inputToken: string;
  readonly outputToken: string;
  readonly items: string;
  readonly pageSize?: string;
}

const cursor = {
  strategy: "paginateCursor",
  mode: "cursor",
  inputToken: "cursor",
  outputToken: "nextCursor",
  items: "data",
  pageSize: "limit",
} as const;
const offset = (items: string) =>
  ({
    strategy: "paginateOffset",
    inputToken: "offset",
    outputToken: "total",
    items,
    pageSize: "limit",
  }) as const;

/** operationId -> how its list pages. */
const PAGINATION: Record<string, PaginationSpec> = {
  Agents_list: cursor,
  AgentRuns_list: cursor,
  Functions_listSecrets: cursor,
  Labels_list: cursor,
  Secrets_list: cursor,
  Webhooks_list: cursor,
  AgentRuns_messages: {
    strategy: "paginateSince",
    inputToken: "since",
    outputToken: "nextSince",
    items: "data",
    pageSize: "limit",
  },
  Downloads_list: offset("downloads"),
  Functions_list: offset("data"),
  FunctionBuilds_list: offset("data"),
  Functions_listVersions: offset("results"),
  FunctionVersions_listInvocations: offset("results"),
};

/** operationId -> top-level output members delivered as `Redacted`. */
const SENSITIVE_OUTPUT: Record<string, readonly string[]> = {
  Webhooks_create: ["secret"],
  Webhooks_rotateSecret: ["secret"],
};

/**
 * Extra operations for alternate response media types of one endpoint:
 * operationId -> { name, accept } (the base operation keeps the JSON form).
 */
const ALTERNATES: Record<
  string,
  { readonly name: string; readonly accept: string; readonly doc: string }
> = {
  Downloads_get: {
    name: "getDownloadContent",
    accept: "application/octet-stream",
    doc: "Download a file's content as bytes (`Accept: application/octet-stream`).",
  },
};

/** Docs pages whose slug is not the slugified operation summary. */
const DOC_SLUGS: Record<string, string> = {
  Sessions_getReplay: "session-replays",
  Sessions_getReplayPage: "session-replay-page",
};

// =============================================================================
// Emitter state
// =============================================================================

const pascal = (s: string) =>
  s
    .replace(/[^A-Za-z0-9]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^[a-z]/, (c) => c.toUpperCase());

const isIdent = (s: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);
const key = (s: string) => (isIdent(s) ? s : JSON.stringify(s));

const doc = (text: string | undefined, indent = "", extra: string[] = []): string => {
  const lines = [...(text ? text.trim().split("\n") : []), ...extra];
  if (lines.length === 0) return "";
  const body = lines.map((l) => l.replace(/\*\//g, "*\\/"));
  if (body.length === 1) return `${indent}/** ${body[0]} */\n`;
  return `${indent}/**\n${body.map((l) => `${indent} *${l ? ` ${l}` : ""}`).join("\n")}\n${indent} */\n`;
};

/** Named declarations (interface/type + schema const), in emission order. */
const decls: string[] = [];
const declared = new Set<string>();

const resolveRef = (ref: string): Json => {
  const name = ref.replace("#/components/schemas/", "");
  const target = spec.components.schemas[name];
  if (!target) throw new Error(`Unresolved $ref ${ref}`);
  return target;
};

/** Expand `allOf` (and refs inside it) into one object schema. */
const mergeAllOf = (schema: Json): Json => {
  const merged: Json = { type: "object", properties: {}, required: [] as string[] };
  const visit = (s: Json) => {
    if (s.$ref) return visit(resolveRef(s.$ref));
    if (s.allOf) return s.allOf.forEach(visit);
    if (s.type !== "object" && !s.properties)
      throw new Error(`allOf over non-object: ${JSON.stringify(s)}`);
    Object.assign(merged.properties, s.properties ?? {});
    merged.required.push(...(s.required ?? []));
    if (s.additionalProperties) merged.additionalProperties = s.additionalProperties;
    if (s.description && !merged.description) merged.description = s.description;
  };
  visit(schema);
  if (schema.description) merged.description = schema.description;
  return merged;
};

interface Rendered {
  readonly ts: string;
  readonly schema: string;
}

const literalUnion = (values: readonly unknown[]): Rendered => ({
  ts: values.map((v) => JSON.stringify(v)).join(" | "),
  schema:
    values.length === 1
      ? `S.Literal(${JSON.stringify(values[0])})`
      : `S.Literals([${values.map((v) => JSON.stringify(v)).join(", ")}])`,
});

const nullable = (r: Rendered, isNullable: boolean): Rendered =>
  isNullable ? { ts: `${r.ts} | null`, schema: `S.NullOr(${r.schema})` } : r;

/** Options for a struct: per-member traits, sensitive members, a root pipe. */
interface StructOptions {
  readonly traits?: Record<string, string>;
  readonly sensitive?: readonly string[];
  readonly rootPipe?: string;
  /** Members that are always optional in the TS input (none are required). */
  readonly allOptional?: boolean;
}

/**
 * Render a schema. Objects with properties become named interfaces (named
 * `hint`); everything else is rendered inline.
 */
const render = (schema: Json, hint: string): Rendered => {
  if (schema === undefined || schema === null || schema === true)
    return { ts: "unknown", schema: "S.Unknown" };
  if (schema.$ref) {
    const name = schema.$ref.replace("#/components/schemas/", "");
    declareComponent(name);
    return nullable({ ts: name, schema: `$${name}` }, !!schema.nullable);
  }
  if (schema.allOf) {
    if (schema.allOf.length === 1 && !schema.properties) {
      return nullable(render(schema.allOf[0], hint), !!schema.nullable);
    }
    return nullable(declareObject(hint, mergeAllOf(schema)), !!schema.nullable);
  }
  const variants: Json[] | undefined = schema.oneOf ?? schema.anyOf;
  if (variants && !schema.properties) {
    const isNullable = !!schema.nullable;
    if (variants.length === 1) return nullable(render(variants[0], hint), isNullable);
    if (variants.every((v) => v.enum && !v.$ref)) {
      return nullable(literalUnion(variants.flatMap((v) => v.enum)), isNullable);
    }
    const parts = variants.map((v, i) => render(v, `${hint}${variantName(v, i)}`));
    return nullable(
      {
        ts: parts.map((p) => (p.ts.includes(" | ") ? `(${p.ts})` : p.ts)).join(" | "),
        schema: `S.Union([${parts.map((p) => p.schema).join(", ")}])`,
      },
      isNullable,
    );
  }
  if (schema.enum) return nullable(literalUnion(schema.enum), !!schema.nullable);

  const isNullable = !!schema.nullable;
  switch (schema.type) {
    case "string":
      if (schema.format === "binary") {
        return nullable({ ts: "Blob", schema: "S.instanceOf(Blob)" }, isNullable);
      }
      return nullable({ ts: "string", schema: "S.String" }, isNullable);
    case "integer":
    case "number":
      return nullable({ ts: "number", schema: "S.Number" }, isNullable);
    case "boolean":
      return nullable({ ts: "boolean", schema: "S.Boolean" }, isNullable);
    case "array": {
      const item = render(schema.items ?? {}, `${hint}Item`);
      const ts = /[|&]/.test(item.ts) ? `Array<${item.ts}>` : `${item.ts}[]`;
      return nullable({ ts, schema: `S.Array(${item.schema})` }, isNullable);
    }
    case "object":
    case undefined: {
      const props = Object.entries(schema.properties ?? {}).filter(
        ([, p]: [string, Json]) => !isNever(p),
      );
      if (props.length > 0) return nullable(declareObject(hint, schema), isNullable);
      if (schema.type === undefined && !schema.additionalProperties) {
        return { ts: "unknown", schema: "S.Unknown" };
      }
      const ap = schema.additionalProperties;
      const value =
        ap && typeof ap === "object" && Object.keys(ap).length > 0
          ? render(ap, `${hint}Value`)
          : { ts: "unknown", schema: "S.Unknown" };
      return nullable(
        { ts: `Record<string, ${value.ts}>`, schema: `S.Record(S.String, ${value.schema})` },
        isNullable,
      );
    }
    default:
      throw new Error(`Unsupported schema type ${schema.type} at ${hint}`);
  }
};

const variantName = (v: Json, i: number): string => {
  if (v.$ref) return "";
  if (v.type === "array") return "List";
  if (v.type === "object") return "Object";
  return `Variant${i}`;
};

/** `{ not: {} }` -- a member that must be absent. */
const isNever = (p: Json) =>
  p && p.not && Object.keys(p.not).length === 0 && Object.keys(p).length === 1;

const declareComponent = (name: string) => {
  if (declared.has(name)) return;
  const schema = spec.components.schemas[name];
  if (schema.allOf) declareObject(name, mergeAllOf(schema));
  else if (schema.type === "object" || schema.properties) declareObject(name, schema);
  else {
    declared.add(name);
    const r = render(schema, name);
    decls.push(
      `${doc(schema.description)}export type ${name} = ${r.ts};\nconst $${name}: S.Schema<${name}> = /*@__PURE__*/ S.suspend(() => ${r.schema});\n`,
    );
  }
};

/** Emit a named interface + struct schema for an object schema. */
const declareObject = (name: string, schema: Json, options: StructOptions = {}): Rendered => {
  if (declared.has(name)) return { ts: name, schema: `$${name}` };
  declared.add(name);
  const required = new Set<string>(schema.required ?? []);
  const fields: string[] = [];
  const members: string[] = [];
  for (const [prop, propSchema] of Object.entries<Json>(schema.properties ?? {})) {
    if (isNever(propSchema)) continue;
    const r = render(propSchema, `${name}${pascal(prop)}`);
    const optional = options.allOptional || !required.has(prop);
    const sensitive = options.sensitive?.includes(prop);
    const ts = sensitive ? (r.ts === "string" ? "Redacted.Redacted<string>" : r.ts) : r.ts;
    let s = r.schema;
    const traits = [options.traits?.[prop], sensitive ? "T.SensitiveValue()" : undefined].filter(
      Boolean,
    );
    if (traits.length > 0) s = `${s}.pipe(${traits.join(", ")})`;
    if (optional) s = `S.optional(${s})`;
    const extra: string[] = [];
    if (propSchema.default !== undefined)
      extra.push(`@default ${JSON.stringify(propSchema.default)}`);
    if (propSchema.deprecated) extra.push("@deprecated");
    members.push(
      `${doc(propSchema.description, "  ", extra)}  readonly ${key(prop)}${optional ? "?" : ""}: ${ts}${optional ? " | undefined" : ""};`,
    );
    fields.push(`    ${key(prop)}: ${s},`);
  }
  const open =
    schema.additionalProperties === true ||
    (schema.additionalProperties &&
      typeof schema.additionalProperties === "object" &&
      Object.keys(schema.additionalProperties).length === 0);
  if (open) members.push("  readonly [key: string]: unknown;");
  const pipe = options.rootPipe ? `.pipe(${options.rootPipe})` : "";
  decls.push(
    `${doc(schema.description)}export interface ${name} {\n${members.join("\n")}\n}\n` +
      `const $${name}: S.Schema<${name}> = /*@__PURE__*/ S.suspend(() =>\n  S.Struct({\n${fields.join("\n")}\n  })${pipe},\n);\n`,
  );
  return { ts: name, schema: `$${name}` };
};

// =============================================================================
// Operations
// =============================================================================

interface Operation {
  readonly id: string;
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly op: Json;
  readonly accept?: string;
  readonly docOverride?: string;
}

const operations: Operation[] = [];
for (const [p, item] of Object.entries<Json>(spec.paths)) {
  for (const [method, op] of Object.entries<Json>(item)) {
    if (method === "parameters") continue;
    const name = NAMES[op.operationId];
    if (!name) throw new Error(`No SDK name for operation ${op.operationId} -- add it to NAMES`);
    operations.push({ id: op.operationId, name, method: method.toUpperCase(), path: p, op });
    const alt = ALTERNATES[op.operationId];
    if (alt) {
      operations.push({
        id: op.operationId,
        name: alt.name,
        method: method.toUpperCase(),
        path: p,
        op,
        accept: alt.accept,
        docOverride: alt.doc,
      });
    }
  }
}
const unknownNames = Object.keys(NAMES).filter((id) => !operations.some((o) => o.id === id));
if (unknownNames.length > 0)
  throw new Error(`NAMES lists unknown operations: ${unknownNames.join(", ")}`);
operations.sort((a, b) => a.name.localeCompare(b.name));

// Components first, in spec order, so shared models read top-down.
for (const name of Object.keys(spec.components.schemas)) declareComponent(name);
const componentDecls = decls.splice(0);

const opBlocks: string[] = [];
const summary: string[] = [];

for (const o of operations) {
  const P = pascal(o.name);
  const requestName = `${P}Request`;
  const op = o.op;

  // ---- Input -----------------------------------------------------------------
  const inputProps: Record<string, Json> = {};
  const required: string[] = [];
  const traits: Record<string, string> = {};
  const params = [...(spec.paths[o.path].parameters ?? []), ...(op.parameters ?? [])];
  for (const param of params) {
    inputProps[param.name] = {
      ...param.schema,
      description: param.description ?? param.schema?.description,
    };
    if (param.required || param.in === "path") required.push(param.name);
    traits[param.name] =
      param.in === "path"
        ? `T.Label(${JSON.stringify(param.name)})`
        : param.in === "query"
          ? `T.Query(${JSON.stringify(param.name)})`
          : param.in === "header"
            ? `T.Header(${JSON.stringify(param.name)})`
            : (() => {
                throw new Error(`Unsupported parameter location ${param.in}`);
              })();
  }
  let contentType: string | undefined;
  const content = op.requestBody?.content ?? {};
  const bodyMedia = Object.keys(content)[0];
  if (bodyMedia) {
    if (bodyMedia === "multipart/form-data") contentType = "multipart";
    else if (bodyMedia !== "application/json")
      throw new Error(`Unsupported request media type ${bodyMedia}`);
    let body = content[bodyMedia].schema;
    if (body.$ref) body = resolveRef(body.$ref);
    if (body.allOf) body = mergeAllOf(body);
    if (body.type !== "object") throw new Error(`Non-object request body on ${o.id}`);
    for (const [prop, s] of Object.entries<Json>(body.properties ?? {})) {
      if (prop in inputProps)
        throw new Error(`Body member ${prop} collides with a parameter on ${o.id}`);
      inputProps[prop] = s;
      // A body that is optional as a whole makes all of its members optional.
      if (op.requestBody.required && (body.required ?? []).includes(prop)) required.push(prop);
    }
  }
  const http = [
    `method: ${JSON.stringify(o.method)}`,
    `uri: ${JSON.stringify(o.path)}`,
    contentType ? `contentType: ${JSON.stringify(contentType)}` : undefined,
    o.accept ? `accept: ${JSON.stringify(o.accept)}` : undefined,
  ].filter(Boolean);
  declareObject(
    requestName,
    { type: "object", properties: inputProps, required },
    { traits, rootPipe: `T.Http({ ${http.join(", ")} })` },
  );

  // ---- Output ----------------------------------------------------------------
  const success = Object.entries<Json>(op.responses ?? {}).find(([code]) => code.startsWith("2"));
  if (!success) throw new Error(`No 2xx response on ${o.id}`);
  const [, response] = success;
  const media = o.accept ?? Object.keys(response.content ?? {})[0];
  let output: Rendered;
  let outputType: string;
  if (media === undefined) {
    outputType = "void";
    output = { ts: "void", schema: "S.Struct({})" };
  } else if (media === "application/octet-stream") {
    outputType = "Uint8Array";
    output = { ts: "Uint8Array", schema: "S.instanceOf(Uint8Array).pipe(T.BinaryResponse())" };
  } else if (media === "application/json") {
    let schema = response.content[media].schema;
    const sensitive = SENSITIVE_OUTPUT[o.id];
    const responseName = `${P}Response`;
    if (sensitive) {
      if (schema.$ref) schema = { allOf: [schema] };
      schema = mergeAllOf(schema);
      output = declareObject(responseName, schema, { sensitive });
    } else if (schema.type === "array") {
      const item = render(schema.items, `${responseName}Item`);
      output = { ts: `${item.ts}[]`, schema: `S.Array(${item.schema}).pipe(T.RawResponseRoot())` };
    } else {
      output = render(schema, responseName);
    }
    outputType = output.ts;
    if (!isIdent(outputType)) {
      decls.push(`export type ${responseName} = ${output.ts};\n`);
      outputType = responseName;
    }
  } else if (media.startsWith("application/vnd.apple.mpegurl") || media.startsWith("text/")) {
    outputType = "string";
    output = { ts: "string", schema: "S.String" };
  } else {
    throw new Error(`Unsupported response media type ${media} on ${o.id}`);
  }

  // ---- Operation -------------------------------------------------------------
  const pagination = o.accept ? undefined : PAGINATION[o.id];
  const description = o.docOverride ?? [op.summary, op.description].filter(Boolean).join("\n\n");
  const tags = [
    `@see https://docs.browserbase.com/reference/api/${DOC_SLUGS[o.id] ?? slug(op.summary)}`,
  ];
  const errorType = `${P}Error`;
  const span = `span: ${JSON.stringify(P)},`;
  let block = decls.splice(0).join("\n");
  block += `\nexport type ${errorType} = BrowserbaseOpError;\n`;
  block += doc(description, "", ["", ...tags]);
  const config = [
    `input: $${requestName},`,
    output.schema.startsWith("$")
      ? `output: ${output.schema},`
      : `output: ${output.schema} as S.Schema<${outputType}>,`,
    `protocol: BrowserbaseProtocol,`,
    `retry: Retry.Retry,`,
    `telemetry: TELEMETRY,`,
    span,
  ];
  if (pagination) {
    const itemType = paginatedItemType(outputType, pagination.items);
    const trait = [
      pagination.mode ? `mode: ${JSON.stringify(pagination.mode)}` : undefined,
      `inputToken: ${JSON.stringify(pagination.inputToken)}`,
      `outputToken: ${JSON.stringify(pagination.outputToken)}`,
      `items: ${JSON.stringify(pagination.items)}`,
      pagination.pageSize ? `pageSize: ${JSON.stringify(pagination.pageSize)}` : undefined,
    ].filter(Boolean);
    block += `export const ${o.name}: API.PaginatedOperationMethod<\n  ${requestName},\n  ${outputType},\n  ${errorType},\n  BrowserbaseOpContext,\n  ${itemType}\n> = /*@__PURE__*/ API.makePaginated(\n  () => ({\n    ${config.join("\n    ")}\n    pagination: { ${trait.join(", ")} },\n  }),\n  ${pagination.strategy},\n) as any;\n`;
  } else {
    block += `export const ${o.name}: API.OperationMethod<\n  ${requestName},\n  ${outputType},\n  ${errorType},\n  BrowserbaseOpContext\n> = /*@__PURE__*/ API.make(() => ({\n  ${config.join("\n  ")}\n}));\n`;
  }
  opBlocks.push(block);
  summary.push(
    `| \`${o.name}\` | \`${o.method} ${o.path}\`${o.accept ? ` (${o.accept})` : ""} |${pagination ? " ✓ |" : " |"}`,
  );
}

function slug(summary: string | undefined): string {
  return (summary ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function paginatedItemType(outputType: string, items: string): string {
  return `NonNullable<${outputType}[${JSON.stringify(items)}]>[number]`;
}

// =============================================================================
// Write
// =============================================================================

const usesRedacted = [...componentDecls, ...opBlocks].some((b) => b.includes("Redacted.Redacted"));
const strategies = [...new Set(Object.values(PAGINATION).map((p) => p.strategy))].sort();

const header = `// AUTO-GENERATED by scripts/generate.ts from specs/openapi.v1.yaml. Do not edit.
//
// ${spec.info.title} ${spec.info.version} -- ${operations.length} operations.
import * as API from "@distilled.cloud/core/api";
import * as S from "@distilled.cloud/core/schema-lite";
${usesRedacted ? 'import type * as Redacted from "effect/Redacted";\n' : ""}import { ${strategies.join(", ")} } from "../pagination.ts";
import {
  BrowserbaseProtocol,
  type BrowserbaseOpContext,
  type BrowserbaseOpError,
} from "../protocol.ts";
import * as Retry from "../retry.ts";
import * as T from "../traits.ts";

export type { BrowserbaseOpContext, BrowserbaseOpError };

/** Span facts shared by every operation. */
const TELEMETRY = {
  system: "browserbase-api",
  responseHeaders: [
    { header: "x-request-id", name: "http.response.header.x-request-id", transform: "list" },
  ],
  prefix: "Browserbase",
  service: "Browserbase",
  labels: "browserbase",
  propagate: "w3c",
} as const;
`;

const out = [
  header,
  "// =============================================================================\n// Models\n// =============================================================================\n",
  componentDecls.join("\n"),
  "// =============================================================================\n// Operations\n// =============================================================================\n",
  opBlocks.join("\n"),
].join("\n");

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out);
fs.writeFileSync(
  path.resolve(root, "OPERATIONS.md"),
  `<!-- AUTO-GENERATED by scripts/generate.ts. Do not edit. -->\n# Operations\n\n${operations.length} operations generated from \`specs/openapi.v1.yaml\`. Paginated operations also expose \`.pages(input)\` and \`.items(input)\` streams.\n\n| Function | Endpoint | Paginated |\n| --- | --- | --- |\n${summary.join("\n")}\n`,
);
console.log(`Generated ${operations.length} operations -> ${path.relative(root, outPath)}`);
