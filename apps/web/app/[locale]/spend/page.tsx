import { setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/AppShell";
import { SpendDashboard } from "@/components/spend/SpendDashboard";

/**
 * /spend — AI 花費 dashboard（本 org 用量；owner/admin 可見，nav.admin 群組）。
 * 資料走 org-scoped GET /api/org/usage(+events)；含稅＝稅前 × 1.25。
 */
export default async function SpendPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <SpendDashboard />
    </AppShell>
  );
}
