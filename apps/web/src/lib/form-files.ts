// File upload questions (migration 0042): the file-type groups an admin can allow, the
// limits, and the stored answer shape. Shared by the editor, the fill page and the server.

import type { FormQuestion } from "@/lib/database.types";

export const FORM_FILES_BUCKET = "form-files";

/** Google Forms' file-type groups. A file matches by MIME type or by extension (browsers
 * leave the type blank for some files). */
export const FILE_KINDS: { key: string; label: string; mimes: string[]; exts: string[] }[] = [
  { key: "document", label: "Document", mimes: ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml", "application/vnd.oasis.opendocument.text", "application/rtf", "text/plain"], exts: [".doc", ".docx", ".odt", ".rtf", ".txt"] },
  { key: "spreadsheet", label: "Spreadsheet", mimes: ["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml", "application/vnd.oasis.opendocument.spreadsheet", "text/csv"], exts: [".xls", ".xlsx", ".ods", ".csv"] },
  { key: "presentation", label: "Presentation", mimes: ["application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml", "application/vnd.oasis.opendocument.presentation"], exts: [".ppt", ".pptx", ".odp"] },
  { key: "pdf", label: "PDF", mimes: ["application/pdf"], exts: [".pdf"] },
  { key: "image", label: "Image", mimes: ["image/"], exts: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".heif", ".avif"] },
  { key: "video", label: "Video", mimes: ["video/"], exts: [".mp4", ".mov", ".webm", ".m4v"] },
  { key: "audio", label: "Audio", mimes: ["audio/"], exts: [".mp3", ".m4a", ".wav", ".ogg", ".aac"] },
];

/** Per-question limits the admin picks from. 50 MB is Supabase's free-plan file limit. */
export const MAX_FILES_LIMIT = 20;
export const MAX_MB_LIMIT = 50;
export const DEFAULT_MAX_FILES = 1;
export const DEFAULT_MAX_MB = 10;
/** Upload storage each team allows itself (images have their own 200 MB); demo sandboxes get a sliver. */
export const TEAM_FILES_CAP = 300 * 1024 * 1024;
export const DEMO_FILES_CAP = 5 * 1024 * 1024;

/** One uploaded file as stored in form_responses.answers. */
export type FileAnswer = { path: string; name: string; size: number; type: string };

export const maxFiles = (q: FormQuestion) => Math.min(MAX_FILES_LIMIT, Math.max(1, q.max_files ?? DEFAULT_MAX_FILES));
export const maxBytes = (q: FormQuestion) => Math.min(MAX_MB_LIMIT, Math.max(1, q.max_mb ?? DEFAULT_MAX_MB)) * 1024 * 1024;

/** Whether a file may be uploaded to a question allowing these kinds (none = anything). */
export function fileAllowed(kinds: string[] | undefined, mime: string, name: string): boolean {
  if (!kinds?.length) return true;
  const type = mime.toLowerCase();
  const ext = (name.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
  return FILE_KINDS.some((k) => kinds.includes(k.key) && (k.mimes.some((m) => type.startsWith(m)) || k.exts.includes(ext)));
}

/** The file picker's accept= value. */
export function acceptAttr(kinds: string[] | undefined): string | undefined {
  if (!kinds?.length) return undefined;
  return FILE_KINDS.filter((k) => kinds.includes(k.key)).flatMap((k) => [...k.mimes.map((m) => (m.endsWith("/") ? `${m}*` : m)), ...k.exts]).join(",");
}

/** The stored path's last part: letters, digits, dot, dash and underscore only. */
export const safeFileName = (name: string) =>
  name.normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/^[._]+/, "").slice(-80) || "file";

export const isFileAnswer = (a: unknown): a is FileAnswer[] =>
  Array.isArray(a) && a.every((f) => f && typeof f === "object" && typeof (f as FileAnswer).path === "string");

/** Where a signed-in viewer opens a file (admins of the team, or the uploader). */
export const fileHref = (path: string) => `/api/form-file?p=${encodeURIComponent(path)}`;

export const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
