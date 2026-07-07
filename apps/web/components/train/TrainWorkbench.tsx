"use client";

import { useCallback, useRef, useState } from "react";
import type { PersonaOption, StartTrainSessionResult, TrainDifficulty, TrainReport, TrainTurn } from "@meetcopilot/shared";
import {
  ApiError,
  finishTrainSession,
  getTrainReport,
  saveTrainTranscript,
  startTrainSession,
} from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { PersonaPicker } from "./PersonaPicker";
import { TrainCall } from "./TrainCall";
import { ScoreReport } from "./ScoreReport";

type Phase = "picking" | "calling" | "report";

/**
 * TrainWorkbench — /train orchestrator (PROMPT 6). Drives the surface's phase machine:
 * persona pick → live voice call (browser↔Gemini Live direct) → four-dimension score report.
 * Owns the REST calls (start / saveTranscript / finish / getReport); child components are presentational.
 */
export function TrainWorkbench() {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>("picking");
  const [starting, setStarting] = useState(false);

  const [session, setSession] = useState<StartTrainSessionResult | null>(null);
  const [difficulty, setDifficulty] = useState<TrainDifficulty>("neutral");
  const [personaName, setPersonaName] = useState("");

  const [report, setReport] = useState<TrainReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const transcriptRef = useRef<TrainTurn[]>([]);
  const reportIdRef = useRef<string | null>(null);

  const onStart = useCallback(
    (persona: PersonaOption, diff: TrainDifficulty) => {
      setStarting(true);
      startTrainSession({ contactId: persona.contactId, difficulty: diff })
        .then((res) => {
          setSession(res);
          setDifficulty(diff);
          setPersonaName(res.persona.displayName || persona.fullName);
          setPhase("calling");
        })
        .catch((e) => {
          toast.push({ kind: "error", message: e instanceof ApiError ? e.message : "建立對練失敗" });
        })
        .finally(() => setStarting(false));
    },
    [toast],
  );

  // Turn the reportId into a report (retry-safe: reuse a minted reportId instead of re-finishing).
  const loadReport = useCallback(async (sessionId: string, turns: TrainTurn[]) => {
    setReportLoading(true);
    setReportError(null);
    try {
      if (turns.length > 0) {
        try {
          await saveTrainTranscript(sessionId, turns);
        } catch {
          /* transcript best-effort; scoring can still proceed */
        }
      }
      if (!reportIdRef.current) {
        const { reportId } = await finishTrainSession(sessionId);
        reportIdRef.current = reportId;
      }
      setReport(await getTrainReport(reportIdRef.current));
    } catch (e) {
      setReportError(e instanceof ApiError ? e.message : "評分產生失敗");
    } finally {
      setReportLoading(false);
    }
  }, []);

  const onEnd = useCallback(
    (turns: TrainTurn[]) => {
      transcriptRef.current = turns;
      reportIdRef.current = null;
      setReport(null);
      setPhase("report");
      if (session) void loadReport(session.sessionId, turns);
    },
    [session, loadReport],
  );

  const onRestart = useCallback(() => {
    setSession(null);
    setReport(null);
    setReportError(null);
    reportIdRef.current = null;
    transcriptRef.current = [];
    setPhase("picking");
  }, []);

  if (phase === "picking") {
    return <PersonaPicker onStart={onStart} starting={starting} />;
  }
  if (phase === "calling" && session) {
    return <TrainCall session={session} difficulty={difficulty} onEnd={onEnd} />;
  }
  return (
    <ScoreReport
      report={report}
      loading={reportLoading}
      error={reportError}
      onRetry={() => session && loadReport(session.sessionId, transcriptRef.current)}
      onRestart={onRestart}
      transcript={transcriptRef.current}
      personaName={personaName}
    />
  );
}
