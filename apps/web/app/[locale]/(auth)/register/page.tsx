import { setRequestLocale } from "next-intl/server";
import { AuthForm } from "@/components/auth/AuthForm";

/** /register — 建立帳號與組織（API_CONTRACT §1）。 */
export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AuthForm mode="register" />;
}
