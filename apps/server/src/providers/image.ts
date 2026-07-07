/**
 * ImageProvider — pre-meeting AI image generation abstraction (ARCHITECTURE_PLAN §1/§3; API_CONTRACT §4).
 * Primary impl: OpenAI gpt-image-2 (background or full-slide). Gemini stays a future alt behind this seam.
 * ALWAYS pre-meeting (empirically ~80s; never in-meeting). NOT mounted on any route yet — that lands in M2.
 * Returns a data: URI (base64 png). Moderation refusals surface as an OpenAIImageRefusedError so the M2
 * route can respond `refused` and the client shows a fallback gradient (API_CONTRACT §4).
 */
import OpenAI from "openai";
import type { OpenAiImageConfig } from "../config.js";

export interface ImageGenerateOptions {
  prompt: string;
  kind: "background" | "full";
}

export interface ImageResult {
  dataUri: string;
}

export interface ImageProvider {
  generate(opts: ImageGenerateOptions): Promise<ImageResult>;
}

/** Thrown when OpenAI content moderation blocks the prompt/output (→ route responds `refused`). */
export class OpenAIImageRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIImageRefusedError";
  }
}

export class OpenAIImageProvider implements ImageProvider {
  private client: OpenAI | null = null;
  constructor(private readonly cfg: OpenAiImageConfig) {}

  private openai(): OpenAI {
    if (!this.cfg.apiKey) throw new Error("OPENAI_API_KEY not configured");
    if (!this.client) this.client = new OpenAI({ apiKey: this.cfg.apiKey });
    return this.client;
  }

  async generate(opts: ImageGenerateOptions): Promise<ImageResult> {
    const client = this.openai();
    try {
      const res = await client.images.generate({
        model: this.cfg.imageModel,
        prompt: opts.prompt,
        size: this.cfg.imageSize as never,
        quality: this.cfg.imageQuality as never,
        moderation: "auto" as never,
        n: 1,
      });
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) throw new Error("OpenAI image response missing b64_json");
      return { dataUri: `data:image/png;base64,${b64}` };
    } catch (err) {
      const message = String((err as Error)?.message ?? "");
      // OpenAI signals moderation blocks via a moderation_blocked / content_policy error code.
      if (/moderation|content[_ ]?policy|safety/i.test(message)) {
        throw new OpenAIImageRefusedError(message);
      }
      throw err;
    }
  }
}
