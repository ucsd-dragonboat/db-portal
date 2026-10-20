// Google Sheets–style table views: sort, filter (by values or by condition), search,
// one level of grouping with summary stats, hidden columns, display formats and CSV.
// Pure — no React — so the Members roster's behaviour is testable on its own.

export type ColumnType = "text" | "number" | "date" | "choice";
export type CellValue = string | number | null;

/** A display format ("Edit column type"): changes how a value shows, never the data. */
export type ColumnFormat = { key: string; label: string; fmt: (v: CellValue) => string };

export type SheetColumn<R> = {
  key: string;
  label: string;
  type: ColumnType;
  /** number for "number", "YYYY-MM-DD" for "date", text otherwise; null = blank. */
  get: (row: R) => CellValue;
  /** First one is the default. */
  formats?: ColumnFormat[];
  /** Number columns: what group headers summarise (lat/lon totals mean nothing). */
  summary?: ("sum" | "avg")[];
};

export type Condition = "empty" | "notEmpty" | "contains" | "eq" | "gt" | "lt" | "between" | "before" | "after";
/** "Filter by values" keeps rows whose (formatted) value is checked — null is (Blanks);
 * "Filter by condition" tests the raw value. */
export type Filter = { values: (string | null)[] } | { cond: Condition; a?: string; b?: string };

export type ViewState = {
  sort?: { key: string; dir: "asc" | "desc" };
  filters: Record<string, Filter>;
  group?: string;
  hidden: string[];
  formats: Record<string, string>;
  search: string;
  /** Group keys whose rows are folded away. */
  collapsed: string[];
};

export const EMPTY_VIEW: ViewState = { filters: {}, hidden: [], formats: {}, search: "", collapsed: [] };

export type GroupStat = { key: string; label: string; sum: number; avg: number };
export type Group<R> = { key: string; label: string; rows: R[]; count: number; stats: GroupStat[] };

const isBlank = (v: CellValue) => v === null || v === "";

/** The value as shown — the column's chosen format, or plain text. */
export function cellText<R>(col: SheetColumn<R>, row: R, view: ViewState): string {
  return formatValue(col, col.get(row), view);
}
export function formatValue<R>(col: SheetColumn<R>, v: CellValue, view: ViewState): string {
  const f = col.formats?.find((x) => x.key === view.formats[col.key]) ?? col.formats?.[0];
  if (f) return f.fmt(v);
  return isBlank(v) ? "" : String(v);
}

/** Typed comparison; blanks are handled by the caller (always last). */
function compare(type: ColumnType, a: CellValue, b: CellValue): number {
  if (type === "number") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
}

function matches<R>(col: SheetColumn<R>, row: R, f: Filter, view: ViewState): boolean {
  const v = col.get(row);
  if ("values" in f) return f.values.includes(isBlank(v) ? null : cellText(col, row, view));
  const { cond, a = "", b = "" } = f;
  if (cond === "empty") return isBlank(v);
  if (cond === "notEmpty") return !isBlank(v);
  if (isBlank(v)) return false;
  if (cond === "contains") return cellText(col, row, view).toLowerCase().includes(a.trim().toLowerCase())
    || String(v).toLowerCase().includes(a.trim().toLowerCase());
  if (col.type === "number") {
    const n = Number(v), x = Number(a), y = Number(b);
    if (cond === "eq") return a.trim() !== "" && n === x;
    if (cond === "gt") return a.trim() !== "" && n > x;
    if (cond === "lt") return a.trim() !== "" && n < x;
    if (cond === "between") return a.trim() !== "" && b.trim() !== "" && n >= Math.min(x, y) && n <= Math.max(x, y);
    return true;
  }
  const s = String(v);
  if (col.type === "date") {
    if (cond === "eq") return !!a && s === a;
    if (cond === "before") return !!a && s < a;
    if (cond === "after") return !!a && s > a;
    if (cond === "between") return !!a && !!b && s >= (a < b ? a : b) && s <= (a < b ? b : a);
    return true;
  }
  if (cond === "eq") return s.toLowerCase() === a.trim().toLowerCase();
  return true;
}

/** Every distinct shown value of a column (for the "Filter by values" checklist), sorted, with blanks as null last. */
export function distinctValues<R>(col: SheetColumn<R>, rows: R[], view: ViewState): (string | null)[] {
  const seen = new Map<string, CellValue>();
  let blank = false;
  for (const r of rows) {
    const v = col.get(r);
    if (isBlank(v)) { blank = true; continue; }
    const t = cellText(col, r, view);
    if (!seen.has(t)) seen.set(t, v);
  }
  const out: (string | null)[] = [...seen.entries()].sort((x, y) => compare(col.type, x[1], y[1])).map(([t]) => t);
  return blank ? [...out, null] : out;
}

/** Search, filter, sort and group — what the table shows, in order. Without grouping
 * there's one group with key "". */
