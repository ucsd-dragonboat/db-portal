"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { zipSync } from "fflate";
import Icon from "@/components/icon";
import Dialog from "@/components/dialog";
import { uploadImage } from "@/lib/image-upload";
import type { ImageRef, TeamImage } from "@/lib/database.types";
import { deleteImages, moveLegacyImages } from "./actions";

type Sort = "newest" | "oldest" | "largest";
type Usage = "all" | "used" | "unused";

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fileName = (name: string) => name.split("/").pop() ?? name;
const typeOf = (i: TeamImage) => (i.mime?.split("/")[1] ?? fileName(i.name).split(".").pop() ?? "?").toLowerCase();

function refHref(r: ImageRef) {
  switch (r.kind) {
    case "announcement": return "/admin/announcements";
    case "event": return `/events/${r.id}`;
    case "form": return `/admin/forms/${r.id}`;
    case "response": return `/admin/forms/${r.form_id}/responses/${r.id}`;
  }
}
const refLabel = (r: ImageRef) => (r.kind === "response" ? `Answer in “${r.title}”` : `${r.kind[0].toUpperCase()}${r.kind.slice(1)}: ${r.title}`);

/** Admin Images panel: browse, filter, preview, upload, download (zip) and delete the team's images. */
export default function ImagesPanel({ images, base, cap }: { images: TeamImage[]; base: string; cap: number }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sort, setSort] = useState<Sort>("newest");
  const [type, setType] = useState("");
  const [uploader, setUploader] = useState("");
  const [usage, setUsage] = useState<Usage>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<TeamImage | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const url = (name: string) => `${base}/${name.split("/").map(encodeURIComponent).join("/")}`;
  const used = images.filter((i) => !i.legacy).reduce((s, i) => s + i.size, 0);
  const legacy = images.filter((i) => i.legacy);
  const types = [...new Set(images.map(typeOf))].sort();
  const uploaders = [...new Set(images.map((i) => i.uploader ?? "Unknown"))].sort();

  const shown = useMemo(() => {
    const list = images.filter((i) =>
      (!type || typeOf(i) === type)
      && (!uploader || (i.uploader ?? "Unknown") === uploader)
      && (usage === "all" || (usage === "used") === i.refs.length > 0));
    const t = (i: TeamImage) => new Date(i.created_at).getTime();
    return list.sort((a, b) => (sort === "largest" ? b.size - a.size : sort === "oldest" ? t(a) - t(b) : t(b) - t(a)));
  }, [images, type, uploader, usage, sort]);

  const toggle = (name: string) => setSelected((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const allShownSelected = shown.length > 0 && shown.every((i) => selected.has(i.name));
  const selectAll = () => setSelected(allShownSelected ? new Set() : new Set(shown.map((i) => i.name)));
  const picked = images.filter((i) => selected.has(i.name));

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ text: (e as Error).message, error: true }); }
    finally { setBusy(""); }
  };

  const remove = (list: TeamImage[]) => {
    if (!list.length) return;
    const inUse = list.filter((i) => i.refs.length).length;
    const ok = window.confirm(
      `Delete ${list.length} image${list.length === 1 ? "" : "s"}? This can't be undone.` +
      (inUse ? `\n\n${inUse} of them ${inUse === 1 ? "is" : "are"} still shown somewhere and will appear broken there.` : ""));
    if (!ok) return;
    void run("Deleting…", async () => {
      const res = await deleteImages(list.map((i) => i.name));
      if (res.error) throw new Error(res.error);
      setSelected(new Set()); setPreview(null);
      setMsg({ text: `Deleted ${list.length} image${list.length === 1 ? "" : "s"}.` });
      router.refresh();
    });
  };

  const download = (list: TeamImage[]) => void run("Zipping…", async () => {
    const files: Record<string, Uint8Array> = {};
    for (const i of list) {
      const res = await fetch(url(i.name));
      if (!res.ok) throw new Error(`Couldn’t download ${fileName(i.name)}.`);
      files[fileName(i.name)] = new Uint8Array(await res.arrayBuffer());
    }
    // Images are already compressed: store them as-is.
    const zip = zipSync(files, { level: 0 });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
    a.download = `team-images-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  });

  const upload = (files: FileList | null) => {
    const list = [...(files ?? [])];
    if (!list.length) return;
    void run("Uploading…", async () => {
      for (const f of list) await uploadImage(f);
      setMsg({ text: `Uploaded ${list.length} image${list.length === 1 ? "" : "s"}. Unused uploads are cleaned up after 3 days, so put them somewhere soon.` });
      router.refresh();
    });
  };

  const copy = (i: TeamImage) => void run("", async () => {
    await navigator.clipboard.writeText(url(i.name));
    setMsg({ text: "Link copied." });
  });

  const moveLegacy = () => void run("Moving…", async () => {
    const res = await moveLegacyImages();
    if (res.error) throw new Error(`Moved ${res.moved}, then: ${res.error}`);
    setMsg({ text: `Moved ${res.moved} image${res.moved === 1 ? "" : "s"} into the team folder. Links in your content were updated.` });
    router.refresh();
  });

  const pct = Math.min(100, (used / cap) * 100);
  const unused = images.filter((i) => !i.refs.length);

  return (
    <div className="space-y-4">
      <div className="card py-3 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[12rem]">
          <div className="text-sm">{fmtSize(used)} of {fmtSize(cap)} used · {images.length} image{images.length === 1 ? "" : "s"}</div>
          <div className="h-2 mt-1 rounded bg-slate-100"><div className="h-2 rounded" style={{ width: `${pct}%`, background: pct >= 90 ? "var(--g-red)" : pct >= 70 ? "var(--g-yellow)" : "var(--g-green)" }} /></div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        <button type="button" className="btn-purple" disabled={!!busy} onClick={() => fileRef.current?.click()}><Icon name="plus" /> Upload</button>
      </div>

      {legacy.length > 0 && (
        <div className="card py-3 text-sm flex flex-wrap items-center justify-between gap-2">
          <span>{legacy.length} image{legacy.length === 1 ? "" : "s"} from before team folders (marked <b>old</b>). Move them into this team&rsquo;s folder; links in your announcements, forms and events are updated.</span>
          <button type="button" className="btn-secondary" disabled={!!busy} onClick={moveLegacy}>Move into this team</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1"><input type="checkbox" checked={allShownSelected} onChange={selectAll} aria-label="Select all shown" /> Select all</label>
        <select className="input py-1 w-auto text-sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="largest">Largest</option>
        </select>
        <select className="input py-1 w-auto text-sm" value={usage} onChange={(e) => setUsage(e.target.value as Usage)} aria-label="Usage">
          <option value="all">Used and unused</option><option value="used">Used</option><option value="unused">Unused ({unused.length})</option>
        </select>
        <select className="input py-1 w-auto text-sm" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">All types</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="input py-1 w-auto text-sm" value={uploader} onChange={(e) => setUploader(e.target.value)} aria-label="Uploader">
          <option value="">Anyone</option>{uploaders.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        {unused.length > 0 && <button type="button" className="btn-danger-text ml-auto" disabled={!!busy} onClick={() => remove(unused)}>Delete all unused ({unused.length})</button>}
      </div>

      {(picked.length > 0 || busy || msg) && (
        <div className="sticky z-10 card py-2 flex flex-wrap items-center gap-3 text-sm" style={{ top: "env(safe-area-inset-top, 0px)" }}>
          {picked.length > 0 && (
            <>
              <b>{picked.length} selected</b> <span className="text-slate-400">{fmtSize(picked.reduce((s, i) => s + i.size, 0))}</span>
              <button type="button" className="btn-text" disabled={!!busy} onClick={() => download(picked)}>Download{picked.length > 1 ? " (zip)" : ""}</button>
              <button type="button" className="btn-danger-text" disabled={!!busy} onClick={() => remove(picked)}>Delete</button>
              <button type="button" className="btn-text" onClick={() => setSelected(new Set())}>Clear</button>
            </>
          )}
          {busy && <span className="text-slate-500">{busy}</span>}
          {msg && !busy && <span className={msg.error ? "text-red-600" : "text-green-700"}>{msg.text}</span>}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="card py-6 text-center text-sm text-slate-500">{images.length ? "No images match these filters." : "No images yet. Images you add to announcements, forms or events show up here."}</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {shown.map((i) => (
            <div key={i.name} className={`rounded-lg border bg-white overflow-hidden ${selected.has(i.name) ? "ring-2 ring-purple-500" : ""}`} style={{ borderColor: "var(--g-grey-300)" }}>
              <div className="relative">
                <button type="button" className="block w-full aspect-square bg-slate-50" onClick={() => setPreview(i)} title="Preview">
                  {/* eslint-disable-next-line @next/next/no-img-element -- our own public bucket */}
                  <img src={url(i.name)} alt="" loading="lazy" className="w-full h-full object-cover" />
                </button>
                <input type="checkbox" className="absolute top-2 left-2 h-4 w-4" checked={selected.has(i.name)} onChange={() => toggle(i.name)} aria-label={`Select ${fileName(i.name)}`} />
                {i.legacy && <span className="absolute top-2 right-2 rounded bg-black/60 px-1.5 text-[10px] text-white">old</span>}
              </div>
              <div className="px-2 py-1.5 text-xs space-y-0.5">
                <div className="flex justify-between gap-1"><span>{fmtSize(i.size)} · {typeOf(i)}</span><span className="text-slate-400">{new Date(i.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div>
                <div className={i.refs.length ? "text-green-700" : "text-amber-700"}>{i.refs.length ? `Used in ${i.refs.length}${i.refs.length >= 5 ? "+" : ""}` : "Unused"}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <Dialog title={fileName(preview.name)} onClose={() => setPreview(null)} maxW="max-w-3xl" top="pt-10">
          {/* eslint-disable-next-line @next/next/no-img-element -- our own public bucket */}
          <img src={url(preview.name)} alt="" className="max-h-[60vh] mx-auto rounded" />
          <div className="mt-3 text-sm space-y-1">
            <div className="text-slate-500">
              {fmtSize(preview.size)} · {typeOf(preview)} · uploaded {new Date(preview.created_at).toLocaleString()}{preview.uploader ? ` by ${preview.uploader}` : ""}
            </div>
            {preview.refs.length ? (
              <ul className="list-disc pl-5">
                {preview.refs.map((r) => <li key={`${r.kind}-${r.id}`}><Link href={refHref(r)} className="underline">{refLabel(r)}</Link></li>)}
              </ul>
            ) : (
              <div className="text-amber-700">Not used anywhere. It&rsquo;ll be deleted automatically 3 days after upload.</div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={() => copy(preview)}><Icon name="link" /> Copy link</button>
            <a className="btn-secondary" href={`${url(preview.name)}?download=${encodeURIComponent(fileName(preview.name))}`}>Download</a>
            <button type="button" className="btn-danger-text ml-auto" disabled={!!busy} onClick={() => remove([preview])}><Icon name="trash" /> Delete</button>
          </div>
          {msg && <div className={`mt-2 text-sm ${msg.error ? "text-red-600" : "text-green-700"}`}>{msg.text}</div>}
        </Dialog>
      )}
    </div>
  );
}
