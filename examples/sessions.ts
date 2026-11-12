/**
 * Create a session, print its connect URL, list recent sessions and release it.
 *
 *   BROWSERBASE_API_KEY=... BROWSERBASE_PROJECT_ID=... node examples/sessions.ts
 */
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Browserbase from "../src/index.ts";

const program = Effect.gen(function* () {
  const projectId = process.env.BROWSERBASE_PROJECT_ID;

  // Sessions are released when the scope closes, even on failure or interruption.
  const session = yield* Effect.acquireRelease(
    Browserbase.createSession({ projectId, userMetadata: { example: "sessions" } }),
    (s) => Browserbase.updateSession({ id: s.id, status: "REQUEST_RELEASE" }).pipe(Effect.ignore),
  );
  yield* Effect.log(`Session ${session.id} -> ${session.connectUrl}`);

  const live = yield* Browserbase.getSessionLiveUrls({ id: session.id });
  yield* Effect.log(`Live view: ${live.debuggerFullscreenUrl}`);

  const running = yield* Browserbase.listSessions({ status: "RUNNING" });
  yield* Effect.log(`${running.length} running session(s)`);

  // Paginated operations stream items across pages on demand.
  const labels = yield* Browserbase.listLabels
    .items({ limit: 50 })
    .pipe(Stream.take(10), Stream.runCollect);
  yield* Effect.log(`First labels: ${[...labels].map((l) => l.name).join(", ") || "(none)"}`);
}).pipe(
  Effect.scoped,
  Effect.catchTags({
    Unauthorized: (e) => Effect.logError(`Check BROWSERBASE_API_KEY: ${e.message}`),
    PaymentRequired: (e) => Effect.logError(`Out of credits: ${e.message}`),
  }),
);

const BrowserbaseLive = Layer.mergeAll(FetchHttpClient.layer, Browserbase.CredentialsFromEnv);

program.pipe(Effect.provide(BrowserbaseLive), Effect.runPromise);
