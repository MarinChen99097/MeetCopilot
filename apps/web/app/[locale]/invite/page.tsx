import { setRequestLocale } from "next-intl/server";
import { InviteAcceptView } from "@/components/invite/InviteAcceptView";

/**
 * /invite?token=… — invite accept landing page (P0-1). The token is read from the query on the server
 * (so no client Suspense boundary is needed) and handed to the client view. Reachable while logged out.
 */
export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { locale } = await params;
  const { token } = await searchParams;
  setRequestLocale(locale);
  return <InviteAcceptView token={typeof token === "string" ? token : null} />;
}
