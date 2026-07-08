/** Auth module barrel. */
export { authRequired, issueToken, verifyToken } from "./jwt.js";
export type { AuthPayload } from "./jwt.js";
export { createAuthRouter } from "./routes.js";
export type { AuthRouterOptions, GoogleIdTokenVerifier, GoogleTokenPayload } from "./routes.js";
export { provisionUser, createUserWithOrg, personalOrgName } from "./provision.js";
export type { ProvisionResult } from "./provision.js";
