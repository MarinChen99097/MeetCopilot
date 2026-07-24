import { setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { CompanyDetailView } from "@/components/crm/CompanyDetailView";

/** /crm/[id] — 公司詳情（tabs：總覽/人物/產品深檔/新聞/技術棧/部門/商機/筆記）。 */
export default async function CompanyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  // 深連結（自 /train「補齊後可對練」）：?tab=contacts&contact=<id>。在 Server Component 讀，
  // 當 props 傳下去（免 useSearchParams＋Suspense 邊界）。
  searchParams: Promise<{ tab?: string; contact?: string }>;
}) {
  const { locale, id } = await params;
  const { tab, contact } = await searchParams;
  setRequestLocale(locale);
  return (
    <AppShell>
      <CompanyDetailView companyId={id} initialTab={tab} initialContactId={contact} />
    </AppShell>
  );
}
