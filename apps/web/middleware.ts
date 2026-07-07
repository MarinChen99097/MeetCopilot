import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Exclude api, Next internals, and files with an extension; everything else goes through the i18n locale router.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
