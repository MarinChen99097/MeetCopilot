import createNextIntlPlugin from "next-intl/plugin";

// next-intl request config lives at ./i18n/request.ts (plugin default path).
const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  // "@meetcopilot/shared" is a workspace TS-source package; Next must transpile it (not treat it as a prebuilt node_modules dep).
  transpilePackages: ["@meetcopilot/shared"],
};

export default withNextIntl(nextConfig);
