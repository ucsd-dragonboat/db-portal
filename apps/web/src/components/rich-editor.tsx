"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import Icon from "@/components/icon";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { useEffect, useRef, useState } from "react";
import { uploadImage } from "@/lib/image-upload";

/**
 * Image with a Google Forms-style resize handle: click the image, drag the corner dot.
 * The chosen width is stored as the img's width attribute (px), so member views respect it
 * while `.rich img { max-width: 100% }` keeps it responsive.
 */
const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("width"),
        renderHTML: (attrs: { width?: string | number | null }) => (attrs.width ? { width: attrs.width } : {}),
      },
    };
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const container = document.createElement("div");
      container.style.cssText = "position:relative;display:inline-block;max-width:100%;line-height:0";
      const img = document.createElement("img");
      const apply = () => {
        img.src = current.attrs.src;
        if (current.attrs.alt) img.alt = current.attrs.alt;
        img.style.width = current.attrs.width ? `${current.attrs.width}px` : "";
      };
      apply();
      const handle = document.createElement("span");
      handle.style.cssText = "position:absolute;right:-7px;bottom:-7px;width:14px;height:14px;border-radius:50%;background:var(--g-blue);border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);cursor:nwse-resize;display:none;touch-action:none";
      container.append(img, handle);

      let startX = 0, startW = 0;
      const onMove = (e: PointerEvent) => {
        const max = container.parentElement?.clientWidth ?? 800;
        img.style.width = `${Math.max(60, Math.min(startW + (e.clientX - startX), max))}px`;
      };
      const onUp = (e: PointerEvent) => {
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener("pointermove", onMove);
        const width = Math.round(img.getBoundingClientRect().width);
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos != null) editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, width }));
      };
      img.addEventListener("dblclick", () => {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos != null) container.dispatchEvent(new CustomEvent("image-crop-request", { bubbles: true, detail: { src: current.attrs.src, pos } }));
      });
      handle.addEventListener("pointerdown", (e) => {
        e.preventDefault(); e.stopPropagation();
        startX = e.clientX; startW = img.getBoundingClientRect().width;
        handle.setPointerCapture(e.pointerId);
        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", onUp, { once: true });
      });

      return {
        dom: container,
        selectNode: () => { container.classList.add("ProseMirror-selectednode"); handle.style.display = "block"; },
        deselectNode: () => { container.classList.remove("ProseMirror-selectednode"); handle.style.display = "none"; },
        update: (n) => { if (n.type.name !== current.type.name) return false; current = n; apply(); return true; },
      };
    };
  },
});

/**
 * Small WYSIWYG editor (Tiptap). Emits HTML. Pasting from Google Docs keeps bold/underline/lists/links.
 * Images are uploaded to our own storage (external hotlinks expire); paste/drop of image files works too.
 * Value is uncontrolled after mount except when `value` is reset to "" (form reset).
 */
