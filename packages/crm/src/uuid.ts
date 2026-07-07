/**
 * UUIDv7 產生器（CRM_SCHEMA §0：主鍵 = UUIDv7，可時間排序）。
 * 前 48 bits = epoch-ms 大端時間戳 → row 依建立時間近似排序（利於索引/游標分頁）。
 * 用 Buffer 的 read/write 方法避免 noUncheckedIndexedAccess 對 typed-array 索引加上的 undefined。
 */
import { randomBytes } from "node:crypto";

export function uuidv7(): string {
  const bytes = randomBytes(16);
  // 48-bit big-endian 毫秒時間戳寫入 bytes[0..5]
  bytes.writeUIntBE(Date.now(), 0, 6);
  // version = 7（bytes[6] 高 nibble）
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x70, 6);
  // variant = RFC 4122（bytes[8] 高 2 bits = 10）
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
