"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 通用「就地文字編輯」原語（與 slide 領域無耦合，供 WYSIWYG 編輯器等重用）：
 * 點擊顯示文字 → 換原生 `textarea`（`font: inherit` 繼承外層字級 → 與顯示像素一致、auto-grow）；
 * 聚焦期間 uncontrolled（`defaultValue`），只在 **blur / Enter（單行）/ Cmd+Enter（多行）提交、Esc 取消**
 * → 根治 React×contentEditable 的游標重置；繁中 IME 掛 `onCompositionStart/End`，組字期間不提交。
 */
export function InlineText({
  value,
  onCommit,
  multiline,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const composing = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing || !ref.current) return;
    const el = ref.current;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
    autoGrow(el);
  }, [editing]);

  if (!editing) {
    return (
      <span
        className="mc-inline"
        role="textbox"
        tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
        title="點擊編輯"
      >
        {value || <span className="mc-inline__ph">{placeholder ?? "點擊編輯"}</span>}
      </span>
    );
  }

  const commit = () => {
    setEditing(false);
    const v = ref.current?.value ?? value;
    if (v !== value) onCommit(v);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false); // 取消：不提交（下一次重繪回到原值）
    } else if (
      e.key === "Enter" &&
      !composing.current &&
      !e.nativeEvent.isComposing && // 標準判斷：組字確認的 Enter（IME）不誤提交，含 composing ref 兜底
      (!multiline || e.metaKey || e.ctrlKey)
    ) {
      e.preventDefault();
      commit();
    }
  };

  return (
    <textarea
      ref={ref}
      className="mc-inline mc-inline--edit"
      defaultValue={value}
      placeholder={placeholder}
      rows={1}
      onBlur={commit}
      onKeyDown={onKeyDown}
      onInput={(e) => autoGrow(e.currentTarget)}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
    />
  );
}

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}
