import createNextIntlPlugin from "next-intl/plugin";

// next-intl request config lives at ./i18n/request.ts (plugin default path).
const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  // "@meetcopilot/shared" is a workspace TS-source package; Next must transpile it (not treat it as a prebuilt node_modules dep).
  transpilePackages: ["@meetcopilot/shared"],
  webpack: (config) => {
    // shared/src uses NodeNext `.js` extensions in its re-exports (export * from "./crm-types.js").
    // Next resolves @meetcopilot/shared to src/index.ts (via tsconfig paths, since dist/ is absent),
    // so webpack must map those `.js` specifiers onto the real `.ts` sources. Only bites once the web
    // app imports a RUNTIME value from shared (e.g. isTrusted); type-only imports are erased.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
