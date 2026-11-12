/**
 * Re-export the shared error-category system from core.
 *
 * @example
 * ```ts
 * import * as Category from "browserbase-effect/Category";
 *
 * program.pipe(Category.catchNotFoundError(() => Effect.succeed(undefined)));
 * ```
 */
export * from "@distilled.cloud/core/category";
