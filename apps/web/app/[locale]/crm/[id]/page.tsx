import { setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { CompanyDetailView } from "@/components/crm/CompanyDetailView";

/** /crm/[id] — 公司詳情（tabs：總覽/人物/產品深檔/新聞/技術棧/部門/商機/筆記）。 */
export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <CompanyDetailView companyId={id} />
    </AppShell>
  );
}
