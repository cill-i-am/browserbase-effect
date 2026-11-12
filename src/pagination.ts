/**
 * Browserbase pagination -- hand-written.
 *
 * Browserbase list endpoints page three ways:
 *
 *   cursor  `cursor` in, `nextCursor` out (null on the last page), items
 *           under `data` -- agents, runs, labels, secrets, webhooks. Uses
 *           core's {@link paginateCursor}.
 *
 *   offset  `offset` + `limit` in, `total` out, items under `data` /
 *           `results` / `downloads` -- functions, builds, versions,
 *           invocations, downloads. {@link paginateOffset}.
 *
 *   since   `since` in, `nextSince` out -- run messages. `nextSince` is the
 *           id of the last message and is returned even on the final page,
 *           so traversal stops on the first empty page.
 *           {@link paginateSince}.
 */
import { getItems, getPath, isTerminalToken } from "@distilled.cloud/core/pagination";
import type { PaginatedTrait } from "@distilled.cloud/core/pagination";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

export { paginateCursor } from "@distilled.cloud/core/pagination";

const requireField = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`Browserbase pagination trait is missing ${name}`);
  return value;
};

/**
 * Offset pagination: request `offset`, advance it by the number of items
 * received, stop when the page is empty or `offset` reaches `total`.
 */
export const paginateOffset = <Input extends Record<string, unknown>, Output, E, R>(
  operation: (input: Input) => Effect.Effect<Output, E, R>,
  input: Input,
  pagination: PaginatedTrait,
): Stream.Stream<Output, E, R> => {
  const inputToken = requireField(pagination.inputToken, "inputToken");
  const items = requireField(pagination.items, "items");
  const totalPath = pagination.outputToken;
  const start = typeof input[inputToken] === "number" ? (input[inputToken] as number) : 0;

  return Stream.unfold({ offset: start, done: false }, (state) =>
    Effect.gen(function* () {
      if (state.done) return undefined;
      const page = yield* operation({ ...input, [inputToken]: state.offset } as Input);
      const count = getItems(page, items).length;
      const next = state.offset + count;
      const total = totalPath ? getPath(page, totalPath) : undefined;
      const done = count === 0 || (typeof total === "number" && next >= total);
      return [page, { offset: next, done }] as const;
    }),
  );
};

/**
 * "Since" pagination: pass `outputToken` back as `inputToken` until a page
 * comes back empty, the token is absent, or it stops advancing.
 */
export const paginateSince = <Input extends Record<string, unknown>, Output, E, R>(
  operation: (input: Input) => Effect.Effect<Output, E, R>,
  input: Input,
  pagination: PaginatedTrait,
): Stream.Stream<Output, E, R> => {
  const inputToken = requireField(pagination.inputToken, "inputToken");
  const outputToken = requireField(pagination.outputToken, "outputToken");
  const items = pagination.items;
  const start = typeof input[inputToken] === "string" ? (input[inputToken] as string) : undefined;

  return Stream.unfold({ token: start, done: false }, (state) =>
    Effect.gen(function* () {
      if (state.done) return undefined;
      const page = yield* operation(
        (state.token === undefined ? input : { ...input, [inputToken]: state.token }) as Input,
      );
      const next = getPath(page, outputToken);
      const empty = items !== undefined && getItems(page, items).length === 0;
      const done = empty || isTerminalToken(next) || next === state.token;
      return [page, { token: typeof next === "string" ? next : undefined, done }] as const;
    }),
  );
};
