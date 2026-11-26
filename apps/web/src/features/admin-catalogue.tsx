"use client";
import { BadgeCheck, History, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useState } from "react";
import { EmptyState } from "@/components/agri/empty-state";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Button, Card, FieldError, Input, Label, Skeleton } from "@/components/ui/primitives";
import { ADMIN_TABLES, field, KNOWLEDGE_TABLES, REVISION_TABLES, useAdminTable, useKnowledgeReview, useRevisions, useTableMutations, type AdminTable, type Row } from "@/lib/api/admin";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const HIDDEN = new Set(["search", "password_hash", "secret", "token"]);
const PREFERRED = ["code", "name", "title", "display_name", "kind", "status", "country_iso2", "updated_at"];

/** Columns to show for a table: a few readable ones first, then the rest, skipping heavy JSON (exported for tests). */
export function columnsFor(rows: Row[], max = 6): string[] {
  const keys = new Set<string>();
  for (const r of rows.slice(0, 20)) for (const [k, v] of Object.entries(r)) if (!HIDDEN.has(k) && (v === null || typeof v !== "object" || (Array.isArray(v) && v.length < 6))) keys.add(k);
  const ordered = [...PREFERRED.filter((k) => keys.has(k)), ...[...keys].filter((k) => !PREFERRED.includes(k) && k !== "id")];
  return ordered.slice(0, max);
}

/** Parses the editor's JSON; must be a plain object (exported for tests). */
export function parseRow(text: string): { ok: true; value: Row } | { ok: false; error: string } {
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "object" };
    return { ok: true, value: v as Row };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

const cell = (v: unknown, locale: string) => {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "✓" : "✗";
  if (typeof v === "object") { const s = JSON.stringify(v); return s.length > 60 ? `${s.slice(0, 60)}…` : s; }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return relativeTime(s, locale);
  if (s.length > 60) return `${s.slice(0, 60)}…`;
  // Localised names are stored as {en, fr…} objects and handled above; plain strings pass through.
  return s;
};

/** /admin/catalogue: generic, allow-listed table editor. The API scopes rows by country for org admins. */
export function CatalogueEditor() {
  const t = useTranslations("adm");
  const locale = useLocale();
  const [f, setF] = useQueryStates({ table: parseAsStringLiteral(ADMIN_TABLES).withDefault("commodities"), q: parseAsString.withDefault("") });
  const [q, setQ] = useState(f.q);
  const table = f.table as AdminTable;
  const list = useAdminTable(table, f.q);
  const rows = (list.data?.pages.flatMap((p) => p.data) ?? []) as Row[];
  const cols = columnsFor(rows);
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const muts = useTableMutations(table);
  const review = useKnowledgeReview(table);
  const fb = useFeedback();
  const problem = useProblemMessage();
  const knowledge = (KNOWLEDGE_TABLES as readonly string[]).includes(table);
  const versioned = (REVISION_TABLES as readonly string[]).includes(table);

  const del = async (r: Row) => {
    if (!(await fb.confirm({ title: t("deleteTitle"), description: t("deleteBody", { table }), confirmLabel: t("deleteRow"), destructive: true }))) return;
    muts.remove.mutate(String(field(r, "id")), { onSuccess: () => fb.success(t("deleted")), onError: (x) => fb.error(problem(x as never)) });
  };
  const signOff = (r: Row) => review.mutate({ id: String(field(r, "id")), publish: true }, { onSuccess: () => fb.success(t("reviewed")), onError: (x) => fb.error(problem(x as never)) });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("catalogue")}</h1>
        <Button size="sm" onClick={() => setEditing("new")}><Plus aria-hidden className="size-4" />{t("newRow")}</Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-fg">{t("table")}
          <select value={table} onChange={(e) => { setQ(""); void setF({ table: e.target.value as AdminTable, q: null }); }} className="h-10 rounded-xl border border-border bg-background px-3 font-mono text-sm text-foreground">
            {ADMIN_TABLES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <form role="search" onSubmit={(e) => { e.preventDefault(); void setF({ q: q.trim() || null }); }} className="relative min-w-60 flex-1">
          <label htmlFor="cat-q" className="sr-only">{t("search")}</label>
          <Search aria-hidden className="absolute start-3 top-2.5 size-5 text-muted-fg" />
          <Input id="cat-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="ps-10" maxLength={100} />
        </form>
      </div>
      {list.isPending ? <Skeleton className="h-96" /> : !rows.length ? <EmptyState title={t("noRows")} /> : (
        <Card className="p-0">
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={table}>
            <table className="w-full min-w-[44rem] text-sm">
              <caption className="sr-only">{table}</caption>
              <thead className="bg-muted text-muted-fg"><tr>{cols.map((c) => <th key={c} scope="col" className="px-3 py-2 text-start font-mono text-xs font-medium">{c}</th>)}<th scope="col" className="px-3 py-2 text-end font-medium">{t("actions")}</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const id = String(field(r, "id") ?? field(r, "code") ?? i);
                  return (
                    <tr key={id} className="border-t border-border align-top">
                      {cols.map((c, j) => j === 0 ? <th key={c} scope="row" className="px-3 py-2 text-start font-medium">{cell(r[c], locale)}</th> : <td key={c} className="px-3 py-2">{cell(r[c], locale)}</td>)}
                      <td className="whitespace-nowrap px-3 py-2 text-end">
                        {knowledge && !field(r, "reviewedAt") ? <button type="button" onClick={() => signOff(r)} className="rounded-lg p-1.5 text-up-ink hover:bg-muted" aria-label={`${t("publish")}: ${id}`} title={t("publish")}><BadgeCheck className="size-4" /></button> : null}
                        {versioned ? <button type="button" onClick={() => setHistory(id)} className="rounded-lg p-1.5 hover:bg-muted" aria-label={`${t("revisions")}: ${id}`} title={t("revisions")}><History className="size-4" /></button> : null}
                        <button type="button" onClick={() => setEditing(r)} className="rounded-lg p-1.5 hover:bg-muted" aria-label={`${t("editRow")}: ${id}`} title={t("editRow")}><Pencil className="size-4" /></button>
                        <button type="button" onClick={() => void del(r)} className="rounded-lg p-1.5 text-down hover:bg-down/10" aria-label={`${t("deleteRow")}: ${id}`} title={t("deleteRow")}><Trash2 className="size-4" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {list.hasNextPage ? <div className="border-t border-border p-3"><Button variant="outline" size="sm" onClick={() => void list.fetchNextPage()}>{t("loadMore")}</Button></div> : null}
        </Card>
      )}
      {editing ? <RowEditor table={table} row={editing === "new" ? null : editing} template={rows[0]} onClose={() => setEditing(null)} /> : null}
      {history ? <Revisions table={table} id={history} onClose={() => setHistory(null)} /> : null}
    </div>
  );
}

