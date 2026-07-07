import { setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { CompanyListView } from "@/components/crm/CompanyListView";

/** /crm — CRM 核心（決策 20：成品，非佔位）。公司清單 → 詳情。 */
export default async function CrmPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <CompanyListView />
    </AppShell>
  );
}
