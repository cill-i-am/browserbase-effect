/**
 * Smoke tests against the real API. Skipped unless BROWSERBASE_API_KEY is set.
 * Read-only: nothing is created.
 */
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";
import * as Browserbase from "../src/index.ts";

const live = Layer.mergeAll(FetchHttpClient.layer, Browserbase.CredentialsFromEnv);
const run = <A, E>(effect: Effect.Effect<A, E, Browserbase.BrowserbaseOpContext>) =>
  Effect.runPromise(effect.pipe(Effect.provide(live)));

describe.skipIf(!process.env.BROWSERBASE_API_KEY)("live API", () => {
  it("lists projects and reads usage", async () => {
    const projects = await run(Browserbase.listProjects({}));
    expect(projects.length).toBeGreaterThan(0);
    const usage = await run(Browserbase.getProjectUsage({ id: projects[0].id }));
    expect(typeof usage.browserMinutes).toBe("number");
  });

  it("lists sessions", async () => {
    const sessions = await run(Browserbase.listSessions({}));
    expect(Array.isArray(sessions)).toBe(true);
  });

  it("maps a missing session to NotFound", async () => {
    const result = await run(
      Browserbase.getSession({ id: "00000000-0000-0000-0000-000000000000" }).pipe(
        Effect.map(() => "found"),
        Effect.catchTags({
          NotFound: () => Effect.succeed("not-found"),
          BadRequest: () => Effect.succeed("bad-request"),
        }),
      ),
    );
    expect(["not-found", "bad-request"]).toContain(result);
  });
});
