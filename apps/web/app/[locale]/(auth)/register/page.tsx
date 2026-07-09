import { setRequestLocale } from "next-intl/server";
import { AuthForm } from "@/components/auth/AuthForm";

/** /register — 建立帳號與組織（API_CONTRACT §1）。支援 ?next=（例：邀請流程回跳，P0-1）。 */
export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { locale } = await params;
  const { next } = await searchParams;
  setRequestLocale(locale);
  return <AuthForm mode="register" next={typeof next === "string" ? next : undefined} />;
}
