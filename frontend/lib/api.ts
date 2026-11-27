export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const WS = API.replace(/^http/, "ws");

export type Level = "low" | "medium" | "high";
export type Status = "invited" | "in_progress" | "completed";
export type Verdict = "cleared" | "follow_up" | "confirmed_issue";

export type Interview = {
  candidate_name: string; position: string; status: Status; title: string;
  duration_minutes: number; seconds_left: number | null;
  questions: { id: number; text: string }[];
};
export type ProctorEvent = { id: number; type: string; points: number; detail: string; evidence: string | null; created_at: number };
export type SessionRow = {
  id: string; candidate_name: string; candidate_email: string; position: string;
  status: Status; verdict: Verdict | null; risk: number; level: Level; event_count: number; created_at: number;
};
export type SessionDetail = SessionRow & {
  title: string; notes: string | null; events: ProctorEvent[]; qa: { question: string; answer: string }[];
};

export const EVENT_LABELS: Record<string, string> = {
  identity_check: "Start-of-interview photo (check identity)",
  no_face: "Face not visible",
  multiple_faces: "More than one person",
  looking_away: "Looking away from screen",
  phone_detected: "Phone detected",
  book_detected: "Book detected",
  laptop_detected: "Another laptop detected",
  tab_hidden: "Switched tab / minimised",
  window_blur: "Left the interview window",
  fullscreen_exit: "Exited full screen",
  copy_paste: "Copy / paste attempt",
  right_click: "Right-click",
};

export const VERDICT_LABELS: Record<Verdict, string> = {
  cleared: "Cleared – no real concern",
  follow_up: "Needs follow-up with candidate",
  confirmed_issue: "Concern confirmed",
};

export const STATUS_LABELS: Record<Status, string> = { invited: "Invited", in_progress: "In progress", completed: "Completed" };

export async function adminFetch<T>(path: string, key: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "x-admin-key": key, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(res.status === 401 ? "Wrong admin key" : `Error ${res.status}`);
  return res.json();
}
