import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vitest";
import * as Browserbase from "../src/index.ts";
import { json, mock } from "./mock.ts";

const session = {
  id: "sess_1",
  createdAt: "2026-11-12T00:00:00Z",
  updatedAt: "2026-11-12T00:00:00Z",
  projectId: "proj_1",
  startedAt: "2026-11-12T00:00:00Z",
  expiresAt: "2026-11-12T01:00:00Z",
  status: "RUNNING",
  proxyBytes: 0,
  keepAlive: false,
  region: "us-west-2",
};

describe("requests", () => {
  it("createSession: POST JSON body with the API key header", async () => {
    const m = mock(() =>
      json(
        {
          ...session,
          connectUrl: "wss://connect",
          seleniumRemoteUrl: "https://s",
          signingKey: "k",
        },
        201,
      ),
    );
    const created = await m.run(
      Browserbase.createSession({
        projectId: "proj_1",
        keepAlive: true,
        browserSettings: { viewport: { width: 1280, height: 720 } },
        userMetadata: { team: "qa" },
      }),
    );
    expect(created.connectUrl).toBe("wss://connect");
    expect(created.status).toBe("RUNNING");

    const [req] = m.requests;
    expect(req.method).toBe("POST");
    expect(req.url.href).toBe("https://api.browserbase.com/v1/sessions");
    expect(req.headers.get("x-bb-api-key")).toBe("bb_test_key");
    expect(req.headers.get("content-type")).toContain("application/json");
    expect(JSON.parse(req.body as string)).toEqual({
      projectId: "proj_1",
      keepAlive: true,
      browserSettings: { viewport: { width: 1280, height: 720 } },
      userMetadata: { team: "qa" },
    });
  });

  it("getSession: path label + query parameter, no body", async () => {
    const m = mock(() => json({ ...session, labels: [] }));
    const got = await m.run(Browserbase.getSession({ id: "sess/1", includeLabels: true }));
    expect(got.id).toBe("sess_1");
    const [req] = m.requests;
    expect(req.method).toBe("GET");
    expect(req.url.pathname).toBe("/v1/sessions/sess%2F1");
    expect(req.url.searchParams.get("includeLabels")).toBe("true");
    expect(req.body).toBeUndefined();
  });

  it("listSessions: bare JSON array response", async () => {
    const m = mock(() => json([session, { ...session, id: "sess_2" }]));
    const sessions = await m.run(Browserbase.listSessions({ status: "RUNNING" }));
    expect(sessions.map((s) => s.id)).toEqual(["sess_1", "sess_2"]);
    expect(m.requests[0].url.search).toBe("?status=RUNNING");
  });

  it("delete operations accept 204 No Content", async () => {
    const m = mock(() => new Response(null, { status: 204 }));
    await m.run(Browserbase.deleteContext({ id: "ctx_1" }));
    expect(m.requests[0].method).toBe("DELETE");
    expect(m.requests[0].url.pathname).toBe("/v1/contexts/ctx_1");
  });

  it("uploadSessionFile: multipart/form-data with the file under `file`", async () => {
    const m = mock(() => json({ message: "ok" }));
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    await m.run(Browserbase.uploadSessionFile({ id: "sess_1", file }));
    const [req] = m.requests;
    expect(req.headers.get("content-type")).toContain("multipart/form-data");
    const part = (req.body as FormData).get("file") as File;
    expect(part.name).toBe("hello.txt");
    expect(await part.text()).toBe("hello");
  });

  it("getDownloadContent: Accept: application/octet-stream, bytes out", async () => {
    const m = mock(
      () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "application/octet-stream" },
        }),
    );
    const bytes = await m.run(Browserbase.getDownloadContent({ id: "dl_1" }));
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(m.requests[0].headers.get("accept")).toBe("application/octet-stream");
  });

  it("getSessionReplayPage: HLS playlist as text", async () => {
    const m = mock(
      () =>
        new Response("#EXTM3U\n", { headers: { "content-type": "application/vnd.apple.mpegurl" } }),
    );
    const playlist = await m.run(
      Browserbase.getSessionReplayPage({ id: "sess_1", pageId: "page_1" }),
    );
    expect(playlist).toBe("#EXTM3U\n");
  });

  it("createWebhook: the signing secret comes back Redacted", async () => {
    const m = mock(() =>
      json(
        {
          id: "wh_1",
          projectId: "proj_1",
          endpoint: "https://example.com/hook",
          eventTypes: ["functions.invocations.completed"],
          createdAt: "2026-11-12T00:00:00Z",
          updatedAt: "2026-11-12T00:00:00Z",
          secret: "whsec_abc",
        },
        201,
      ),
    );
    const hook = await m.run(
      Browserbase.createWebhook({
        endpoint: "https://example.com/hook",
        eventTypes: ["functions.invocations.completed"],
      }),
    );
    expect(Redacted.isRedacted(hook.secret)).toBe(true);
    expect(Redacted.value(hook.secret)).toBe("whsec_abc");
    expect(String(hook.secret)).not.toContain("whsec_abc");
  });

  it("honours a custom base URL", async () => {
    const m = mock(() => json([]));
    await Effect.runPromise(
      Browserbase.listProjects({}).pipe(
        Effect.provide(Browserbase.fromApiKey({ apiKey: "k2", apiBaseUrl: "http://localhost:9/" })),
        Effect.provide(m.layer),
      ),
    );
    expect(m.requests[0].url.href).toBe("http://localhost:9/v1/projects");
    expect(m.requests[0].headers.get("x-bb-api-key")).toBe("k2");
  });
});

