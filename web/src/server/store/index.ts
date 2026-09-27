import { Pool } from "pg";

import { serverConfig } from "../config";

import { DatabaseInvoiceStore } from "./database-store";
import { FileInvoiceStore } from "./file-store";
import type { PaymentStore } from "./types";

export * from "./types";
export { DatabaseInvoiceStore } from "./database-store";
export { FileInvoiceStore } from "./file-store";

/**
 * The adapter SOLAGENT_STORE selects: "file" (default, one process) or "postgres" (any number of instances).
 * Postgres without a connection string has no database to use, so it falls back to the file store, and says so. A
 * configured database that's unreachable is not swapped out: writing orders somewhere else would split them from the
 * other instances, so those requests fail with a 503 until it's back (see guarded in ../http).
 */
export function createStore(log: (message: string) => void): PaymentStore {
  if (serverConfig.store === "file") return new FileInvoiceStore(serverConfig.dataDir);
  if (!serverConfig.databaseUrl) {
    log(`SOLAGENT_STORE=postgres, but neither SOLAGENT_DATABASE_URL nor DATABASE_URL is set: using the file store in ${serverConfig.dataDir} instead.`);
    return new FileInvoiceStore(serverConfig.dataDir);
  }
  const pool = new Pool({ connectionString: serverConfig.databaseUrl, max: serverConfig.databasePoolMax });
  // Without a listener, an idle connection dropped by the server would crash the process.
  pool.on("error", (error) => log(`database connection error: ${error.message}`));
  return new DatabaseInvoiceStore(pool);
}
