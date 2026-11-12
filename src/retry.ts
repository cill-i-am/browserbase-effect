/**
 * Browserbase retry configuration.
 *
 * Defines the per-SDK `Retry` service that every generated operation wires
 * into `API.make`. Install a policy once and every Browserbase call below it
 * picks it up.
 *
 * @example
 * ```ts
 * import * as Browserbase from "browserbase-effect";
 *
 * program.pipe(Browserbase.Retry.transient); // retry throttling + 5xx
 * program.pipe(Browserbase.Retry.none);      // never retry
 * ```
 */
import { type Policy, throttlingFactory, transientFactory } from "@distilled.cloud/core/retry";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export {
  type Options,
  type Factory,
  type Policy,
  makeDefault,
  jittered,
  capped,
  throttlingOptions,
  transientOptions,
  throttlingFactory,
  transientFactory,
} from "@distilled.cloud/core/retry";

/** Context tag for configuring retry behavior of Browserbase API calls. */
export class Retry extends /*@__PURE__*/ Context.Service<Retry, Policy>()("BrowserbaseRetry") {}

/** Provides a custom retry policy to every Browserbase API call below it. */
export const policy = (optionsOrFactory: Policy) =>
  Effect.provide(Layer.succeed(Retry, optionsOrFactory));

/** Disables all automatic retries. */
export const none = /*@__PURE__*/ Effect.provide(
  /*@__PURE__*/ Layer.succeed(Retry, { while: () => false }),
);

/** Retry throttling (429) errors, honouring `Retry-After`. */
export const throttling = /*@__PURE__*/ policy(throttlingFactory);

/** Retry all transient errors (throttling, 5xx, network). */
export const transient = /*@__PURE__*/ policy(transientFactory);
