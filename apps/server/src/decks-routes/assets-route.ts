/**
 * Asset 串流端點（契約 §3）：GET /api/decks/:id/assets/:assetId?exp=&sig=
 *
 * **此 router 刻意不套 authRequired**（<img> 帶不了 Bearer）——純簽章授權。
 * 由 src/index.ts 掛在 jwtGuard 之前的免 auth 區段（其餘 deck route 仍在 authRequired 之後）。
 *
 * 放行條件（三重）：
 *  1) verifyAssetSig(deckId, assetId, exp, sig)——短效 HMAC 簽章有效且未過期。
 *  2) asset 存在且 asset.deckId === path 的 :id（asset 確實屬於該 deck）。
 *  3) 縱深防禦：該 deck 在 asset.orgId 下存在（org 綁定；擋跨 org 資料異常/竄改）。
 * 回應：Content-Type = asset.mime，res.send(bytes)（比照 export.pptx 二進位範式）。
 */
import { Router } from "express";
import type { CrmCore } from "@meetcopilot/crm";
import { verifyAssetSig } from "../lib/signed-url.js";
import { asyncHandler, param, notFound } from "../crm-routes/helpers.js";

export function createDeckAssetsRouter(core: CrmCore): Router {
  const router = Router();

  router.get(
    "/decks/:id/assets/:assetId",
    asyncHandler(async (req, res) => {
      const deckId = param(req, "id");
      const assetId = param(req, "assetId");
      const exp = Number(req.query.exp);
      const sig = typeof req.query.sig === "string" ? req.query.sig : "";

      if (!verifyAssetSig(deckId, assetId, exp, sig)) {
        res.status(403).json({ error: "invalid or expired signature" });
        return;
      }

      const asset = await core.deckAssets.getAsset(assetId);
      if (!asset || asset.deckId !== deckId) {
        notFound(res, "asset not found");
        return;
      }

      // 縱深防禦：確認該 deck 在此 asset 的 org 下存在（asset 與 deck 的 org 綁定一致）。
      const deck = await core.decks.findById(asset.orgId, deckId);
      if (!deck) {
        notFound(res, "asset not found");
        return;
      }

      res.setHeader("Content-Type", asset.mime);
      // 簽章 URL 本身短效；快取設 private 讓瀏覽器可短暫重用同一張圖，不進共享快取。
      res.setHeader("Cache-Control", "private, max-age=600");
      res.send(asset.bytes);
    }),
  );

  return router;
}
