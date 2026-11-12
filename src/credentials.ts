/**
 * Browserbase credentials -- hand-written.
 *
 * Browserbase authenticates every request with an API key sent in the
 * `X-BB-API-Key` header. The `Credentials` service holds an *effect* that
 * resolves the current credentials, so callers that rotate keys (or load
 * them from a secret store) just provide a different effect -- the protocol
 * resolves it on the calling fiber for every request.
 *
 * @example
 * ```ts
 * import * as Browserbase from "browserbase-effect";
 * import * as Redacted from "effect/Redacted";
 *
 * // From BROWSERBASE_API_KEY (and optionally BROWSERBASE_BASE_URL):
 * program.pipe(Effect.provide(Browserbase.CredentialsFromEnv));
 *
 * // Explicitly:
 * program.pipe(
 *   Effect.provide(Browserbase.fromApiKey({ apiKey: Redacted.make("bb_live_...") })),
 * );
 * ```
 */
import * as EffectConfig from "@distilled.cloud/core/config";
import { ConfigError } from "@distilled.cloud/core/errors";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

export const DEFAULT_API_BASE_URL = "https://api.browserbase.com";

/** Header Browserbase reads the API key from. */
export const API_KEY_HEADER = "X-BB-API-Key";

export interface Config {
  readonly apiKey: Redacted.Redacted<string>;
  /** API origin, without the `/v1` prefix (operations carry it). */
  readonly apiBaseUrl: string;
}

export class Credentials
  extends /*@__PURE__*/ Context.Service<Credentials, Effect.Effect<Config, ConfigError>>()(
    "BrowserbaseCredentials",
  ) {}

/** The auth headers for a resolved set of credentials. */
export const formatHeaders = (config: Config): Record<string, string> => ({
  [API_KEY_HEADER]: Redacted.value(config.apiKey),
});

/** Build a `Credentials` layer from an API key. */
export const fromApiKey = (input: {
  readonly apiKey: Redacted.Redacted<string> | string;
  readonly apiBaseUrl?: string;
}): Layer.Layer<Credentials> =>
  Layer.succeed(
    Credentials,
    Effect.succeed({
      apiKey: Redacted.isRedacted(input.apiKey) ? input.apiKey : Redacted.make(input.apiKey),
      apiBaseUrl: input.apiBaseUrl ?? DEFAULT_API_BASE_URL,
    }),
  );

/** Build a `Credentials` layer from an effect resolving the credentials per request. */
export const fromEffect = <E>(resolve: Effect.Effect<Config, E>): Layer.Layer<Credentials> =>
  Layer.succeed(
    Credentials,
    Effect.mapError(
      resolve,
      (cause) =>
        new ConfigError({
          message: `Failed to resolve Browserbase credentials: ${String(cause)}`,
        }),
    ),
  );

const envConfig = /*@__PURE__*/ EffectConfig.all({
  apiKey: /*@__PURE__*/ EffectConfig.Redacted("BROWSERBASE_API_KEY"),
  apiBaseUrl: /*@__PURE__*/ EffectConfig.String("BROWSERBASE_BASE_URL").pipe(
    /*@__PURE__*/ EffectConfig.withDefault(DEFAULT_API_BASE_URL),
  ),
});

/**
 * Credentials from `BROWSERBASE_API_KEY` (required) and
 * `BROWSERBASE_BASE_URL` (optional, defaults to {@link DEFAULT_API_BASE_URL}).
 */
export const CredentialsFromEnv: Layer.Layer<Credentials> = /*@__PURE__*/ Layer.succeed(
  Credentials,
  /*@__PURE__*/ envConfig.pipe(
    /*@__PURE__*/ Effect.mapError(
      () =>
        new ConfigError({
          message: "The BROWSERBASE_API_KEY environment variable is required",
        }),
    ),
  ),
);
