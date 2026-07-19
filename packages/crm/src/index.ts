/** @meetcopilot/crm — CRM 資料核心。ports（凍結接縫）+ runtime（core/sqlite-db/migrate/repos）。 */
export * from "./ports.js";
export * from "./core.js";
export { createSqliteDbPort, type SqliteHandle } from "./sqlite-db.js";
export { createPgDbPort, runMigrationsPg, toPgPlaceholders, type PgHandle } from "./pg-db.js";
export { runMigrations } from "./migrate.js";
export {
  SqliteOrgRepository,
  SqliteUserRepository,
  SqliteMembershipRepository,
} from "./repos.js";
export {
  SqliteCompanyRepository,
  SqliteContactRepository,
  SqliteCompanyProductRepository,
  SqliteCompanyChildRepository,
} from "./repos-prospect.js";
export { SqliteDealRepository, SqliteNoteRepository } from "./repos-pipeline.js";
export {
  SqliteProvenanceRepository,
  SqliteEmbeddingRepository,
  SqliteProfileCardRepository,
} from "./repos-retrieval.js";
export { SqliteTrainingRepository } from "./repos-training.js";
export {
  SqliteDeckRepository,
  I1ViolationError,
  DeckNotFoundError,
  OriginalSlideLockedError,
  DECK_IMPORT_INTERRUPTED_ERROR,
} from "./repos-decks.js";
export { SqliteDeckAssetRepository } from "./repos-deck-assets.js";
export { SqliteImportJobRepository, IMPORT_REAPER_INTERRUPTED_ERROR } from "./repos-import-jobs.js";
export {
  SqliteInviteRepository,
  SqliteMemberRepository,
  LastOwnerError,
  MemberNotFoundError,
} from "./repos-invites.js";