export function applyView<R>(rows: R[], columns: SheetColumn<R>[], view: ViewState): Group<R>[] {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const visible = columns.filter((c) => !view.hidden.includes(c.key));
  const q = view.search.trim().toLowerCase();
  let out = rows.filter((r) => {
    if (q && !visible.some((c) => cellText(c, r, view).toLowerCase().includes(q))) return false;
    for (const [key, f] of Object.entries(view.filters)) {
      const col = byKey.get(key);
      if (col && !matches(col, r, f, view)) return false;
    }
    return true;
  });

  const sortCol = view.sort && byKey.get(view.sort.key);
  if (sortCol) {
    const dir = view.sort!.dir === "desc" ? -1 : 1;
    out = out.map((r, i) => ({ r, i, v: sortCol.get(r) }))
      .sort((x, y) => {
        const bx = isBlank(x.v), by = isBlank(y.v);
        if (bx || by) return bx === by ? x.i - y.i : bx ? 1 : -1; // blanks last either way
        return dir * compare(sortCol.type, x.v, y.v) || x.i - y.i;
      })
      .map((x) => x.r);
  }

  const numberCols = visible.filter((c) => c.type === "number" && c.summary?.length);
  const stats = (rs: R[]): GroupStat[] => numberCols.map((c) => {
    const ns = rs.map((r) => c.get(r)).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const sum = ns.reduce((a, n) => a + n, 0);
    return { key: c.key, label: c.label, sum, avg: ns.length ? sum / ns.length : 0 };
  });

  const groupCol = view.group && byKey.get(view.group);
  if (!groupCol) return [{ key: "", label: "", rows: out, count: out.length, stats: stats(out) }];

  const groups = new Map<string, { label: string; v: CellValue; rows: R[] }>();
  for (const r of out) {
    const v = groupCol.get(r);
    const key = isBlank(v) ? "\u0000blank" : cellText(groupCol, r, view);
    if (!groups.has(key)) groups.set(key, { label: isBlank(v) ? "(Blanks)" : key, v, rows: [] });
    groups.get(key)!.rows.push(r);
  }
  // Groups follow the sort when it's on the grouped column, otherwise A → Z; (Blanks) last.
  const dir = view.sort?.key === groupCol.key && view.sort.dir === "desc" ? -1 : 1;
  return [...groups.entries()]
    .sort(([, x], [, y]) => (isBlank(x.v) ? 1 : isBlank(y.v) ? -1 : dir * compare(groupCol.type, x.v, y.v)))
    .map(([key, g]) => ({ key, label: g.label, rows: g.rows, count: g.rows.length, stats: stats(g.rows) }));
}

/** The view as CSV: visible columns, shown text, same rows and order (collapsed groups included). */
export function toCsv<R>(columns: SheetColumn<R>[], rows: R[], view: ViewState): string {
  const visible = columns.filter((c) => !view.hidden.includes(c.key));
  const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [visible.map((c) => esc(c.label)).join(",")];
  for (const g of applyView(rows, columns, view)) for (const r of g.rows) lines.push(visible.map((c) => esc(cellText(c, r, view))).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** A saved view, checked against today's columns — unknown keys, bad shapes and stale
 * formats are dropped so an old or hand-edited localStorage entry can't break the page. */
export function sanitizeView<R>(raw: unknown, columns: SheetColumn<R>[]): ViewState {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof ViewState, unknown>>;
  const col = (k: unknown) => (typeof k === "string" ? columns.find((c) => c.key === k) : undefined);
  const view: ViewState = { ...EMPTY_VIEW, filters: {}, formats: {} };
  const s = v.sort as { key?: unknown; dir?: unknown } | undefined;
  if (s && col(s.key) && (s.dir === "asc" || s.dir === "desc")) view.sort = { key: s.key as string, dir: s.dir };
  if (col(v.group)) view.group = v.group as string;
  if (Array.isArray(v.hidden)) view.hidden = v.hidden.filter((k) => col(k)) as string[];
  if (Array.isArray(v.collapsed)) view.collapsed = v.collapsed.filter((k) => typeof k === "string") as string[];
  if (typeof v.search === "string") view.search = v.search.slice(0, 200);
  for (const [k, f] of Object.entries((v.formats as object) ?? {})) if (col(k)?.formats?.some((x) => x.key === f)) view.formats[k] = f as string;
  const CONDS: Condition[] = ["empty", "notEmpty", "contains", "eq", "gt", "lt", "between", "before", "after"];
  for (const [k, f] of Object.entries((v.filters as object) ?? {})) {
    if (!col(k) || !f || typeof f !== "object") continue;
    const ff = f as { values?: unknown; cond?: unknown; a?: unknown; b?: unknown };
    if (Array.isArray(ff.values)) view.filters[k] = { values: ff.values.filter((x) => x === null || typeof x === "string") as (string | null)[] };
    else if (CONDS.includes(ff.cond as Condition)) view.filters[k] = { cond: ff.cond as Condition, a: typeof ff.a === "string" ? ff.a : undefined, b: typeof ff.b === "string" ? ff.b : undefined };
  }
  return view;
}
