/**
 * 語音模擬訓練 HTTP 路由（API_CONTRACT §7）。全部 Bearer 認證，org 由 JWT 推導（req.auth.orgId），前端永不傳 orgId。
 *   GET  /api/train/personas?companyId=            → PersonaOption[]（只列 persona 欄位過 verified 閘者）
 *   POST /api/train/sessions {contactId,dealId?,difficulty?} → {sessionId, live:{ephemeralToken,model,expireTime}, persona}
 *   POST /api/train/sessions/:id/transcript {turns} → 200（存雙向逐字稿）
 *   POST /api/train/sessions/:id/finish            → {reportId}（觸發 LLM 評分）
 *   GET  /api/train/reports/:id                    → TrainReport
 *
 * 音訊本身**不經此路由**：瀏覽器拿 ephemeralToken 直連 Gemini Live。
 * TrainError → HTTP：not_found→404、not_ready→400、not_configured→502（GEMINI 未設定）、bad_request→400。
 */
import { Router } from "express";
import type { Request, Response } from "express";
import type { CrmCore } from "@meetcopilot/crm";
import type { TrainDifficulty, TrainTurn } from "@meetcopilot/shared";
import { TRAIN_DIFFICULTIES } from "@meetcopilot/shared";
import { authRequired } from "../auth/jwt.js";
import { createGeminiClient } from "../gemini.js";
import type { AppConfig } from "../config.js";
import { createTrainService, TrainError, type TrainService } from "./train-service.js";
import { createLiveTokenMinter } from "./live-token.js";
import { createTrainScorer } from "./scoring.js";

type Json = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/**
 * TrainError → 狀態碼。未知錯誤（如 SQLITE_BUSY 等 DB 例外）**一律回 500 {error}**，不再 re-throw：
 * 這些 handler 是裸 async function，Express 4 不會捕捉 handler 內拋出/rejected 的 promise——一 re-throw
 * 就變 unhandledRejection，請求會一路掛到 socket timeout（F5）。永遠送出回應才不會 hang。
 */
function sendTrainError(res: Response, err: unknown): void {
  if (res.headersSent) return;
  if (err instanceof TrainError) {
    const status =
      err.kind === "not_found" ? 404 : err.kind === "not_configured" ? 502 : 400;
    res.status(status).json({ error: err.message });
    return;
  }
  console.error("[train] unexpected error:", err);
  res.status(500).json({ error: "internal error" });
}

/** 供測試/替換注入（預設由 config 現場組裝 minter/scorer/service）。 */
export interface TrainRouterDeps {
  service?: TrainService;
}

export function createTrainRouter(
  core: CrmCore,
  config: AppConfig,
  jwtSecret: string,
  deps: TrainRouterDeps = {},
): Router {
  const gemini = createGeminiClient(config.gemini);
  const service =
    deps.service ??
    createTrainService({
      core,
      minter: createLiveTokenMinter(config.gemini.apiKey),
      scorer: createTrainScorer(gemini, config.gemini.extractModel),
      liveModel: config.gemini.liveModel,
    });

  const router = Router();
  router.use(authRequired(jwtSecret));

  // GET /api/train/personas?companyId=
  router.get("/personas", async (req: Request, res: Response) => {
    const orgId = req.auth!.orgId;
    const companyId = str(req.query.companyId) ?? undefined;
    try {
      res.json(await service.personas(orgId, companyId));
    } catch (err) {
      sendTrainError(res, err);
    }
  });

  // POST /api/train/sessions
  router.post("/sessions", async (req: Request, res: Response) => {
    const orgId = req.auth!.orgId;
    const body = (req.body ?? {}) as Json;
    const contactId = str(body.contactId);
    if (!contactId) {
      res.status(400).json({ error: "contactId is required" });
      return;
    }
    const dealId = str(body.dealId) ?? undefined;
    const rawDifficulty = str(body.difficulty);
    if (rawDifficulty && !TRAIN_DIFFICULTIES.includes(rawDifficulty as TrainDifficulty)) {
      res.status(400).json({ error: "difficulty must be 'friendly', 'neutral', or 'hostile'" });
      return;
    }
    const difficulty = (rawDifficulty as TrainDifficulty | null) ?? undefined;
    try {
      res.json(await service.startSession(orgId, { contactId, dealId, difficulty }));
    } catch (err) {
      sendTrainError(res, err);
    }
  });

  // POST /api/train/sessions/:id/transcript
  router.post("/sessions/:id/transcript", async (req: Request, res: Response) => {
    const orgId = req.auth!.orgId;
    const sessionId = req.params.id ?? "";
    const body = (req.body ?? {}) as Json;
    const turns = parseTurns(body.turns);
    if (turns === null) {
      res.status(400).json({ error: "turns must be an array of {speaker:'rep'|'ai', text, t}" });
      return;
    }
    try {
      await service.saveTranscript(orgId, sessionId, turns);
      res.status(200).json({ ok: true });
    } catch (err) {
      sendTrainError(res, err);
    }
  });

  // POST /api/train/sessions/:id/finish
  router.post("/sessions/:id/finish", async (req: Request, res: Response) => {
    const orgId = req.auth!.orgId;
    const sessionId = req.params.id ?? "";
    try {
      res.json(await service.finish(orgId, sessionId));
    } catch (err) {
      sendTrainError(res, err);
    }
  });

  // GET /api/train/reports/:id
  router.get("/reports/:id", async (req: Request, res: Response) => {
    const orgId = req.auth!.orgId;
    const reportId = req.params.id ?? "";
    try {
      res.json(await service.report(orgId, reportId));
    } catch (err) {
      sendTrainError(res, err);
    }
  });

  return router;
}

/** 驗證 + 正規化 turns body。非陣列/元素形狀不符 → null（route 回 400）。 */
function parseTurns(raw: unknown): TrainTurn[] | null {
  if (!Array.isArray(raw)) return null;
  const out: TrainTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    const speaker = o.speaker;
    if (speaker !== "rep" && speaker !== "ai") return null;
    if (typeof o.text !== "string") return null;
    const t = typeof o.t === "number" ? o.t : Number(o.t);
    out.push({ speaker, text: o.text, t: Number.isFinite(t) ? t : 0 });
  }
  return out;
}
