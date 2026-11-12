<img src="assets/icon.svg" width="64" height="64" alt="">

# browserbase-effect

An Effect-native TypeScript SDK for the [Browserbase API](https://docs.browserbase.com/reference/introduction), built on [Effect v4](https://effect.website) and [`@distilled.cloud/core`](https://distilled.cloud), the runtime behind the Distilled cloud SDKs.

- Every operation returns an `Effect` and sends requests through Effect's `HttpClient`.
- Errors are typed, so you can match them with `Effect.catchTags` or by category (`NotFound`, `PaymentRequired`, `TooManyRequests`, …).
- Retry policies are declarative. Transient failures are retried by default and `Retry-After` is honoured.
- Paginated endpoints return pages on demand as `Stream`s (`.pages()` / `.items()`).
- Each request gets an OpenTelemetry span.
- The code is generated from Browserbase's [OpenAPI spec](https://docs.browserbase.com/reference/api/openapi.v1.yaml) and covers all 77 operations. See [OPERATIONS.md](OPERATIONS.md).

## Install

```sh
pnpm add browserbase-effect effect
```

## Quick start

```ts
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import * as Browserbase from "browserbase-effect";

const program = Effect.gen(function* () {
  const session = yield* Browserbase.createSession({
    browserSettings: { viewport: { width: 1280, height: 720 } },
  });
  // connect Playwright / Puppeteer to session.connectUrl ...
  yield* Browserbase.updateSession({ id: session.id, status: "REQUEST_RELEASE" });
});

const BrowserbaseLive = Layer.mergeAll(
  FetchHttpClient.layer,
  Browserbase.CredentialsFromEnv, // BROWSERBASE_API_KEY (+ optional BROWSERBASE_BASE_URL)
);

program.pipe(Effect.provide(BrowserbaseLive), Effect.runPromise);
```

To pass the key explicitly, use `Browserbase.fromApiKey({ apiKey })`. To resolve the key on every request (for example from a secret store), use `Browserbase.fromEffect(effect)`.

## Typed errors

Non-2xx responses are mapped by HTTP status to tagged errors:

| Status | Error | Category |
| --- | --- | --- |
| 400 | `BadRequest` | BadRequestError |
| 401 / 403 | `Unauthorized` / `Forbidden` | AuthError |
| 402 | `PaymentRequired` | QuotaError |
| 404 / 410 | `NotFound` / `Gone` | NotFoundError |
| 409 | `Conflict` | ConflictError |
| 422 | `UnprocessableEntity` | BadRequestError |
| 429 | `TooManyRequests` | ThrottlingError (retryable) |
| 5xx | `InternalServerError`, `BadGateway`, `ServiceUnavailable`, `GatewayTimeout` | ServerError (retryable) |
| other | `UnknownBrowserbaseError` (has `status`, `code` and `body`) | — |

```ts
Browserbase.getContext({ id }).pipe(
  Effect.catchTags({
    NotFound: () => Effect.succeed(undefined),
    PaymentRequired: (e) => Effect.die(e),
  }),
);

// or by category
Browserbase.getContext({ id }).pipe(
  Browserbase.Category.catchNotFoundError(() => Effect.succeed(undefined)),
);
```

## Retries

With no policy installed, throttling and 5xx errors are retried up to 8 times with jittered exponential backoff. Server `Retry-After` hints take precedence over the backoff. You can override this for any part of your program:

```ts
program.pipe(Browserbase.Retry.none);      // never retry
program.pipe(Browserbase.Retry.transient); // retry transient errors indefinitely
program.pipe(Browserbase.Retry.policy({ while: Browserbase.Category.isThrottling }));
```

## Pagination

Paginated operations work as normal calls (one page), and they also expose streams that fetch more pages as you consume them:

```ts
import * as Stream from "effect/Stream";

// cursor-paged (labels, secrets, webhooks, agents, runs)
const labels = Browserbase.listLabels.items({ limit: 100 });

// offset-paged (functions, builds, versions, invocations, downloads)
const fns = Browserbase.listFunctions.items({}).pipe(Stream.take(50), Stream.runCollect);

// run messages, followed by `since`
const messages = Browserbase.listAgentRunMessages.items({ runId });
```

## Uploads, downloads and secrets

```ts
// multipart uploads take a Blob / File
yield* Browserbase.uploadSessionFile({ id: session.id, file: new File([bytes], "data.csv") });
yield* Browserbase.uploadExtension({ file: zipBlob });

// file content as bytes (getDownload returns the metadata)
const bytes: Uint8Array = yield* Browserbase.getDownloadContent({ id: downloadId });

// webhook signing secrets come back as Redacted, so they don't leak into logs
const hook = yield* Browserbase.createWebhook({ endpoint, eventTypes });
Redacted.value(hook.secret);
```

## Response validation

Responses are decoded leniently by default. To validate every response against its schema, opt into strict mode. A mismatch fails with `BrowserbaseParseError`.

```ts
import { ResponseValidation } from "@distilled.cloud/core";

program.pipe(Effect.provide(ResponseValidation.strict));
```

## Layout

```
specs/openapi.v1.yaml      vendored Browserbase OpenAPI spec
scripts/generate.ts        OpenAPI -> src/services/browserbase.ts (+ OPERATIONS.md)
src/services/browserbase.ts  GENERATED: models, request/response types, operations
src/credentials.ts         X-BB-API-Key auth, env / explicit / effect-based layers
src/protocol.ts            REST protocol (core makeRestProtocol + Accept handling)
src/errors.ts              status -> error mapping (core errors + 402 / 410)
src/pagination.ts          cursor / offset / since strategies
src/retry.ts               per-SDK Retry service and presets
```

The generator handles everything the spec describes. Some details aren't in the spec, so they live in small tables at the top of `scripts/generate.ts`: friendly operation names, pagination styles, sensitive members, alternate media types and docs links.

## Development

```sh
pnpm install
pnpm specs:update   # pull the latest OpenAPI spec
pnpm generate       # regenerate src/services/browserbase.ts
pnpm typecheck
pnpm test           # mocked wire tests; live smoke tests run when BROWSERBASE_API_KEY is set
pnpm build          # emit lib/
BROWSERBASE_API_KEY=... pnpm example
```

If the spec adds an operation, `pnpm generate` fails until you give it a name in the `NAMES` table.
