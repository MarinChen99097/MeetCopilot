"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { StartTrainSessionResult, TrainDifficulty, TrainTurn } from "@meetcopilot/shared";
import { TrainLiveClient, type LivePartials, type TrainCallState } from "@/lib/train/liveClient";

const STATE_LABEL: Record<TrainCallState, string> = {
  connecting: "連線中…",
  listening: "聆聽中",
  "ai-speaking": "對方說話中",
  "user-speaking": "你說話中",
  interrupted: "被打斷",
  reconnecting: "續連中…",
  ended: "對練已結束",
  error: "連線發生問題",
};

const DIFFICULTY_LABEL: Record<TrainDifficulty, string> = {
  friendly: "友善",
  neutral: "中性",
  hostile: "敵對",
};

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Caption extends TrainTurn {
  key: number;
}

/**
 * TrainCall — the "video call" practice screen. Owns a TrainLiveClient (browser↔Gemini Live direct),
 * renders the call state machine, dual live captions, timer, and seamless-resumption hint.
 * On hang-up it stops the client and hands the accumulated transcript up via `onEnd`.
 */
export function TrainCall({
  session,
  difficulty,
  onEnd,
}: {
  session: StartTrainSessionResult;
  difficulty: TrainDifficulty;
  onEnd: (turns: TrainTurn[]) => void;
}) {
  const [state, setState] = useState<TrainCallState>("connecting");
  const [partials, setPartials] = useState<LivePartials>({ rep: "", ai: "" });
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [resumedAt, setResumedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<TrainLiveClient | null>(null);
  const turnsRef = useRef<TrainTurn[]>([]);
  const keySeq = useRef(0);
  const captionsEnd = useRef<HTMLDivElement | null>(null);
  const endedRef = useRef(false);
  // Wall-clock anchors for the timer (F6): elapsed is derived from Date.now() - startedAt, never an
  // incrementing counter, so a state-keyed interval clearing/rearming can't drop ticks. Frozen at endedAt.
  const startedAtRef = useRef<number>(Date.now());
  const endedAtRef = useRef<number | null>(null);

  // Boot the live client once. Teardown on unmount is guaranteed (bounded socket, L13).
  useEffect(() => {
    const client = new TrainLiveClient(
      { ephemeralToken: session.live.ephemeralToken, model: session.live.model },
      {
        onState: setState,
        onPartial: setPartials,
        onTurn: (turn) => {
          turnsRef.current.push(turn);
          setCaptions((prev) => [...prev, { ...turn, key: ++keySeq.current }]);
        },
        onMicLevel: setMicLevel,
        onResumed: () => setResumedAt(Date.now()),
        onError: setError,
      },
    );
    clientRef.current = client;
    void client.start();
    return () => client.stop("ended");
  }, [session]);

  // Freeze the clock once the call ends (record the end instant exactly once).
  useEffect(() => {
    if ((state === "ended" || state === "error") && endedAtRef.current === null) {
      endedAtRef.current = Date.now();
      setElapsed(Math.floor((endedAtRef.current - startedAtRef.current) / 1000));
    }
  }, [state]);

  // Single wall-clock timer, independent of `state` (F6): recomputes elapsed from the start anchor each
  // tick, so oscillating states (listening↔user-speaking) can never drop a pending tick. Stops growing
  // once endedAtRef is set.
  useEffect(() => {
    const id = window.setInterval(() => {
      const end = endedAtRef.current ?? Date.now();
      setElapsed(Math.floor((end - startedAtRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Auto-scroll captions to the newest line.
  useEffect(() => {
    captionsEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [captions, partials]);

  // Clear the transient 「已續連」 hint after a moment.
  useEffect(() => {
    if (!resumedAt) return;
    const id = window.setTimeout(() => setResumedAt(0), 2600);
    return () => window.clearTimeout(id);
  }, [resumedAt]);

  function hangUp() {
    if (endedRef.current) return;
    endedRef.current = true;
    clientRef.current?.stop("ended");
    onEnd(turnsRef.current);
  }

  const isLive = state !== "ended" && state !== "error";
  const micBars = useMemo(() => Array.from({ length: 5 }, (_, i) => i), []);

  return (
    <section className="mc-call" aria-label="語音對練">
      <header className="mc-call__bar">
        <span className={`mc-call__status mc-call__status--${state}`}>
          <span className="mc-call__dot" aria-hidden="true" />
          {STATE_LABEL[state]}
        </span>
        <span className="mc-call__timer" role="timer" aria-label="對練時間">
          {fmtClock(elapsed)}
        </span>
        <span className="mc-badge mc-badge--muted">難度：{DIFFICULTY_LABEL[difficulty]}</span>
        {resumedAt ? <span className="mc-call__resumed" role="status">已續連</span> : null}
      </header>

      <div className="mc-call__stage">
        <div className={`mc-call__persona mc-call__persona--${state}`}>
          <div className="mc-call__avatar" aria-hidden="true">
            {session.persona.displayName.slice(0, 1)}
            <span className={`mc-call__ring${state === "ai-speaking" ? " is-active" : ""}`} />
          </div>
          <div className="mc-call__nameplate">
            <span className="mc-call__name">{session.persona.displayName}</span>
            <span className="mc-call__role">{session.persona.title}</span>
          </div>
          <div className={`mc-call__aiwave${state === "ai-speaking" ? " is-on" : ""}`} aria-hidden="true">
            {micBars.map((i) => (
              <span key={i} style={{ animationDelay: `${i * 0.12}s` }} />
            ))}
          </div>
        </div>

        <div className={`mc-call__you mc-call__you--${state === "user-speaking" ? "on" : "idle"}`}>
          <span className="mc-call__you-label">你</span>
          <div className="mc-call__miclevel" aria-hidden="true">
            {micBars.map((i) => (
              <span
                key={i}
                style={{ transform: `scaleY(${Math.max(0.15, Math.min(1, micLevel * (1 + i * 0.35)))})` }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mc-call__captions" role="log" aria-live="polite" aria-label="即時字幕">
        {captions.length === 0 && !partials.rep && !partials.ai ? (
          <p className="mc-call__caption-empty">
            {state === "connecting" ? "正在接通對方…" : "開始說話，對方會即時回應。"}
          </p>
        ) : null}
        {captions.map((c) => (
          <p key={c.key} className={`mc-caption mc-caption--${c.speaker}`}>
            <span className="mc-caption__who">{c.speaker === "ai" ? session.persona.displayName : "你"}</span>
            <span className="mc-caption__text">{c.text}</span>
          </p>
        ))}
        {partials.ai ? (
          <p className="mc-caption mc-caption--ai is-partial">
            <span className="mc-caption__who">{session.persona.displayName}</span>
            <span className="mc-caption__text">{partials.ai}</span>
          </p>
        ) : null}
        {partials.rep ? (
          <p className="mc-caption mc-caption--rep is-partial">
            <span className="mc-caption__who">你</span>
            <span className="mc-caption__text">{partials.rep}</span>
          </p>
        ) : null}
        <div ref={captionsEnd} />
      </div>

      {error ? (
        <div className="mc-call__error" role="alert">
          {error}
        </div>
      ) : null}

      <footer className="mc-call__foot">
        {isLive ? (
          <button type="button" className="mc-btn mc-btn--danger-solid mc-call__hangup" onClick={hangUp}>
            掛斷並查看評分
          </button>
        ) : (
          <button type="button" className="mc-btn mc-btn--primary mc-call__hangup" onClick={hangUp}>
            {error ? "結束並查看評分" : "查看評分報告"}
          </button>
        )}
      </footer>
    </section>
  );
}
