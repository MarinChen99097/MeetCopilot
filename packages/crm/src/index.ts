/** @meetcopilot/crm — CRM 資料核心。ports（凍結接縫）+ A2 runtime（core/sqlite-db/migrate）。 */
export * from "./ports.js";
export * from "./core.js";
export { createSqliteDbPort, type SqliteHandle } from "./sqlite-db.js";
export { runMigrations } from "./migrate.js";