const READ_ONLY = new Set(["id", "created_at", "updated_at", "search", "reviewed_at", "reviewed_by", "version"]);

function RowEditor({ table, row, template, onClose }: { table: AdminTable; row: Row | null; template?: Row; onClose: () => void }) {
  const t = useTranslations("adm");
  const fb = useFeedback();
  const problem = useProblemMessage();
  const muts = useTableMutations(table);
  const editable = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k]) => !READ_ONLY.has(k)));
  const [text, setText] = useState(() => JSON.stringify(row ? editable(row) : Object.fromEntries(Object.keys(editable(template ?? {})).map((k) => [k, null])), null, 2));
  const [err, setErr] = useState<string | null>(null);
  const save = () => {
    const p = parseRow(text);
    if (!p.ok) { setErr(p.error === "object" ? t("jsonObject") : t("jsonBad", { error: p.error })); return; }
    setErr(null);
    const done = { onSuccess: () => { fb.success(row ? t("saved") : t("created")); onClose(); }, onError: (x: unknown) => fb.error(problem(x as never)) };
    if (row) muts.update.mutate({ id: String(field(row, "id")), body: p.value }, done); else muts.create.mutate(p.value, done);
  };
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed start-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-xl rtl:translate-x-1/2">
          <div className="flex items-center justify-between"><Dialog.Title className="text-lg font-semibold">{row ? t("editRow") : t("newRow")} · <code className="font-mono text-base">{table}</code></Dialog.Title><Dialog.Close className="rounded-lg p-1 hover:bg-muted" aria-label={t("cancel")}><X className="size-4" /></Dialog.Close></div>
          <Dialog.Description className="text-xs text-muted-fg">{t("jsonHint")}</Dialog.Description>
          <Label htmlFor="row-json" className="sr-only">JSON</Label>
          <textarea id="row-json" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className="min-h-80 flex-1 rounded-xl border border-border bg-background p-3 font-mono text-xs" aria-invalid={Boolean(err)} aria-describedby={err ? "row-json-err" : undefined} />
          <FieldError><span id="row-json-err">{err}</span></FieldError>
          <div className="flex justify-end gap-2"><Dialog.Close asChild><Button variant="ghost" size="sm">{t("cancel")}</Button></Dialog.Close><Button size="sm" onClick={save} disabled={muts.create.isPending || muts.update.isPending}>{t("save")}</Button></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Revisions({ table, id, onClose }: { table: AdminTable; id: string; onClose: () => void }) {
  const t = useTranslations("adm");
  const locale = useLocale();
  const revs = useRevisions(table, id);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed start-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl rtl:translate-x-1/2">
          <div className="flex items-center justify-between"><Dialog.Title className="text-lg font-semibold">{t("revisions")}</Dialog.Title><Dialog.Close className="rounded-lg p-1 hover:bg-muted" aria-label={t("cancel")}><X className="size-4" /></Dialog.Close></div>
          <Dialog.Description className="sr-only">{table} {id}</Dialog.Description>
          {revs.isPending ? <Skeleton className="h-40" /> : !revs.data?.length ? <p className="text-sm text-muted-fg">{t("noRevisions")}</p> : (
            <ol className="space-y-2">
              {revs.data.map((r, i) => {
                const row = r as Row;
                const at = field<string>(row, "editedAt") ?? field<string>(row, "createdAt");
                const by = field<string>(row, "editedBy");
                return (
                  <li key={i} className="rounded-xl border border-border">
                    <button type="button" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className={cn("flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm", open === i && "border-b border-border")}>
                      <span className="font-medium">{t("version", { n: Number(field(row, "version") ?? 0) })}</span>
                      <span className="text-xs text-muted-fg">{at ? relativeTime(at, locale) : ""}{by ? ` · ${t("by", { who: by })}` : ""}</span>
                    </button>
                    {open === i ? <pre className="max-h-72 overflow-auto p-3 text-xs">{JSON.stringify(field(row, "data") ?? {}, null, 2)}</pre> : null}
                  </li>
                );
              })}
            </ol>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
