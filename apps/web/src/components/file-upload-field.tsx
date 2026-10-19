"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { startFormUpload } from "@/app/(app)/forms/[id]/upload-actions";
import type { FormQuestion } from "@/lib/database.types";
import { FILE_KINDS, FORM_FILES_BUCKET, acceptAttr, fileAllowed, fileHref, fmtSize, maxBytes, maxFiles, type FileAnswer } from "@/lib/form-files";
import Icon from "@/components/icon";

/** A File upload question's answer: files go straight to private storage through a
 * one-time signed URL; the hidden input carries the uploaded list (JSON) to the submit.
 * It's empty with no files, so the fill page's required check sees "no answer". */
export default function FileUploadField({ formId, q, initial, canOpen }: { formId: string; q: FormQuestion; initial: FileAnswer[]; canOpen: boolean }) {
  const [files, setFiles] = useState<FileAnswer[]>(initial);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const saved = new Set(initial.map((f) => f.path)); // a new upload opens only once it's submitted
  const limit = maxFiles(q);

  const upload = async (picked: File[]) => {
    setError(null);
    const room = limit - files.length;
    if (picked.length > room) setError(`Only ${limit} file${limit === 1 ? "" : "s"} allowed — the first ${room} ${room === 1 ? "was" : "were"} added.`);
    const join = (picker.current?.form?.elements.namedItem("join") as HTMLInputElement | null)?.value;
    for (const file of picked.slice(0, Math.max(0, room))) {
      if (file.size > maxBytes(q)) { setError(`“${file.name}” is over ${maxBytes(q) / 1048576} MB.`); continue; }
      if (!fileAllowed(q.file_kinds, file.type, file.name)) { setError(`“${file.name}” isn’t an allowed file type.`); continue; }
      setBusy((n) => n + 1);
      try {
        const t = await startFormUpload({ formId, questionId: q.id, name: file.name, size: file.size, type: file.type, join });
        if ("error" in t) { setError(t.error); continue; }
        const { error: upErr } = await createClient().storage.from(FORM_FILES_BUCKET).uploadToSignedUrl(t.path, t.token, file, { contentType: file.type || undefined });
        if (upErr) { setError(`Couldn’t upload “${file.name}”: ${upErr.message}`); continue; }
        setFiles((fs) => [...fs, { path: t.path, name: file.name, size: file.size, type: file.type }]);
      } catch {
        setError(`Couldn’t upload “${file.name}” — check your connection and try again.`);
      } finally {
        setBusy((n) => n - 1);
      }
    }
  };

  const kinds = FILE_KINDS.filter((k) => q.file_kinds?.includes(k.key)).map((k) => k.label);
  return (
    <div className="space-y-2">
      <input type="hidden" name={`q_${q.id}`} value={files.length ? JSON.stringify(files) : ""} />
      {files.map((f) => (
        <div key={f.path} className="flex items-center gap-2 rounded border px-3 py-1.5 text-sm" style={{ borderColor: "var(--g-grey-300)" }}>
          <Icon name="file" />
          {canOpen && saved.has(f.path) ? <a href={fileHref(f.path)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate underline">{f.name}</a> : <span className="min-w-0 flex-1 truncate">{f.name}</span>}
          <span className="text-xs" style={{ color: "var(--g-grey-600)" }}>{fmtSize(f.size)}</span>
          <button type="button" onClick={() => setFiles((fs) => fs.filter((x) => x.path !== f.path))} className="px-1" style={{ color: "var(--g-grey-600)" }} aria-label={`Remove ${f.name}`}>✕</button>
        </div>
      ))}
      <input ref={picker} type="file" multiple={limit - files.length > 1} accept={acceptAttr(q.file_kinds)} className="hidden"
        onChange={(e) => { const picked = [...(e.target.files ?? [])]; e.target.value = ""; void upload(picked); }} />
      {files.length < limit && (
        <button type="button" onClick={() => picker.current?.click()} disabled={busy > 0} className="btn-secondary text-sm disabled:opacity-50">
          {busy > 0 ? "Uploading…" : <><Icon name="plus" /> Add file</>}
        </button>
      )}
      <p className="text-xs" style={{ color: "var(--g-grey-600)" }}>
        Up to {limit} file{limit === 1 ? "" : "s"}, {maxBytes(q) / 1048576} MB each{kinds.length ? ` · ${kinds.join(", ")}` : ""}. Only team admins can see your files.
      </p>
      {error && <p className="text-xs" style={{ color: "var(--g-red)" }}>{error}</p>}
    </div>
  );
}
