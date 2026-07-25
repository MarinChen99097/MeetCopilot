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
  PersonaDraftResult,
  PersonaFieldDraft,
  NewSyntheticPersona,
  CreateSyntheticResult,
  StartTrainSessionResult,
  TrainReport,
  TrainTurn,
  TrainDifficulty,
  TrainMode,
} from "@meetcopilot/shared";
import { randomUUID } from "node:crypto";
import type { LiveTokenMinter } from "./live-token.js";
import type { TrainScorer, ReportLang } from "./scoring.js";
import type { Meter } from "../ops/meter.js";
import type { GeminiClient } from "../gemini.js";
import { meteredGeminiClient } from "../ops/metered-gemini.js";
import { buildPersonaPrompt, personaReadiness, trustedFieldSet, canTrain, pickPersonaVoice } from "./persona.js";
import {
  draftPersonaForContact,
  designSyntheticPersona,
  personaDraftToContactPatch,
} from "./persona-gen.js";

export interface TrainService {
  /** List trainable contacts (only those whose persona fields pass the verified gate). */
  personas(orgId: string, companyId?: string): Promise<PersonaOption[]>;
  /** Start a session → ephemeral Live token + persona summary (browser connects to Gemini Live directly).
   *  userId（可選）為 ADMIN_CONTRACT §2 使用者歸屬，回填 gemini_live 記帳的 usage_events.user_id。 */
  startSession(orgId: string, input: NewTrainSession, userId?: string): Promise<StartTrainSessionResult>;
  /**
   * #1 讓 AI 補齊真人 persona：跑 LLM 產九欄草稿 → 以**未驗證（crawler 級）provenance** 寫入該 contact（不標 human/verified）
   * → 設 trainingUnlocked=1（直接可對練）。回九欄草稿。contact 不存在→not_found；gemini 未設→not_configured。
   */
  draftPersona(orgId: string, contactId: string, userId?: string): Promise<PersonaDraftResult>;
  /**
   * #4 建立 AI 虛擬人物：autoDesign（或 persona 省略）→ LLM 依公司設計九欄；否則用帶入 persona。建 is_synthetic=1 的 contact，
   * persona 以 **human provenance** 寫入 + trainingUnlocked=1。回 {contactId}。company 不存在→not_found；autoDesign 但 gemini 未設→not_configured。
   */
  createSynthetic(orgId: string, input: NewSyntheticPersona, userId?: string): Promise<CreateSyntheticResult>;
  /** Upload the two-way transcript (during / at end of practice). */
  saveTranscript(orgId: string, sessionId: string, turns: TrainTurn[]): Promise<void>;
  /** Finish → trigger LLM scoring over the two-way transcript → { reportId }.
   *  reportLang（可選，預設 'zh'）＝報告文字語言，跟 app i18n locale（web finish 時帶當前 locale）。 */
  finish(orgId: string, sessionId: string, userId?: string, reportLang?: ReportLang): Promise<{ reportId: string }>;
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
  /** Raw Gemini client——finish 評分時現包 metered client 記帳（洞 D，gemini_text）。 */
  gemini: GeminiClient;
  liveModel: string;
  /** persona 產生（#1/#4）用的文字模型 id——僅供寫入 provenance 的 model 欄（生成本身走 gemini client 預設 textModel）。 */
  textModel?: string;
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
  const { core, minter, scorer, gemini, liveModel, meter, textModel } = deps;
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
          if (!canTrain(readiness, c.trainingUnlocked)) continue; // 逐欄信任閘 OR 手動解鎖（R4c）
          out.push({
            contactId: c.id,
            companyId: c.companyId,
            fullName: c.fullName,
            fullNameZh: c.fullNameZh,
            title: c.title ?? "",
            companyName: company.name,
            readiness,
            unlocked: c.trainingUnlocked === 1, // 手動解鎖／AI 補齊／虛擬人物 → client isReady 應 OR 此旗標
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
      if (!canTrain(readiness, contact.trainingUnlocked)) {
        throw new TrainError(
          "not_ready",
          "this contact has no verified persona fields — confirm/fill persona in CRM, or unlock it manually, before training",
        );
      }

      const company = await core.companies.findById(orgId, contact.companyId);
      const difficulty: TrainDifficulty = input.difficulty ?? "neutral";
      const mode: TrainMode = input.mode ?? "sales";
      // 手動解鎖／AI 補齊（trainingUnlocked=1）→ persona 放寬為所有非空欄（見 buildPersonaPrompt）；
      // objective 有值時注入「本次對練情境」段；mode 決定 persona 框架（AI 扮誰、立場）。純 verified 閘者維持 trusted-only。
      const systemInstruction = buildPersonaPrompt(contact, company, difficulty, trusted, {
        unlocked: contact.trainingUnlocked === 1,
        objective: input.objective,
        mode,
        lang: input.lang ?? "zh", // 對練語言（AI 回覆語言）：缺省＝繁中（決策 2026-07-24）
      });

      // 鑄 token（persona system prompt ＋依 contactId 穩定選定的嗓音一併鎖進 token；外呼有界）。
      // apiKey 缺 → minter 拋 → 對映 502。voiceName 由伺服器權威決定，client 不可竄改（維持 persona 鎖定模式）。
      let minted;
      try {
        minted = await minter.mint({
          model: liveModel,
          systemInstruction,
          voiceName: pickPersonaVoice(contact.id),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "could not mint Live token";
        if (/not configured/i.test(msg)) throw new TrainError("not_configured", msg);
        throw new TrainError("bad_request", msg);
      }

      const session = await core.training.createSession(orgId, {
        contactId: contact.id,
        dealId: input.dealId,
        difficulty,
        mode, // A3：落庫，finish 評分權威讀 session.mode（不信任 client）
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

    async draftPersona(orgId: string, contactId: string, userId?: string): Promise<PersonaDraftResult> {
      const contact = await core.contacts.findById(orgId, contactId);
      if (!contact) throw new TrainError("not_found", "contact not found");
      if (!gemini.isConfigured()) throw new TrainError("not_configured", "GEMINI_API_KEY not configured");

      const company = await core.companies.findById(orgId, contact.companyId);

      // 記帳（gemini_text）：有 meter 就現包 metered client；idemPrefix 帶 contactId＋randomUUID（跨請求唯一）。
      const genClient = meter
        ? meteredGeminiClient(gemini, meter, {
            orgId,
            kind: "gemini_text",
            userId,
            idemPrefix: `persona-draft:${contactId}:${randomUUID()}`,
          })
        : gemini;

      let fields: PersonaFieldDraft;
      try {
        fields = await draftPersonaForContact(genClient, { company, contact });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "persona draft failed";
        if (/not configured/i.test(msg)) throw new TrainError("not_configured", msg);
        throw new TrainError("bad_request", msg);
      }

      // 未驗證草稿：走**非人工**路徑（filled_by='llm'、verified=0、confidence≈0.5、source_type='ai_draft'）。
      // applyAiDraft 內部跳過已受信任欄、不 bump verified_status、值與 provenance 同一 tx（守 §11）。
      const patch = personaDraftToContactPatch(fields);
      if (Object.keys(patch).length > 0) {
        await core.contacts.applyAiDraft(orgId, contactId, patch, {
          confidence: 0.5,
          sourceType: "ai_draft",
          model: textModel,
        });
      }

      // 設 trainingUnlocked=1（純寫旗標）。trainingUnlocked 非 persona 欄，不影響逐欄信任閘。
      // 用 setTrainingUnlocked 而非 update()：後者走 applyHumanUpdate＋bumpVerified，會把真人 contact 的
      // verified_status 升 partial 並寫 human/verified provenance——AI 對真人的臆測不得抬高其可信徽章（契約 #1）。
      await core.contacts.setTrainingUnlocked(orgId, contactId, true);

      return { fields };
    },

    async createSynthetic(
      orgId: string,
      input: NewSyntheticPersona,
      userId?: string,
    ): Promise<CreateSyntheticResult> {
      const company = await core.companies.findById(orgId, input.companyId);
      if (!company) throw new TrainError("not_found", "company not found");

      // autoDesign（或 persona 省略）→ LLM 設計；否則用帶入的 persona。
      const autoDesign = input.autoDesign === true || input.persona === undefined;
      let fields: PersonaFieldDraft;
      let designedTitle: string | undefined;
      if (autoDesign) {
        if (!gemini.isConfigured()) throw new TrainError("not_configured", "GEMINI_API_KEY not configured");
        const genClient = meter
          ? meteredGeminiClient(gemini, meter, {
              orgId,
              kind: "gemini_text",
              userId,
              idemPrefix: `persona-synth:${input.companyId}:${randomUUID()}`,
            })
          : gemini;
        try {
          const designed = await designSyntheticPersona(genClient, {
            company,
            hints: { title: input.title, difficulty: input.difficulty, objective: input.objective },
          });
          fields = designed.fields;
          designedTitle = designed.title;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "persona design failed";
          if (/not configured/i.test(msg)) throw new TrainError("not_configured", msg);
          throw new TrainError("bad_request", msg);
        }
      } else {
        fields = input.persona ?? {};
      }

      const fullName = input.fullName?.trim() || "虛擬決策者";
      const title = input.title?.trim() || designedTitle;

      // is_synthetic=1 的 contact（沿用既有 create；NewContact 已含 isSynthetic，mappers 已對映 is_synthetic 欄）。
      const contact = await core.contacts.create(orgId, input.companyId, {
        fullName,
        ...(title ? { title } : {}),
        isSynthetic: 1,
      });

      // persona 九欄以 **human provenance** 寫入（虛擬角色由使用者創作、非臆測真人，標人工合法）＋trainingUnlocked=1，
      // 同一 human update tx（applyHumanUpdate：filled_by='human'、verified=1）。
      const patch = personaDraftToContactPatch(fields);
      await core.contacts.update(
        orgId,
        contact.id,
        { ...patch, trainingUnlocked: 1 },
        { userId: userId ?? "system" },
      );

      return { contactId: contact.id };
    },

    async saveTranscript(orgId: string, sessionId: string, turns: TrainTurn[]): Promise<void> {
      const session = await core.training.findSession(orgId, sessionId);
      if (!session) throw new TrainError("not_found", "training session not found");
      await core.training.saveTranscript(orgId, sessionId, turns);
    },

    async finish(
      orgId: string,
      sessionId: string,
      userId?: string,
      reportLang: ReportLang = "zh",
    ): Promise<{ reportId: string }> {
      const session = await core.training.findSession(orgId, sessionId);
      if (!session) throw new TrainError("not_found", "training session not found");

      await core.training.finishSession(orgId, sessionId);

      const turns = session.transcript ?? [];
      if (turns.length === 0) {
        throw new TrainError("bad_request", "no transcript to score — upload the transcript before finishing");
      }

      const contact = await core.contacts.findById(orgId, session.contactId);
      const company = contact ? await core.companies.findById(orgId, contact.companyId) : null;

      // 記帳（洞 D）：評分是一次 gemini_text 呼叫。有 meter 就現包 metered client 傳給 scorer（歸屬 orgId＋userId）。
      const scoreClient = meter
        ? meteredGeminiClient(gemini, meter, {
            orgId,
            kind: "gemini_text",
            userId,
            idemPrefix: `train-score:${sessionId}:${randomUUID()}`,
          })
        : undefined;

      let result;
      try {
        result = await scorer.score(
          turns,
          {
            personaName: contact?.fullName ?? "the counterpart",
            personaTitle: contact?.title ?? "",
            companyName: company?.name ?? "their company",
          },
          scoreClient,
          session.mode, // A3：評分維度由 server 權威用 session.mode 決定（不信任 client）
          reportLang, // 報告文字語言＝跟 app i18n locale（web finish 時帶當前 locale）
        );
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
