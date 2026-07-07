import { setRequestLocale } from "next-intl/server";
import { PresentStage } from "@/components/present/PresentStage";
import "../../studio-present.css";

/**
 * /present — 報告者（帳號 A）分享進 Meet 的簡報播放視圖。乾淨舞台：只有投影片 + 頁碼（I3）。
 *
 * 不掛 AppShell（無 topbar/HUD chrome）——本頁會被分享給客戶，必須繼承零副駕 UI（I3，見 layout.tsx 註解）。
 * query：`?deckId=` 載入 deck；可選 `?meetingId=&token=` 開 present-role WS（page_commit / deck_update）。
 * 憑證由 M3 的 POST /api/meetings 產出並帶進本頁的網址；本頁只消費、不建立 session。
 */
export default async function PresentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;

  const pick = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;

  return <PresentStage deckId={pick(sp.deckId)} meetingId={pick(sp.meetingId)} token={pick(sp.token)} />;
}
