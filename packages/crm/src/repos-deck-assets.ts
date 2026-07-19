/**
 * DeckAssetRepository 的實作（deck_assets；migration 018）。
 * 存匯入原簡報的原檔 bytes（source_pptx/source_pdf）與逐頁點陣圖（page_image，PNG）。
 * port-agnostic：同一類別跑 SQLite（BLOB↔Buffer）與 Postgres（bytea↔Buffer）——兩驅動皆天然回 Node Buffer。
 *
 * 授權：串流端點純簽章授權（<img> 帶不了 Bearer），故 getAsset 以 assetId 主鍵查、不收 orgId；
 * route 層以「簽章 + asset.deckId==path deckId + deck.org 存在」做縱深防禦（見 decks-routes/assets-route.ts）。
 */
import type { DbPort } from "./ports.js";
import type {
  DeckAssetRepository,
  NewDeckAsset,
  DeckAssetRef,
  DeckSourceAsset,
} from "./ports.js";
import type { DeckAssetKind } from "@meetcopilot/shared";
import { uuidv7 } from "./uuid.js";

interface DeckAssetRow {
  id: string;
  deck_id: string;
  org_id: string;
  kind: string;
  page_index: number | null;
  mime: string;
  bytes: Buffer;
  byte_size: number;
  created_at: number;
}

export class SqliteDeckAssetRepository implements DeckAssetRepository {
  constructor(private readonly db: DbPort) {}

  async insertAsset(input: NewDeckAsset): Promise<string> {
    const id = uuidv7();
    const now = Date.now();
    // byte_size 由 repo 以 bytes.length 落庫（不信任呼叫端），與 bytes 保持一致。
    await this.db.run(
      `INSERT INTO deck_assets (id, deck_id, org_id, kind, page_index, mime, bytes, byte_size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.deckId,
        input.orgId,
        input.kind,
        input.pageIndex ?? null,
        input.mime,
        input.bytes,
        input.bytes.length,
        now,
      ],
    );
    return id;
  }

  async getAsset(assetId: string): Promise<DeckAssetRef | null> {
    const row = await this.db.get<DeckAssetRow>("SELECT * FROM deck_assets WHERE id = ?", [assetId]);
    if (!row) return null;
    return {
      deckId: row.deck_id,
      orgId: row.org_id,
      kind: row.kind as DeckAssetKind,
      mime: row.mime,
      bytes: row.bytes,
    };
  }

  async getSourceAsset(deckId: string): Promise<DeckSourceAsset | null> {
    const row = await this.db.get<DeckAssetRow>(
      "SELECT * FROM deck_assets WHERE deck_id = ? AND kind IN ('source_pptx','source_pdf') ORDER BY created_at ASC LIMIT 1",
      [deckId],
    );
    if (!row) return null;
    return { assetId: row.id, mime: row.mime, bytes: row.bytes };
  }
}
