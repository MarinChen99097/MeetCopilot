/**
 * TrainService — M4 語音模擬訓練（frozen interface：M234_CONTRACT §M4、API_CONTRACT §7）＋實作。
 *
 * 架構事實（API_FINDINGS §A、S3 spike）：瀏覽器拿 ephemeral token **直連 Gemini Live**，音訊不經我方 server。
 * 本 service 只負責：(1) 依 CRM verified persona 欄位過閘、(2) 鑄 token 並把 persona 鎖進去、(3) 存 session/逐字稿、
 * (4) finish 時用 LLM 對雙向逐字稿評分寫報告、(5) 讀報告。
 *
 * **信任閘（CRM_SCHEMA §9）**：persona 欄位逐欄查 field_provenance（human/verified 才可用），**不看 rollup**；
 * 爬蟲猜測的 persona 一律不進 system prompt。gating 與 prompt 組裝見 ./persona.ts。
 */
import type { CrmCore } from "@meetcopilot/crm";
import type {
  NewTrainSession,
  PersonaOption,
  StartTrainSessionResult,
  TrainReport,
  TrainTurn,
  TrainDifficulty,
} from "@meetcopilot/shared";
import type { LiveTokenMinter } from "./live-token.js";
import type { TrainScorer } from "./scoring.js";
import type { Meter } from "../ops/meter.js";
import { buildPersonaPrompt, personaReadiness, trustedFieldSet, passesGate } from "./persona.js";

export interface TrainService {
  /** List trainable contacts (only those whose persona fields pass the verified gate). */
  personas(orgId: string, companyId?: string): Promise<PersonaOption[]>;
  /** Start a session → ephemeral Live token + persona summary (browser connects to Gemini Live directly).
   *  userId（可選）為 ADMIN_CONTRACT §2 使用者歸屬，回填 gemini_live 記帳的 usage_events.user_id。 */
  startSession(orgId: string, input: NewTrainSession, userId?: string): Promise<StartTrainSessionResult>;
  /** Upload the two-way transcript (during / at end of practice). */
  saveTranscript(orgId: string, sessionId: string, turns: TrainTurn[]): Promise<void>;
  /** Finish → trigger LLM scoring over the two-way transcript → { reportId }. */
  finish(orgId: string, sessionId: string): Promise<{ reportId: string }>;
  /** Fetch a scored report. */
  report(orgId: string, reportId: string): Promise<TrainReport>;
}

/** 錯誤：呼叫者對映 HTTP 狀態（route 依 message 分流：not found→404、not ready→400、not configured→502）。 */
export class TrainError extends Error {
  constructor(
    public readonly kind: "not_found" | "not_ready" | "not_configured" | "bad_request",
    message: string,
  ) {
    super(message);
    this.name = "TrainError";
  }
}

export interface TrainServiceDeps {
  core: CrmCore;
  minter: LiveTokenMinter;
  scorer: TrainScorer;
  liveModel: string;
  /**
   * 成本記帳（ADMIN_CONTRACT §3.2）。有 meter 則於 startSession 鑄 Live token 成功時記一筆 `gemini_live`
   * （idemKey=`live:<sessionId>`，冪等）。Live 音訊瀏覽器直連 Gemini、token 數不經我方 server，故只記**次數**
   * ＋估值（無 token → est_cost 依 pricing fallback 為 0；註明估算）。省略 meter → 不記帳（行為不變）。
   */
  meter?: Meter;
  /** 無 companyId 時掃全 org 的公司頁上限（有界枚舉）。 */
  maxCompaniesScan?: number;
}

const DEFAULT_MAX_COMPANIES = 500;
const COMPANY_PAGE_SIZE = 100;

