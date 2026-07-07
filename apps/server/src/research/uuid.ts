/**
 * UUIDv7 產生器（CRM_SCHEMA §0：主鍵 = UUIDv7，可時間排序）。
 * 與 packages/crm/src/uuid.ts 同實作——crawl_jobs 由研究引擎自持（見 jobs.ts），不引 crm 內部檔以免耦合。
 * 前 48 bits = epoch-ms 大端時間戳。用 Buffer read/write 避免 noUncheckedIndexedAccess 對 typed-array 索引的 undefined。
 */
import { randomBytes } from "node:crypto";

export function uuidv7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x70, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
