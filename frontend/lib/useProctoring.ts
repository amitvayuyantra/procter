"use client";
import { RefObject, useCallback, useEffect, useRef, useState } from "react";
import { EVENT_LABELS, WS } from "./api";

/** All the candidate's browser is told: enough for friendly hints. No AI vision data, no scores. */
export type Status = {
  flags: string[]; calibrated: boolean;
  challenge: "waiting" | "active" | "passed" | "failed"; challengeFirst: "left" | "right"; challengeProgress: number;
};
const EMPTY: Status = { flags: [], calibrated: false, challenge: "waiting", challengeFirst: "left", challengeProgress: 0 };

const FRAME_EVERY_MS = 330; // about 3 pictures per second: smooth enough for the camera animation, light on the server

/**
 * Watches the candidate while `active` is true:
 *  - sends a webcam picture to the Python AI twice a second
 *  - reports tab switches, leaving full screen, copy/paste, right-click
 * Returns the AI's latest verdict plus a list of warnings to show the candidate.
 */
export function useProctoring(sessionId: string, videoRef: RefObject<HTMLVideoElement | null>, active: boolean) {
  const [status, setStatus] = useState<Status>(EMPTY);
  const [connected, setConnected] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const sendEvent = useCallback((event: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event }));
  }, []);

  // 1. Connection + camera frames
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let waiting = false; // wait for the AI's answer before sending the next picture
    let timer: ReturnType<typeof setInterval>;
    let retry: ReturnType<typeof setTimeout>;
    const canvas = document.createElement("canvas");
    canvas.width = 640; // a bit larger: the interviewer watches this picture live
    canvas.height = 480;

    const connect = () => {
      const ws = new WebSocket(`${WS}/ws/sessions/${sessionId}`);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onmessage = (m) => {
        waiting = false;
        const d = JSON.parse(m.data);
        setStatus({
          flags: d.flags, calibrated: d.calibrated,
          challenge: d.challenge, challengeFirst: d.challenge_first, challengeProgress: d.challenge_progress,
        });
        const concern = d.new_events?.find((e: { points: number }) => e.points > 0); // not the ID photo
        if (concern) {
          setWarning(EVENT_LABELS[concern.type] ?? "Unusual activity");
          setTimeout(() => setWarning(null), 6000);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        waiting = false;
        if (!stopped) retry = setTimeout(connect, 2000);
      };
    };
    connect();

    timer = setInterval(() => {
      const ws = wsRef.current;
      const video = videoRef.current;
      if (waiting || !video || video.readyState < 2 || ws?.readyState !== WebSocket.OPEN) return;
      canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
      waiting = true;
      canvas.toBlob((blob) => (blob ? ws.send(blob) : (waiting = false)), "image/jpeg", 0.7);
    }, FRAME_EVERY_MS);

    return () => {
      stopped = true;
      clearInterval(timer);
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [active, sessionId, videoRef]);

  // 2. Browser behaviour
  useEffect(() => {
    if (!active) return;
    const on = <K extends keyof DocumentEventMap>(t: K, fn: (e: DocumentEventMap[K]) => void) => {
      document.addEventListener(t, fn as EventListener);
      return () => document.removeEventListener(t, fn as EventListener);
    };
    const cleanups = [
      on("visibilitychange", () => document.hidden && sendEvent("tab_hidden")),
      on("fullscreenchange", () => !document.fullscreenElement && sendEvent("fullscreen_exit")),
      on("copy", (e) => (e.preventDefault(), sendEvent("copy_paste"))),
      on("cut", (e) => (e.preventDefault(), sendEvent("copy_paste"))),
      on("paste", (e) => (e.preventDefault(), sendEvent("copy_paste"))),
      on("contextmenu", (e) => (e.preventDefault(), sendEvent("right_click"))),
    ];
    // Clicking another window: only report if it was not just a tab switch (already reported above)
    const onBlur = () => setTimeout(() => !document.hidden && sendEvent("window_blur"), 300);
    window.addEventListener("blur", onBlur);
    return () => {
      cleanups.forEach((c) => c());
      window.removeEventListener("blur", onBlur);
    };
  }, [active, sendEvent]);

  return { status, connected, warning };
}
