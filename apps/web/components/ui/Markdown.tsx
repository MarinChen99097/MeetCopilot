"use client";

import ReactMarkdown, { type Components } from "react-markdown";

/**
 * 共用 markdown 渲染（MeetCopilot 情報卡/深查卡、CRM 筆記等共用；抽自 NotesTab 的原設定）。
 *
 * 安全模型（與 NotesTab 一致，不得放寬）：
 * - 不裝 rehype-raw → body 內原始 HTML 天然被跳脫，不會執行（XSS 縱深第一道）。
 * - 連結 scheme 白名單（第二道）：只放行絕對 http/https 與 mailto；其餘（javascript:/data:/相對/fragment）
 *   回 undefined → react-markdown 不掛 href。
 * - <a> 一律新分頁開啟並帶 noopener/noreferrer。
 * 註：數學 $...$ 目前不渲染（repo 未裝 remark-math/rehype-katex），會以字面顯示。
 */
function mdUrlTransform(url: string): string | undefined {
  const u = (url ?? "").trim();
  if (u.length === 0) return undefined;
  if (/^https?:\/\//i.test(u)) return u;
  if (/^mailto:/i.test(u)) return u;
  return undefined;
}

const MC_MD_COMPONENTS: Components = {
  a({ href, children, node: _node, ...rest }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  },
};

/**
 * 把 markdown 字串渲染進一層 `.mc-md`（typography 樣式在 globals.css :873+）。
 * `className` 會併到 `.mc-md` 同一個 div 上（供呼叫端疊加既有容器樣式，如 mc-infocard__body）。
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className ? `mc-md ${className}` : "mc-md"}>
      <ReactMarkdown urlTransform={mdUrlTransform} components={MC_MD_COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
