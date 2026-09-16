"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/icon";
import LocalTime from "@/components/local-time";
import { createForm, createFromTemplate, createTemplate } from "./actions";
import FormMenu from "./form-menu";

export type FormRow = { id: string; title: string; status: string; due_at: string | null; created_at: string; responses: number; events: number; ask_weight: boolean; qLabels: string[] };
export type TemplateRow = { id: string; title: string; ask_weight: boolean; qLabels: string[] };

const STATUS: Record<string, [string, string]> = { draft: ["Draft", "var(--g-grey-600)"], open: ["Accepting responses", "var(--g-green)"], closed: ["Closed", "#b06000"] };
const grey = { color: "var(--g-grey-600)" };

/** Mini document thumbnail: colored top bar + content lines, like the Google Forms home cards. */
function Thumb({ lines, bar = "var(--g-purple)" }: { lines: string[]; bar?: string }) {
  return (
    <div className="h-full w-full overflow-hidden rounded-t-lg bg-white p-3" style={{ background: "var(--g-purple-soft)" }}>
      <div className="mx-auto h-full w-[85%] rounded-sm bg-white p-2 shadow-sm">
        <div className="h-1.5 w-full rounded-sm" style={{ background: bar }} />
        {lines.length
          ? lines.map((l, i) => <div key={i} className="mt-1.5 truncate text-[7px] leading-tight" style={grey}>{l}</div>)
          : [0, 1, 2].map((i) => <div key={i} className="mt-2 h-1 rounded-sm" style={{ background: "var(--g-grey-100)", width: `${85 - i * 20}%` }} />)}
      </div>
    </div>
  );
}

export default function FormsHome({ forms, templates, memberCount }: { forms: FormRow[]; templates: TemplateRow[]; memberCount: number }) {
  const [q, setQ] = useState("");
  // The search pill lives in the top app bar (HeaderSearch) and broadcasts keystrokes here.
  useEffect(() => {
    const h = (e: Event) => setQ(String((e as CustomEvent).detail ?? ""));
    window.addEventListener("portal-search", h);
    return () => window.removeEventListener("portal-search", h);
  }, []);
  const shown = forms.filter((f) => f.title.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="-m-4 md:-m-6 min-h-full">
      {/* template gallery */}
      <div className="border-b px-4 py-5 md:px-8" style={{ background: "var(--g-grey-50)", borderColor: "var(--g-grey-300)" }}>
        <div className="mx-auto max-w-[1100px]">
          <h2 className="mb-3 text-base">Start a new form</h2>
          <div className="flex flex-wrap items-start gap-6">
            <form action={createForm} className="w-40">
              <input type="hidden" name="template" value="blank" />
              <button className="block h-32 w-40 overflow-hidden rounded-lg border bg-white transition hover:border-[var(--g-purple)]" style={{ borderColor: "var(--g-grey-300)" }}>
                <span className="flex h-full items-center justify-center text-5xl" style={{ color: "var(--g-purple)" }}><Icon name="plus" /></span>
              </button>
              <div className="mt-2 text-sm">Blank form</div>
              <div className="text-xs" style={grey}>your questions only</div>
            </form>
            {templates.map((t) => (
              <div key={t.id} className="relative w-40">
                <FormMenu id={t.id} title={t.title} kind="template" />
                <form action={createFromTemplate}>
                  <input type="hidden" name="template_id" value={t.id} />
                  <button className="block h-32 w-40 overflow-hidden rounded-lg border bg-white transition hover:border-[var(--g-purple)]" style={{ borderColor: "var(--g-grey-300)" }}>
                    <Thumb lines={[...(t.ask_weight ? ["What's your current weight?"] : []), "Will you be attending …? *", ...t.qLabels]} bar="var(--g-green)" />
                  </button>
                </form>
                <div className="mt-2 truncate text-sm">{t.title}</div>
                <div className="text-xs" style={grey}>template</div>
              </div>
            ))}
            <form action={createTemplate} className="w-40">
              <button className="block h-32 w-40 rounded-lg border border-dashed bg-transparent transition hover:bg-white" style={{ borderColor: "var(--g-grey-300)" }}
                title="Create a new template">
                <span className="flex h-full items-center justify-center text-4xl" style={{ color: "var(--g-grey-300)" }}><Icon name="plus" /></span>
              </button>
              <div className="mt-2 text-sm" style={grey}>New template</div>
              <div className="text-xs" style={grey}>starts blank</div>
            </form>
          </div>
        </div>
      </div>

      {/* recent forms */}
      <div className="px-4 py-5 md:px-8">
        <div className="mx-auto max-w-[1100px]">
          <h2 className="mb-3 text-base">{q.trim() ? `Results for “${q.trim()}”` : "Recent forms"}</h2>
          {!shown.length && <p className="text-sm" style={grey}>{q.trim() ? "No forms match your search." : "No forms yet — start one above. Forms bundle events (each gets the attendance + ride question) with your own custom questions."}</p>}
          <div className="grid gap-5 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
            {shown.map((f) => {
              const st = STATUS[f.status] ?? ["", ""];
              return (
                <div key={f.id} className="card card-hover relative flex flex-col !p-0">
                  <Link href={`/admin/forms/${f.id}`} className="block h-32">
                    <Thumb lines={[...(f.ask_weight ? ["What's your current weight?"] : []), ...(f.events ? ["Will you be attending …? *"] : []), ...f.qLabels]} />
                  </Link>
                  <div className="flex items-start justify-between gap-1 p-3 pt-2 text-sm">
                    <div className="min-w-0">
                      <Link href={`/admin/forms/${f.id}`} className="block truncate font-medium hover:underline">{f.title}</Link>
                      <div className="mt-1 flex items-center gap-2 text-xs" style={grey}>
                        <span style={{ color: st[1] }}>●</span>
                        <span className="truncate">{st[0]} · {f.responses}/{memberCount}</span>
                      </div>
                      {f.due_at && <div className="mt-0.5 pl-[18px] text-xs" style={grey}>due <LocalTime iso={f.due_at} /></div>}
                    </div>
                    <FormMenu id={f.id} title={f.title} className="relative -mr-1 shrink-0" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
