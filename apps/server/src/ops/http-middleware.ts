/**
 * 生產中介層（M5_CONTRACT §C）：結構化 JSON log ＋ 安全標頭。
 *
 * requestLogger：每個請求一行 JSON {ts, requestId, orgId?, method, path, status, latencyMs}。
 *   **絕不 log** body／query string／祕鑰／JWT／PII／逐字稿——只記 method 與 **path（不含 query）**，
 *   orgId 取自已驗證的 req.auth（非機密識別碼；unauth 路由則省略）。requestId 掛在 req 上供下游關聯，
 *   並以 X-Request-Id 回給用戶端。log 在 res 'finish' 時輸出（此時 status/latency 已定）。
 *
 * securityHeaders：helmet 式最小集。HSTS 只在 prod（TLS 後）發，否則本機 http 會被瀏覽器強制升級成無法連的 https。
 */
import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** 每請求唯一關聯 id（requestLogger 指派）。 */
      requestId?: string;
    }
  }
}

export function requestLogger() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestId = randomUUID();
    req.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    const startNs = process.hrtime.bigint();

    res.on("finish", () => {
      const latencyMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      // 只放非機密欄位。path（req.path）不含 query string；orgId 是租戶識別碼非機密。
      const line: Record<string, unknown> = {
        ts: new Date().toISOString(),
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        latencyMs: Math.round(latencyMs * 10) / 10,
      };
      if (req.auth?.orgId) line.orgId = req.auth.orgId;
      // 結構化 log 走 stdout（容器收集）。此處是唯一的請求路徑 log；不含 body/secret/PII。
      console.log(JSON.stringify(line));
    });

    next();
  };
}

export interface SecurityHeadersOptions {
  /** true 才發 HSTS（僅在 TLS/prod 反代後）。 */
  hsts: boolean;
}

export function securityHeaders(opts: SecurityHeadersOptions) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    // API 只回 JSON/二進位下載，永不渲染 HTML → 最嚴 CSP，杜絕任何被當頁面載入時的資源抓取。
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    if (opts.hsts) {
      res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    }
    next();
  };
}
