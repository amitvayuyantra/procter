"use client";
import { useEffect, useRef, useState } from "react";
import { EVENT_LABELS, Level, WS } from "./api";
import { Feed, LiveEvent, newFeed, WatchFrame } from "./hud";

export const b64ToBitmap = (b64: string) =>
  createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/jpeg" }));

/** Adds a picture to the feed and works out how often pictures arrive, so the display can blend between them. */
export function pushFrame(feed: Feed, bitmap: ImageBitmap, data: WatchFrame, now: number) {
  if (feed.curr) feed.interval = Math.min(0.8, Math.max(0.15, feed.interval * 0.8 + (now - feed.curr.at) * 0.2));
  feed.prev?.bitmap.close();
  feed.prev = feed.curr;
  feed.curr = { bitmap, data, at: now };
}

export function announce(feed: Feed, events: LiveEvent[], now: number) {
  for (const e of events) if (e.points > 0) feed.toasts.push({ text: EVENT_LABELS[e.type] ?? e.type, points: e.points, at: now });
  feed.toasts = feed.toasts.filter((t) => now - t.at < 5).slice(-3);
}

/**
 * The interviewer's live connection to one interview.
 * `feed` holds the latest pictures for the canvas; the other values drive the side panels.
 */
export function useLiveFeed(sid: string, key: string) {
  const feed = useRef<Feed>(newFeed());
  const [conn, setConn] = useState<"connecting" | "open" | "closed">("connecting");
  const [online, setOnline] = useState(false);
  const [ended, setEnded] = useState(false);
  const [latest, setLatest] = useState<WatchFrame | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]); // newest first
  const [risk, setRisk] = useState<{ value: number; level: Level; history: number[] }>({ value: 0, level: "low", history: [] });

  useEffect(() => {
    if (!key) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;
    let ws: WebSocket;
    let chain: Promise<unknown> = Promise.resolve(); // keeps pictures in order while they decode

    const setPresence = (v: boolean) => { feed.current.online = v; setOnline(v); };
    const addRisk = (value: number, level: Level) =>
      setRisk((r) => ({ value, level, history: [...r.history, value].slice(-90) }));
    const addEvents = (list: LiveEvent[]) => {
      if (!list.length) return;
      setEvents((prev) => [...list.slice().reverse(), ...prev.filter((p) => !list.some((n) => n.id === p.id))].slice(0, 60));
      announce(feed.current, list, performance.now() / 1000);
    };

    const connect = () => {
      ws = new WebSocket(`${WS}/ws/watch/${sid}?key=${encodeURIComponent(key)}`);
      ws.onopen = () => setConn("open");
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.type === "hello" || msg.type === "presence") setPresence(msg.online);
        else if (msg.type === "ended") { feed.current.ended = true; setEnded(true); setPresence(false); }
        else if (msg.type === "events") { addEvents(msg.events); addRisk(msg.risk, msg.level); }
        else if (msg.type === "frame") {
          const { image, type: _t, ...data } = msg;
          chain = chain.then(() => b64ToBitmap(image)).then((bitmap) => {
            if (stopped) return bitmap.close();
            pushFrame(feed.current, bitmap, data as WatchFrame, performance.now() / 1000);
            setPresence(true);
            setLatest(data as WatchFrame);
            addRisk(data.risk, data.level);
            addEvents(data.events);
          }).catch(() => {});
        }
      };
      ws.onclose = () => {
        setConn("closed");
        if (!stopped) retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => { stopped = true; clearTimeout(retry); ws?.close(); };
  }, [sid, key]);

  return { feed, conn, online, ended, latest, events, risk, setEvents };
}
