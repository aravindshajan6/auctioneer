import type { db } from "./index";

/** The transaction handle Drizzle hands to `db.transaction(...)` callbacks. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Anything that can run a query: the pool or an open transaction. */
export type Executor = typeof db | Tx;
