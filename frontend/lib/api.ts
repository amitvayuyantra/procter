export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const WS = API.replace(/^http/, "ws");

export type Question = { id: number; text: string; options: string[] };
export type Exam = { id: string; title: string; duration_minutes: number; questions: Question[] };
export type Level = "low" | "medium" | "high";
export type ProctorEvent = { id: number; type: string; points: number; detail: string; evidence: string | null; created_at: number };
export type SessionRow = {
  id: string; student_name: string; student_email: string; started_at: number;
  finished_at: number | null; score: number | null; total: number | null;
  risk: number; level: Level; event_count?: number;
};
export type SessionDetail = SessionRow & { events: ProctorEvent[] };

export const EVENT_LABELS: Record<string, string> = {
  no_face: "Face not visible",
  multiple_faces: "More than one person",
  looking_away: "Looking away from screen",
  phone_detected: "Phone detected",
  book_detected: "Book detected",
  laptop_detected: "Another laptop detected",
  tab_hidden: "Switched tab / minimised",
  window_blur: "Left the exam window",
  fullscreen_exit: "Exited full screen",
  copy_paste: "Copy / paste attempt",
  right_click: "Right-click",
};

export async function adminFetch<T>(path: string, key: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { "x-admin-key": key }, cache: "no-store" });
  if (!res.ok) throw new Error(res.status === 401 ? "Wrong admin key" : `Error ${res.status}`);
  return res.json();
}