export default function RichEditor({ value, onChange, placeholder, minRows = 6, className = "" }: {
  value: string; onChange: (html: string) => void; placeholder?: string; minRows?: number; className?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(false);
  const [crop, setCrop] = useState<{ src: string; pos: number } | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, autolink: true, defaultProtocol: "https" } }), ResizableImage.configure({ inline: false, allowBase64: false })],
    content: value,
    editorProps: {
      attributes: { class: "rich focus:outline-none px-3 py-2 text-sm", style: `min-height:${minRows * 1.5}rem` },
      // Pasting or dropping an image file uploads it instead of embedding a dying blob/hotlink.
      handlePaste: (_view, e) => insertFiles(e.clipboardData?.files),
      handleDrop: (_view, e) => insertFiles((e as DragEvent).dataTransfer?.files),
    },
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? "" : editor.getHTML()),
  });

  const insertFiles = (files?: FileList | null): boolean => {
    const imgs = [...(files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return false;
    setUploading(true);
    Promise.all(imgs.map(uploadImage))
      .then((urls) => urls.forEach((src) => editor?.chain().focus().setImage({ src }).run()))
      .catch((err: Error) => window.alert(err.message))
      .finally(() => setUploading(false));
    return true;
  };

  // allow parent to clear (e.g. after successful post)
  useEffect(() => { if (editor && value === "" && !editor.isEmpty) editor.commands.clearContent(); }, [value, editor]);

  // Double-clicking an image (see ResizableImage) bubbles a crop request up to here.
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const h = (e: Event) => setCrop((e as CustomEvent<{ src: string; pos: number }>).detail);
    el.addEventListener("image-crop-request", h);
    return () => el.removeEventListener("image-crop-request", h);
  }, []);

  const applyCrop = async (blob: Blob) => {
    const target = crop; setCrop(null);
    if (!target || !editor) return;
    setUploading(true);
    try {
      const url = await uploadImage(new File([blob], `crop.${blob.type === "image/png" ? "png" : "jpg"}`, { type: blob.type }));
      const { state } = editor.view; const n = state.doc.nodeAt(target.pos);
      if (n) editor.view.dispatch(state.tr.setNodeMarkup(target.pos, undefined, { ...n.attrs, src: url, width: null }));
    } catch (err) { window.alert((err as Error).message); }
    finally { setUploading(false); }
  };

  if (!editor) return <div className={`rounded border bg-white ${className}`} style={{ borderColor: "var(--g-grey-300)", minHeight: `${minRows * 1.5 + 2.5}rem` }} />;

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (!url.trim()) { editor.chain().focus().unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };



  return (
    <div ref={wrapRef} className={`rounded border bg-white ${className}`} style={{ borderColor: "var(--g-grey-300)" }}>
      {crop && <CropModal src={crop.src} onCancel={() => setCrop(null)} onApply={applyCrop} />}
      <div className="flex flex-wrap items-center gap-0.5 border-b px-1 py-1" style={{ borderColor: "var(--g-grey-300)", background: "var(--g-grey-50)" }}>
        <B title="Bold (⌘B)" active={editor.isActive("bold")} on={() => editor.chain().focus().toggleBold().run()}><b>B</b></B>
        <B title="Italic (⌘I)" active={editor.isActive("italic")} on={() => editor.chain().focus().toggleItalic().run()}><i>I</i></B>
        <B title="Underline (⌘U)" active={editor.isActive("underline")} on={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></B>
        <B title="Strikethrough" active={editor.isActive("strike")} on={() => editor.chain().focus().toggleStrike().run()}><s>S</s></B>
        <span className="mx-1 h-5 w-px" style={{ background: "var(--g-grey-300)" }} />
        <B title="Heading" active={editor.isActive("heading", { level: 2 })} on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><span className="font-medium">H</span></B>
        <B title="Bulleted list" active={editor.isActive("bulletList")} on={() => editor.chain().focus().toggleBulletList().run()}>•≡</B>
        <B title="Numbered list" active={editor.isActive("orderedList")} on={() => editor.chain().focus().toggleOrderedList().run()}>1≡</B>
        <B title="Quote" active={editor.isActive("blockquote")} on={() => editor.chain().focus().toggleBlockquote().run()}>❝</B>
        <B title="Divider" on={() => editor.chain().focus().setHorizontalRule().run()}>―</B>
        <span className="mx-1 h-5 w-px" style={{ background: "var(--g-grey-300)" }} />
        <B title="Link" active={editor.isActive("link")} on={setLink}><Icon name="link" /></B>
        <B title="Insert image — uploads a copy; click an image to resize, double-click to crop" on={() => fileRef.current?.click()}>{uploading ? "…" : "🖼"}</B>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { insertFiles(e.target.files); e.target.value = ""; }} />
        <B title="Clear formatting" on={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>Tx</B>
      </div>
      <div className="relative">
        {editor.isEmpty && placeholder && <div className="pointer-events-none absolute left-3 top-2 text-sm whitespace-pre-wrap" style={{ color: "var(--g-grey-600)" }}>{placeholder}</div>}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function B({ on, active, title, children }: { on: () => void; active?: boolean; title: string; children: React.ReactNode }) {
  return (
    <button type="button" title={title} onMouseDown={(e) => { e.preventDefault(); on(); }}
      className="h-7 min-w-7 rounded px-1.5 text-sm" style={{ background: active ? "var(--g-blue-tint)" : undefined, color: active ? "var(--g-blue)" : "var(--g-grey-600)" }}>{children}</button>
  );
}

type CropRect = { x: number; y: number; w: number; h: number };

/** Google Forms-style crop dialog: drag inside to move, corners to resize; Crop re-encodes via canvas. */
function CropModal({ src, onCancel, onApply }: { src: string; onCancel: () => void; onApply: (blob: Blob) => void }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [rect, setRect] = useState<CropRect | null>(null);

  /** One pointerdown handler for the whole overlay; the pressed element's data-mode picks move vs corner-resize. */
  const onDragStart = (e: React.PointerEvent) => {
    if (!rect) return;
    e.preventDefault();
    const mode = (e.target as HTMLElement).dataset.mode ?? "move";
    const img = imgRef.current;
    const W = img?.clientWidth ?? 0, H = img?.clientHeight ?? 0;
    const sx = e.clientX, sy = e.clientY, o = rect;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let r: CropRect = o;
      if (mode === "move") r = { ...o, x: o.x + dx, y: o.y + dy };
      if (mode === "nw") r = { x: o.x + dx, y: o.y + dy, w: o.w - dx, h: o.h - dy };
      if (mode === "ne") r = { x: o.x, y: o.y + dy, w: o.w + dx, h: o.h - dy };
      if (mode === "sw") r = { x: o.x + dx, y: o.y, w: o.w - dx, h: o.h + dy };
      if (mode === "se") r = { x: o.x, y: o.y, w: o.w + dx, h: o.h + dy };
      const w = Math.max(20, Math.min(r.w, W)), h = Math.max(20, Math.min(r.h, H));
      setRect({ x: Math.max(0, Math.min(r.x, W - w)), y: Math.max(0, Math.min(r.y, H - h)), w, h });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  const apply = () => {
    const img = imgRef.current; if (!img || !rect) return;
    const sc = img.naturalWidth / img.clientWidth;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.w * sc)); canvas.height = Math.max(1, Math.round(rect.h * sc));
    try {
      canvas.getContext("2d")!.drawImage(img, rect.x * sc, rect.y * sc, rect.w * sc, rect.h * sc, 0, 0, canvas.width, canvas.height);
      const type = /\.png($|\?)/i.test(src) ? "image/png" : "image/jpeg";
      canvas.toBlob((b) => { if (b) onApply(b); else window.alert("Crop failed — try re-uploading the image first."); }, type, 0.92);
    } catch {
      window.alert("This image can\u2019t be cropped (it\u2019s hosted elsewhere and blocks editing). Re-upload it, then crop.");
    }
  };

  const corner: React.CSSProperties = { position: "absolute", width: 14, height: 14, borderRadius: "50%", background: "var(--g-blue)", border: "2px solid #fff", boxShadow: "0 1px 3px rgba(0,0,0,.35)" };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="rounded-lg bg-white p-4 shadow-xl">
        <div className="relative inline-block select-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imgRef} src={src} alt="" crossOrigin="anonymous" draggable={false} className="max-h-[65vh] max-w-[80vw]"
            onLoad={(e) => { const t = e.currentTarget; setRect({ x: 0, y: 0, w: t.clientWidth, h: t.clientHeight }); }} />
          {rect && (
            <div className="absolute cursor-move" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, border: "2px dashed #fff", boxShadow: "0 0 0 9999px rgba(0,0,0,.55)" }} onPointerDown={onDragStart}>
              <span data-mode="nw" style={{ ...corner, left: -7, top: -7, cursor: "nwse-resize" }} />
              <span data-mode="ne" style={{ ...corner, right: -7, top: -7, cursor: "nesw-resize" }} />
              <span data-mode="sw" style={{ ...corner, left: -7, bottom: -7, cursor: "nesw-resize" }} />
              <span data-mode="se" style={{ ...corner, right: -7, bottom: -7, cursor: "nwse-resize" }} />
            </div>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs" style={{ color: "var(--g-grey-600)" }}>Drag to move \u00b7 corners to resize the crop</span>
          <span className="flex gap-2">
            <button type="button" onClick={onCancel} className="btn-text">Cancel</button>
            <button type="button" onClick={apply} className="btn-primary py-1.5">Crop</button>
          </span>
        </div>
      </div>
    </div>
  );
}
