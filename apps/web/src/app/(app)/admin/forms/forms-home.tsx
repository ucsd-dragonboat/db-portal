"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/icon";
import LocalTime from "@/components/local-time";
import BrowseGrid, { Thumb, type BrowseItem } from "@/components/browse-grid";
import { createForm, createFromTemplate, createTemplate } from "./actions";
import FormMenu from "./form-menu";

export type FormRow = { id: string; title: string; status: string; due_at: string | null; created_at: string; updated_at: string; responses: number; events: number; ask_weight: boolean; qLabels: string[] };
export type TemplateRow = { id: string; title: string; ask_weight: boolean; qLabels: string[] };

const STATUS: Record<string, [string, string]> = { draft: ["Draft", "var(--g-grey-600)"], open: ["Accepting responses", "var(--g-green)"], closed: ["Closed", "#b06000"] };
const grey = { color: "var(--g-grey-600)" };

export default function FormsHome({ forms, templates, memberCount }: { forms: FormRow[]; templates: TemplateRow[]; memberCount: number }) {
  const [q, setQ] = useState("");
  // The search pill lives in the top app bar (HeaderSearch) and broadcasts keystrokes here.
  useEffect(() => {
    const h = (e: Event) => setQ(String((e as CustomEvent).detail ?? ""));
    window.addEventListener("portal-search", h);
    return () => window.removeEventListener("portal-search", h);
  }, []);
  const shown = forms.filter((f) => f.title.toLowerCase().includes(q.trim().toLowerCase()));
  // BrowseGrid handles sorting and the grid/list views; search stays here.
  const items: BrowseItem[] = shown.map((f) => {
    const [label, color] = STATUS[f.status] ?? ["", ""];
    return {
      id: f.id, href: `/admin/forms/${f.id}`, title: f.title,
      lines: [...(f.ask_weight ? ["What's your current weight?"] : []), ...(f.events ? ["Will you be attending …? *"] : []), ...f.qLabels],
      meta: `${label} · ${f.responses}/${memberCount}`,
      metaColor: color,
      subtitle: f.due_at ? <>due <LocalTime iso={f.due_at} /></> : undefined,
      menu: <FormMenu id={f.id} title={f.title} className="relative -mr-1 shrink-0" />,
      date: f.created_at,
      modified: f.updated_at,
    };
  });
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
                    <Thumb lines={[...(t.ask_weight ? ["What's your current weight?"] : []), "Will you be attending …? *", ...t.qLabels]} color="var(--g-green)" soft="var(--g-purple-soft)" height="h-full" />
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
          <BrowseGrid items={items} storageKey="forms" color="var(--g-purple)" soft="var(--g-purple-soft)" thumbHeight="h-32"
            heading={q.trim() ? `Results for “${q.trim()}”` : "Recent forms"}
            empty={q.trim() ? "No forms match your search." : "No forms yet — start one above. Forms bundle events (each gets the attendance + ride question) with your own custom questions."}
            sorts={[{ key: "date", label: "Date created" }, { key: "modified", label: "Last modified" }, { key: "title", label: "Title" }]} />
        </div>
      </div>
    </div>
  );
}
