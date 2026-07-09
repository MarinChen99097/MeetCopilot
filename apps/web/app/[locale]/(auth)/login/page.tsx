import { setRequestLocale } from "next-intl/server";
import { AuthForm } from "@/components/auth/AuthForm";

/** /login — 最小登入頁（API_CONTRACT §1）。支援 ?next=（例：邀請流程回跳，P0-1）。 */
export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { locale } = await params;
  const { next } = await searchParams;
  setRequestLocale(locale);
  return <AuthForm mode="login" next={typeof next === "string" ? next : undefined} />;
}
