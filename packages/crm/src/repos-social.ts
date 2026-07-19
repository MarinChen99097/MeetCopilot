/**
 * CompanySocialRepository — company_social_posts（016_social_tech.sql）的存取。
 * 社群 fetcher（youtube/threads/…）產出的結構化頻道統計/影片/貼文落庫；
 * bulkUpsert 以自然鍵 (org_id, company_id, platform, url) dedupe（重抓同一貼文更新、不重複）。
 * listByCompany 供 GET /api/crm/companies/:id/social 的 posts 段。org-scoped（WHERE org_id=?）。
 */
import type { DbPort, CompanySocialRepository } from "./ports.js";
import type { SocialPost, NewSocialPost } from "@meetcopilot/shared";
import { rowToDomain, SOCIAL_POST_DEFS } from "./mappers.js";
import { upsertChild, type ChildUpsertSpec } from "./child-upsert.js";

const SOCIAL_POST_SPEC: ChildUpsertSpec = {
  table: "company_social_posts",
  defs: SOCIAL_POST_DEFS,
  matchCols: ["platform", "url"],
  hasUpdatedAt: false,
};

export class SqliteCompanySocialRepository implements CompanySocialRepository {
  constructor(private readonly db: DbPort) {}

  async listByCompany(orgId: string, companyId: string): Promise<SocialPost[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT * FROM company_social_posts WHERE org_id = ? AND company_id = ?
       ORDER BY published_at DESC, created_at DESC`,
      [orgId, companyId],
    );
    return rows.map((r) => rowToDomain<SocialPost>(r, SOCIAL_POST_DEFS));
  }

  async bulkUpsert(orgId: string, companyId: string, rows: NewSocialPost[]): Promise<void> {
    await this.db.tx(async () => {
      for (const row of rows) {
        await upsertChild(this.db, SOCIAL_POST_SPEC, orgId, companyId, row as Record<string, unknown>);
      }
    });
  }
}
