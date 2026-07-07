import { setRequestLocale } from "next-intl/server";
import { AuthForm } from "@/components/auth/AuthForm";

/** /login — 最小登入頁（API_CONTRACT §1）。 */
export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AuthForm mode="login" />;
}
