/**
 * Browserbase error types -- hand-written.
 *
 * Re-exports the shared HTTP status errors from core and adds the statuses
 * Browserbase uses that core does not map (402 Payment Required, 410 Gone),
 * plus the fallback and parse errors every operation can fail with.
 *
 * Browserbase error bodies look like
 * `{ statusCode: 404, error: "Not Found", message: "..." }`; the protocol
 * maps them to these classes by HTTP status.
 *
 * @example
 * ```ts
 * Browserbase.getSession({ id }).pipe(
 *   Effect.catchTags({
 *     NotFound: () => Effect.succeed(undefined),
 *     PaymentRequired: (e) => Effect.fail(new OutOfCredits(e.message)),
 *   }),
 * );
 * ```
 */
export {
  BadGateway,
  BadRequest,
  Conflict,
  ConfigError,
  Forbidden,
  GatewayTimeout,
  InternalServerError,
  InvalidInput,
  Locked,
  NotFound,
  SdkError,
  ServiceUnavailable,
  TooManyRequests,
  Unauthorized,
  UnprocessableEntity,
} from "@distilled.cloud/core/errors";

import * as Category from "@distilled.cloud/core/category";
import { API_ERRORS, HTTP_STATUS_MAP } from "@distilled.cloud/core/errors";
import * as Schema from "@distilled.cloud/core/schema-lite-typed";

/** 402 -- the project is out of credits or the plan does not include the feature. */
export class PaymentRequired
  extends /*@__PURE__*/ Schema.TaggedError<PaymentRequired>()("PaymentRequired", {
    message: Schema.String,
  }).pipe(Category.withQuotaError) {}

/** 410 -- the resource existed but is no longer available (e.g. an expired recording). */
export class Gone
  extends /*@__PURE__*/ Schema.TaggedError<Gone>()("Gone", {
    message: Schema.String,
  }).pipe(Category.withNotFoundError) {}

/**
 * Unknown Browserbase error -- returned for a non-2xx status nothing else
 * maps (unmapped 5xx become `InternalServerError`, so this is a 4xx). It
 * carries no category, so the default retry policy does not retry it.
 */
export class UnknownBrowserbaseError
  extends /*@__PURE__*/ Schema.TaggedError<UnknownBrowserbaseError>()("UnknownBrowserbaseError", {
    status: Schema.Number,
    code: /*@__PURE__*/ Schema.optional(Schema.String),
    message: Schema.String,
    body: Schema.Unknown,
  }) {}

/** A 2xx response body that did not match the operation's output schema (strict mode). */
export class BrowserbaseParseError
  extends /*@__PURE__*/ Schema.TaggedError<BrowserbaseParseError>()("BrowserbaseParseError", {
    body: Schema.Unknown,
    cause: Schema.Unknown,
  }).pipe(Category.withParseError) {}

/** HTTP status -> error class used by the Browserbase protocol. */
export const STATUS_MAP = {
  ...HTTP_STATUS_MAP,
  402: PaymentRequired,
  410: Gone,
} as const;

/** Every status-mapped error class a Browserbase operation can fail with. */
export const BROWSERBASE_ERRORS = [...API_ERRORS, PaymentRequired, Gone] as const;

export type BrowserbaseStatusError = InstanceType<(typeof BROWSERBASE_ERRORS)[number]>;
