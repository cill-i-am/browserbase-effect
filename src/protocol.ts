/**
 * BrowserbaseProtocol -- hand-written.
 *
 * Browserbase speaks plain JSON REST (no response envelope), so the protocol
 * is core's `makeRestProtocol` configured with:
 *
 *   auth      `X-BB-API-Key: <apiKey>` from the credentials resolved on the
 *             calling fiber for every request
 *   errors    `{ statusCode, error, message }` bodies, mapped by HTTP status
 *             to {@link STATUS_MAP} (core's map plus 402 / 410), then
 *             {@link UnknownBrowserbaseError}
 *
 * One addition on top: operations whose `Http` trait declares an `accept`
 * media type (e.g. downloading a file's bytes instead of its metadata) get
 * that `Accept` header -- core's REST protocol does not send it on its own.
 */
import * as API from "@distilled.cloud/core/api";
import type { ConfigError, InvalidInput } from "@distilled.cloud/core/errors";
import { makeRestProtocol } from "@distilled.cloud/core/protocol-rest";
import type { SdkError } from "@distilled.cloud/core/sdk-error";
import * as Telemetry from "@distilled.cloud/core/telemetry";
import { httpSymbol, type HttpTrait } from "@distilled.cloud/core/trait";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Layer from "effect/Layer";
import type * as AST from "effect/SchemaAST";
import { Credentials, formatHeaders, type Config } from "./credentials.ts";
import {
  BrowserbaseParseError,
  STATUS_MAP,
  UnknownBrowserbaseError,
  type BrowserbaseStatusError,
} from "./errors.ts";

/** Error channel shared by every generated Browserbase operation. */
export type BrowserbaseOpError =
  | BrowserbaseStatusError
  | UnknownBrowserbaseError
  | BrowserbaseParseError
  | ConfigError
  | InvalidInput
  | SdkError
  | HttpClientError.HttpClientError;

/** Context (requirements) shared by every generated Browserbase operation. */
export type BrowserbaseOpContext = Credentials | HttpClient.HttpClient;

/** Browserbase error envelope: `{ statusCode, error, message }`. */
const errorEnvelope = (body: unknown) => {
  if (body === null || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  return {
    code: typeof b.error === "string" ? b.error : typeof b.code === "string" ? b.code : undefined,
    message: typeof b.message === "string" ? b.message : undefined,
  };
};

const RestProtocol: Layer.Layer<API.Protocol> = /*@__PURE__*/ makeRestProtocol<Config>({
  // The Credentials service holds an effect; it is resolved per request on
  // the calling fiber, so context-provided credentials are always current.
  credentials: Credentials,
  baseUrl: (creds) => creds.apiBaseUrl.replace(/\/+$/, ""),
  headers: formatHeaders,
  errorEnvelope,
  statusMap: STATUS_MAP,
  unknownError: ({ status, code, message, body }) =>
    new UnknownBrowserbaseError({
      status,
      code: code === undefined ? undefined : String(code),
      message,
      body,
    }),
  parseError: ({ body, cause }) => new BrowserbaseParseError({ body, cause }),
});

/** Read an annotation off a (possibly suspended) AST node. */
const acceptOf = (ast: AST.AST): string | undefined => {
  let node: any = ast;
  for (let i = 0; i < 8 && node; i++) {
    const http = node.annotations?.[httpSymbol] as HttpTrait | undefined;
    if (http) return http.accept;
    node = node._tag === "Suspend" ? node.thunk() : undefined;
  }
  return undefined;
};

export const BrowserbaseProtocol: Layer.Layer<API.Protocol> = /*@__PURE__*/ Layer.effect(
  API.Protocol,
  /*@__PURE__*/ Effect.map(
    /*@__PURE__*/ Layer.build(RestProtocol),
    (context): API.ProtocolShape => {
      const rest = Context.get(context, API.Protocol);
      const encode: API.ProtocolShape["encode"] = (args) => {
        const accept = acceptOf(args.inputAst);
        const request = rest.encode(args);
        return accept === undefined
          ? request
          : Effect.map(request, HttpClientRequest.setHeader("accept", accept));
      };
      return {
        encode,
        decode: rest.decode,
        call: (op, input) =>
          acceptOf(op.inputAst) === undefined && rest.call
            ? rest.call(op, input)
            : Effect.withFiber((fiber) => {
                const ctx = fiber.context as Context.Context<any>;
                const client = Context.get(ctx, HttpClient.HttpClient);
                return encode({ input, inputAst: op.inputAst, config: op.config }).pipe(
                  Effect.flatMap((request) => Telemetry.execute(ctx, client, request)),
                  Effect.flatMap((response) =>
                    rest.decode({
                      response,
                      outputAst: op.outputAst,
                      errors: op.errors,
                      config: op.config,
                    }),
                  ),
                ) as Effect.Effect<unknown>;
              }),
      };
    },
  ),
);
