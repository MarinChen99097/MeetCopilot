/**
 * request-scoped 計費邊界（安全網用）。req.auth 存在時，把整個下游 handler（及其同步啟動的背景 job）包進
 * 一個計費脈絡（orgId/userId + 預設 kind gemini_text + meter）。於是任何**繞過 metered wrapper 的 raw AI 呼叫**
 * 都會被 gemini.ts 的安全網補記一筆 usage_event（019；對齊 ezpage SDK-boundary autolog）。
 *
 * 對既有已明確記帳的呼叫零影響：那些走 Metered 變體（不掛安全網）且在 meter.meter 內被抑制，故不會雙記。
 */
import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import type { Meter } from "./meter.js";
import { runWithMetering } from "./metering-context.js";

export function meteringBoundary(meter: Meter) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.auth;
    if (!auth) {
      next();
      return;
    }
    runWithMetering(
      { orgId: auth.orgId, userId: auth.userId, kind: "gemini_text", meter, idemPrefix: `req:${randomUUID()}` },
      () => next(),
    );
  };
}