export function createTrainService(deps: TrainServiceDeps): TrainService {
  const { core, minter, scorer, liveModel, meter } = deps;
  const maxCompanies = deps.maxCompaniesScan ?? DEFAULT_MAX_COMPANIES;

  /** 有界枚舉本 org 的公司（無 companyId 時用）——經 repo 層，不繞過。 */
  async function listCompanyRefs(orgId: string): Promise<{ id: string; name: string }[]> {
    const out: { id: string; name: string }[] = [];
    let page = 1;
    for (;;) {
      const res = await core.companies.list(orgId, {}, { page, pageSize: COMPANY_PAGE_SIZE });
      for (const c of res.items) out.push({ id: c.id, name: c.name });
      if (out.length >= maxCompanies || page * COMPANY_PAGE_SIZE >= res.total || res.items.length === 0) break;
      page += 1;
    }
    return out.slice(0, maxCompanies);
  }

  return {
    async personas(orgId: string, companyId?: string): Promise<PersonaOption[]> {
      const companies = companyId
        ? await (async () => {
            const c = await core.companies.findById(orgId, companyId);
            return c ? [{ id: c.id, name: c.name }] : [];
          })()
        : await listCompanyRefs(orgId);

      const out: PersonaOption[] = [];
      for (const company of companies) {
        const contacts = await core.contacts.list(orgId, company.id); // ContactSummary[]
        for (const c of contacts) {
          const prov = await core.provenance.listForEntity(orgId, "contact", c.id);
          const readiness = personaReadiness(trustedFieldSet(prov));
          if (!passesGate(readiness)) continue; // 逐欄信任閘：無任何已驗證 persona 欄位 → 不可對練
          out.push({
            contactId: c.id,
            fullName: c.fullName,
            title: c.title ?? "",
            companyName: company.name,
            readiness,
          });
        }
      }
      return out;
    },

    async startSession(orgId: string, input: NewTrainSession, userId?: string): Promise<StartTrainSessionResult> {
      const contact = await core.contacts.findById(orgId, input.contactId);
      if (!contact) throw new TrainError("not_found", "contact not found");

      // 逐欄信任閘再驗一次（防前端拿未過閘的 contact 硬開）。
      const prov = await core.provenance.listForEntity(orgId, "contact", contact.id);
      const trusted = trustedFieldSet(prov);
      const readiness = personaReadiness(trusted);
      if (!passesGate(readiness)) {
        throw new TrainError(
          "not_ready",
          "this contact has no verified persona fields — confirm/fill persona in CRM before training",
        );
      }

      const company = await core.companies.findById(orgId, contact.companyId);
      const difficulty: TrainDifficulty = input.difficulty ?? "neutral";
      const systemInstruction = buildPersonaPrompt(contact, company, difficulty, trusted);

      // 鑄 token（persona 鎖進 token；外呼有界）。apiKey 缺 → minter 拋 → 對映 502。
      let minted;
      try {
        minted = await minter.mint({ model: liveModel, systemInstruction });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "could not mint Live token";
        if (/not configured/i.test(msg)) throw new TrainError("not_configured", msg);
        throw new TrainError("bad_request", msg);
      }

      const session = await core.training.createSession(orgId, {
        contactId: contact.id,
        dealId: input.dealId,
        difficulty,
      });

      // 記帳（ADMIN_CONTRACT §3.2）：一次 Live token 簽發＝一次 gemini_live 使用（記次數＋估值）。
      // idemKey=`live:<sessionId>` 冪等（同一 session 不重複計費）。記帳為副作用，失敗不影響回傳（meter 內部吞錯）。
      if (meter) {
        try {
          await meter.meter(
            orgId,
            "gemini_live",
            async () => ({ result: undefined, model: minted.model }),
            `live:${session.id}`,
            userId,
          );
        } catch {
          /* 記帳瑕疵不影響訓練啟動 */
        }
      }

      return {
        sessionId: session.id,
        live: { ephemeralToken: minted.token, model: minted.model, expireTime: minted.expireTime },
        persona: { displayName: contact.fullName, title: contact.title ?? "" },
      };
    },

    async saveTranscript(orgId: string, sessionId: string, turns: TrainTurn[]): Promise<void> {
      const session = await core.training.findSession(orgId, sessionId);
      if (!session) throw new TrainError("not_found", "training session not found");
      await core.training.saveTranscript(orgId, sessionId, turns);
    },

    async finish(orgId: string, sessionId: string): Promise<{ reportId: string }> {
      const session = await core.training.findSession(orgId, sessionId);
      if (!session) throw new TrainError("not_found", "training session not found");

      await core.training.finishSession(orgId, sessionId);

      const turns = session.transcript ?? [];
      if (turns.length === 0) {
        throw new TrainError("bad_request", "no transcript to score — upload the transcript before finishing");
      }

      const contact = await core.contacts.findById(orgId, session.contactId);
      const company = contact ? await core.companies.findById(orgId, contact.companyId) : null;

      let result;
      try {
        result = await scorer.score(turns, {
          personaName: contact?.fullName ?? "the customer",
          personaTitle: contact?.title ?? "",
          companyName: company?.name ?? "their company",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "scoring failed";
        if (/not configured/i.test(msg)) throw new TrainError("not_configured", msg);
        throw new TrainError("bad_request", msg);
      }

      return core.training.createReport(orgId, {
        sessionId,
        scores: result.scores,
        highlights: result.highlights,
        summary: result.summary,
      });
    },

    async report(orgId: string, reportId: string): Promise<TrainReport> {
      const report = await core.training.findReport(orgId, reportId);
      if (!report) throw new TrainError("not_found", "report not found");
      return report;
    },
  };
}
