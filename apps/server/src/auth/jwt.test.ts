import { describe, it, expect } from "vitest";
import { issueToken, verifyToken } from "./jwt.js";

const SECRET = "test-secret-please-ignore-0123456789";

describe("jwt", () => {
  it("round-trips a valid payload", () => {
    const token = issueToken(SECRET, { userId: "u1", orgId: "o1", role: "owner" });
    const decoded = verifyToken(SECRET, token);
    expect(decoded).toMatchObject({ userId: "u1", orgId: "o1", role: "owner" });
  });

  it("rejects a token signed with a different secret", () => {
    const token = issueToken(SECRET, { userId: "u1", orgId: "o1", role: "member" });
    expect(() => verifyToken("another-secret-entirely-9876543210", token)).toThrow();
  });

  it("rejects a garbage token", () => {
    expect(() => verifyToken(SECRET, "not.a.jwt")).toThrow();
  });
});
