/**
 * A scripted `fetch` for tests: each call is recorded and answered by the
 * next handler, so tests assert on the exact wire request the SDK sends.
 */
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";
import * as Layer from "effect/Layer";
import * as Browserbase from "../src/index.ts";

export interface Recorded {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
  readonly body: string | FormData | undefined;
}

export type Handler = (req: Recorded) => Response | Promise<Response>;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

export const mock = (...handlers: Handler[]) => {
  const requests: Recorded[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const contentType = request.headers.get("content-type") ?? "";
    const body =
      request.body === null
        ? undefined
        : contentType.startsWith("multipart/form-data")
          ? await request.formData()
          : await request.text();
    const recorded: Recorded = {
      method: request.method,
      url: new URL(request.url),
      headers: request.headers,
      body,
    };
    requests.push(recorded);
    const handler = handlers[requests.length - 1] ?? handlers[handlers.length - 1];
    if (!handler) throw new Error(`Unexpected request ${request.method} ${request.url}`);
    return handler(recorded);
  };
  const layer = Layer.mergeAll(
    FetchHttpClient.layer,
    Layer.succeed(FetchHttpClient.Fetch, fetch as typeof globalThis.fetch),
    Browserbase.fromApiKey({ apiKey: "bb_test_key" }),
  );
  const run = <A, E>(effect: Effect.Effect<A, E, Browserbase.BrowserbaseOpContext>): Promise<A> =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)));
  const runExit = <A, E>(effect: Effect.Effect<A, E, Browserbase.BrowserbaseOpContext>) =>
    Effect.runPromise(Effect.exit(effect.pipe(Effect.provide(layer))));
  return { requests, layer, run, runExit };
};
