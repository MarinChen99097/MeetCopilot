/**
 * LiveTokenMinter — 伺服器端鑄造 Gemini Live ephemeral token（M4；API_FINDINGS §A3、S3 spike 驗證）。
 *
 * 為何在伺服器鑄 token：讓瀏覽器**直連** Gemini Live（語音不經我方 server，延遲最小），又不外洩主 GEMINI_API_KEY——
 * 前端拿 `token.name` 當 apiKey 連線。
 *
 * **S3 spike 用到的確切 SDK 呼叫（已對 @google/genai v2.10.0 實測）：**
 *  - runtime property 是 `ai.authTokens.create`（SDK docstring 的 `ai.tokens.create` 是 STALE）。
 *  - `authTokens.create` 與 token-based `live.connect` 都**必須** `httpOptions:{ apiVersion:'v1alpha' }`，否則鑄造失敗。
 *  - config 欄位：`uses`、`expireTime`（token 有效期，≤20h）、`newSessionExpireTime`（開 session 的視窗）。
 *
 * **信任閘的牙**：persona system prompt 用 `liveConnectConstraints` 鎖進 token（client 不可竄改 persona/model/轉寫），
 * 故 StartTrainSessionResult 不需回傳 systemInstruction——persona 由伺服器權威決定。
 *
 * 外呼有界（L13）：create 呼叫掛 AbortSignal + deadline，逾時強制中止，不 hang。
 */
import { GoogleGenAI, Modality } from "@google/genai";

export interface MintOptions {
  /** Live 模型 id（鎖進 token 的 model）。 */
  model: string;
  /** persona 扮演 system prompt（鎖進 token；client 不可改）。 */
  systemInstruction: string;
  /**
   * persona 嗓音（prebuilt voiceName，如 "Kore"）。有值時鎖進 token 的 `speechConfig`——與 systemInstruction 同屬
   * 伺服器權威、client 不可竄改。省略＝用模型預設嗓音。 */
  voiceName?: string;
  /** token 有效期（預設 30 分鐘；≤20h）。 */
  tokenTtlMs?: number;
  /** 開 session 的視窗（預設 2 分鐘）——前端須在此期間內開啟 Live 連線。 */
  sessionOpenWindowMs?: number;
  /** 鑄造外呼 deadline（預設 15s）。 */
  deadlineMs?: number;
}

export interface MintedToken {
  token: string;
  model: string;
  expireTime: number; // epoch ms
}

export interface LiveTokenMinter {
  mint(opts: MintOptions): Promise<MintedToken>;
}

const DEFAULT_TOKEN_TTL_MS = 30 * 60_000;
const DEFAULT_SESSION_OPEN_WINDOW_MS = 2 * 60_000;
const DEFAULT_DEADLINE_MS = 15_000;

/**
 * 真正的鑄造器（用 @google/genai v1alpha）。apiKey 缺 → mint 時拋錯（route 對映 502）。
 * 每次 mint 建一個 v1alpha client（authTokens 僅 v1alpha 支援；與一般 textModel client 分開，避免污染 apiVersion）。
 */
export function createLiveTokenMinter(apiKey: string): LiveTokenMinter {
  let cached: GoogleGenAI | null = null;
  const client = (): GoogleGenAI => {
    if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
    if (!cached) cached = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
    return cached;
  };

  return {
    async mint(opts: MintOptions): Promise<MintedToken> {
      const ai = client();
      const now = Date.now();
      const expireTime = now + (opts.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS);
      const newSessionExpireTime = now + (opts.sessionOpenWindowMs ?? DEFAULT_SESSION_OPEN_WINDOW_MS);

      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), opts.deadlineMs ?? DEFAULT_DEADLINE_MS);
      try {
        const res = await ai.authTokens.create({
          config: {
            uses: 1,
            expireTime: new Date(expireTime).toISOString(),
            newSessionExpireTime: new Date(newSessionExpireTime).toISOString(),
            abortSignal: ac.signal,
            // 把 persona + 模態 + 轉寫鎖進 token（client 竄改被忽略）。lockAdditionalFields:[] = 只鎖這些欄位，
            // 其餘（sessionResumption/contextWindowCompression 供 >15 分鐘續連）留給前端連線時自帶。
            liveConnectConstraints: {
              model: opts.model,
              config: {
                responseModalities: [Modality.AUDIO],
                systemInstruction: opts.systemInstruction,
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                // persona 嗓音鎖進 token（有值才設）：client 連線時即使自帶 speechConfig 也被 constraints 覆蓋，
                // 故同一 persona 嗓音穩定、且不可被前端竄改（與 systemInstruction 同一信任模式）。
                ...(opts.voiceName
                  ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voiceName } } } }
                  : {}),
              },
            },
            lockAdditionalFields: [],
          },
        });
        const token = res.name;
        if (!token) throw new Error("Gemini authTokens.create returned no token name");
        return { token, model: opts.model, expireTime };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