describe("errors", () => {
  const failWith = async (
    status: number,
    body: unknown = { statusCode: status, error: "E", message: "boom" },
  ) => {
    const m = mock(() => json(body, status));
    const exit = await m.runExit(
      Browserbase.getSession({ id: "missing" }).pipe(Browserbase.Retry.none),
    );
    if (!Exit.isFailure(exit)) throw new Error("expected failure");
    const error = exit.cause.reasons.find((r) => r._tag === "Fail") as any;
    return error.error;
  };

  it.each([
    [400, "BadRequest"],
    [401, "Unauthorized"],
    [402, "PaymentRequired"],
    [403, "Forbidden"],
    [404, "NotFound"],
    [409, "Conflict"],
    [410, "Gone"],
    [422, "UnprocessableEntity"],
    [429, "TooManyRequests"],
    [500, "InternalServerError"],
    [503, "ServiceUnavailable"],
  ])("HTTP %i -> %s", async (status, tag) => {
    const error = await failWith(status);
    expect(error._tag).toBe(tag);
    expect(error.message).toBe("boom");
  });

  it("unmapped 4xx -> UnknownBrowserbaseError with the body", async () => {
    const error = await failWith(418, { statusCode: 418, error: "I'm a teapot", message: "short" });
    expect(error._tag).toBe("UnknownBrowserbaseError");
    expect(error.status).toBe(418);
    expect(error.code).toBe("I'm a teapot");
  });

  it("errors are catchable by tag and by category", async () => {
    const m = mock(() => json({ statusCode: 404, error: "Not Found", message: "nope" }, 404));
    const byTag = await m.run(
      Browserbase.getContext({ id: "x" }).pipe(
        Effect.catchTag("NotFound", (e) => Effect.succeed(`tag:${e.message}`)),
      ),
    );
    expect(byTag).toBe("tag:nope");
    const byCategory = await m.run(
      Browserbase.getContext({ id: "x" }).pipe(
        Browserbase.Category.catchNotFoundError(() => Effect.succeed("category")),
      ),
    );
    expect(byCategory).toBe("category");
  });

  it("missing BROWSERBASE_API_KEY -> ConfigError", async () => {
    const previous = process.env.BROWSERBASE_API_KEY;
    delete process.env.BROWSERBASE_API_KEY;
    try {
      const m = mock(() => json([]));
      const exit = await Effect.runPromise(
        Effect.exit(
          Browserbase.listProjects({}).pipe(
            Effect.provide(Browserbase.CredentialsFromEnv),
            Effect.provide(m.layer),
          ),
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(JSON.stringify(exit)).toContain("ConfigError");
      expect(m.requests).toHaveLength(0);
    } finally {
      if (previous !== undefined) process.env.BROWSERBASE_API_KEY = previous;
    }
  });
});

describe("retries", () => {
  it("Retry.transient retries 503 then succeeds", async () => {
    const m = mock(
      () =>
        json({ statusCode: 503, error: "Unavailable", message: "later" }, 503, {
          "retry-after": "0",
        }),
      () => json([session]),
    );
    const sessions = await m.run(Browserbase.listSessions({}).pipe(Browserbase.Retry.transient));
    expect(sessions).toHaveLength(1);
    expect(m.requests).toHaveLength(2);
  });

  it("Retry.none surfaces the first failure", async () => {
    const m = mock(
      () => json({ statusCode: 503, error: "Unavailable", message: "later" }, 503),
      () => json([session]),
    );
    const exit = await m.runExit(Browserbase.listSessions({}).pipe(Browserbase.Retry.none));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(m.requests).toHaveLength(1);
  });
});

describe("pagination", () => {
  const label = (id: string) => ({ id, name: id, createdAt: "2026-11-12T00:00:00Z" });

  it("cursor: follows nextCursor until null", async () => {
    const m = mock(
      () => json({ data: [label("a"), label("b")], limit: 2, nextCursor: "c1" }),
      () => json({ data: [label("c")], limit: 2, nextCursor: null }),
    );
    const ids = await m.run(
      Browserbase.listLabels.items({ limit: 2 }).pipe(
        Stream.map((l) => l.id),
        Stream.runCollect,
      ),
    );
    expect([...ids]).toEqual(["a", "b", "c"]);
    expect(m.requests.map((r) => r.url.search)).toEqual(["?limit=2", "?limit=2&cursor=c1"]);
  });

  it("offset: advances by page size until total", async () => {
    const fn = (id: string) => ({ id, name: id, createdAt: "", updatedAt: "", projectId: "p" });
    const m = mock(
      () => json({ data: [fn("f1"), fn("f2")], total: 3 }),
      () => json({ data: [fn("f3")], total: 3 }),
    );
    const ids = await m.run(
      Browserbase.listFunctions.items({ limit: 2 }).pipe(
        Stream.map((f) => f.id),
        Stream.runCollect,
      ),
    );
    expect([...ids]).toEqual(["f1", "f2", "f3"]);
    expect(m.requests.map((r) => r.url.searchParams.get("offset"))).toEqual(["0", "2"]);
  });

  it("since: follows nextSince until an empty page", async () => {
    const msg = (id: string) => ({
      id,
      createdAt: "",
      message: { role: "assistant", content: id },
    });
    const m = mock(
      () => json({ data: [msg("m1"), msg("m2")], nextSince: "m2" }),
      () => json({ data: [], nextSince: "m2" }),
    );
    const ids = await m.run(
      Browserbase.listAgentRunMessages.items({ runId: "run_1" }).pipe(
        Stream.map((x) => x.id),
        Stream.runCollect,
      ),
    );
    expect([...ids]).toEqual(["m1", "m2"]);
    expect(m.requests.map((r) => r.url.searchParams.get("since"))).toEqual([null, "m2"]);
  });

  it("a paginated operation is still callable for a single page", async () => {
    const m = mock(() => json({ data: [label("a")], limit: 20, nextCursor: null }));
    const page = await m.run(Browserbase.listLabels({}));
    expect(page.data).toHaveLength(1);
  });
});

describe("response validation", () => {
  it("strict mode accepts a well-formed body and rejects a malformed one", async () => {
    const { ResponseValidation } = await import("@distilled.cloud/core");
    const ok = mock(() => json([session]));
    const sessions = await ok.run(
      Browserbase.listSessions({}).pipe(Effect.provide(ResponseValidation.strict)),
    );
    expect(sessions).toHaveLength(1);

    const bad = mock(() => json([{ ...session, proxyBytes: "lots" }]));
    const exit = await bad.runExit(
      Browserbase.listSessions({}).pipe(
        Effect.provide(ResponseValidation.strict),
        Browserbase.Retry.none,
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain("BrowserbaseParseError");
  });
});
