"use client";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap, type S } from "./browser";
import type { paths } from "./schema";

/** Admin console hooks. Every action is authorised again (and audited) by the API. */

export type AdminTable = paths["/v1/admin/tables/{table}"]["get"]["parameters"]["path"]["table"];
/** Every table the API allows editing, for the picker (kept in step with the AdminTable enum; a test checks). */
export const ADMIN_TABLES: AdminTable[] = ["commodities", "commodity_categories", "varieties", "units", "commodity_unit_conversions", "markets", "regions", "data_sources", "crop_calendars", "holidays",
  "crop_guides", "pest_diseases", "fertiliser_products", "fertiliser_rules", "agro_advice_rules", "programmes", "training_items", "input_suppliers", "export_requirements",
  "plans", "commission_rules", "notification_templates", "faqs", "success_stories", "help_articles", "app_config"];
export const KNOWLEDGE_TABLES = ["crop_guides", "pest_diseases", "fertiliser_rules"] as const;
export const REVISION_TABLES = ["crop_guides", "pest_diseases", "fertiliser_rules", "programmes", "training_items", "input_suppliers"] as const;
export type Row = Record<string, unknown>;

/**
 * Admin lists come straight from SQL (snake_case) while the rest of the API is camelCase; read either.
 * field(row, "createdAt") → row.createdAt ?? row.created_at. Exported for tests.
 */
export function field<T = unknown>(row: Row | null | undefined, camel: string): T | undefined {
  if (!row) return undefined;
  if (camel in row) return row[camel] as T;
  const snake = camel.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
  return row[snake] as T | undefined;
}

// ── Prices ──
export const useReviewQueue = (country: string | undefined, status: "pending" | "flagged") =>
  useInfiniteQuery({
    queryKey: ["admin", "review-queue", country ?? "", status] as const,
    queryFn: ({ pageParam }) => unwrap(api.GET("/v1/admin/prices/review-queue", { params: { query: { country, status, cursor: pageParam || undefined, limit: 50 } } })),
    initialPageParam: "", getNextPageParam: (p) => p.nextCursor ?? undefined,
  });

export function useReviewPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: S["ReviewDecision"] }) => unwrap(api.POST("/v1/admin/prices/{id}/review", { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "review-queue"] }),
  });
}

export const useImportPrices = () =>
  useMutation({
    mutationFn: (f: { file: File; country: string; sourceId?: string; dryRun: boolean }) => {
      const fd = new FormData();
      fd.append("file", f.file);
      fd.append("country", f.country);
      if (f.sourceId) fd.append("source_id", f.sourceId);
      fd.append("dry_run", String(f.dryRun));
      return unwrap(api.POST("/v1/admin/prices/import", { body: fd as never, bodySerializer: (b: unknown) => b as FormData }));
    },
  });

// ── Catalogue & content tables ──
export const useAdminTable = (table: AdminTable, q: string) =>
  useInfiniteQuery({
    queryKey: ["admin", "table", table, q] as const,
    queryFn: ({ pageParam }) => unwrap(api.GET("/v1/admin/tables/{table}", { params: { path: { table }, query: { q: q || undefined, cursor: pageParam || undefined, limit: 50 } } })),
    initialPageParam: "", getNextPageParam: (p) => p.nextCursor ?? undefined, placeholderData: keepPreviousData,
  });

export function useTableMutations(table: AdminTable) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["admin", "table", table] });
  return {
    create: useMutation({ mutationFn: (body: Row) => unwrap(api.POST("/v1/admin/tables/{table}", { params: { path: { table } }, body })), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, body }: { id: string; body: Row }) => unwrap(api.PATCH("/v1/admin/tables/{table}/{id}", { params: { path: { table, id } }, body })), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => unwrap(api.DELETE("/v1/admin/tables/{table}/{id}", { params: { path: { table, id } } })), onSuccess: done }),
  };
}

type KnowledgeTable = "crop_guides" | "pest_diseases" | "fertiliser_rules";
export function useKnowledgeReview(table: AdminTable) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, publish, note }: { id: string; publish: boolean; note?: string }) =>
      unwrap(api.POST("/v1/admin/knowledge/{table}/{id}/review", { params: { path: { table: table as KnowledgeTable, id } }, body: { publish, ...(note ? { note } : {}) } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "table", table] }),
  });
}

type RevTable = KnowledgeTable | "programmes" | "training_items" | "input_suppliers";
export const useRevisions = (table: AdminTable, id: string | null) =>
  useQuery({
    queryKey: ["admin", "revisions", table, id] as const,
    queryFn: () => unwrap(api.GET("/v1/admin/knowledge/{table}/{id}/revisions", { params: { path: { table: table as RevTable, id: id! } } })),
    enabled: Boolean(id),
  });

// ── Countries ──
export const useCountries = () => useQuery({ queryKey: ["countries"] as const, queryFn: () => unwrap(api.GET("/v1/countries")), staleTime: 300_000 });
export function useUpdateCountry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ iso2, body }: { iso2: string; body: Row }) => unwrap(api.PATCH("/v1/admin/country-packs/{iso2}", { params: { path: { iso2 } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["countries"] }),
  });
}

// ── Users ──
export const useAdminUsers = (f: { country?: string; role?: S["Role"]; q?: string }) =>
  useInfiniteQuery({
    queryKey: ["admin", "users", f] as const,
    queryFn: ({ pageParam }) => unwrap(api.GET("/v1/admin/users", { params: { query: { country: f.country, role: f.role, q: f.q || undefined, cursor: pageParam || undefined, limit: 50 } } })),
    initialPageParam: "", getNextPageParam: (p) => p.nextCursor ?? undefined, placeholderData: keepPreviousData,
  });

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: S["AdminUserUpdate"] }) => unwrap(api.PATCH("/v1/admin/users/{id}", { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

// ── Broadcasts, models, audit ──
export const useBroadcast = () => useMutation({ mutationFn: (body: S["Broadcast"]) => unwrap(api.POST("/v1/admin/broadcasts", { body })) });
export const useModels = () => useQuery({ queryKey: ["admin", "models"] as const, queryFn: () => unwrap(api.GET("/v1/admin/models")), staleTime: 60_000 });

export type AuditFilters = { actorId?: string; action?: string; entity?: string; from?: string };
export const useAuditLog = (f: AuditFilters, limit = 50) =>
  useInfiniteQuery({
    queryKey: ["admin", "audit", f, limit] as const,
    queryFn: ({ pageParam }) => unwrap(api.GET("/v1/admin/audit-log", { params: { query: { actor_id: f.actorId, action: f.action || undefined, entity: f.entity || undefined, from: f.from, cursor: pageParam || undefined, limit } } })),
    initialPageParam: "", getNextPageParam: (p) => p.nextCursor ?? undefined, placeholderData: keepPreviousData,
  });

// ── Payouts & reconciliation ──
export const useAdminPayouts = (status: "pending_review" | "processing" | "failed") =>
  useInfiniteQuery({
    queryKey: ["admin", "payouts", status] as const,
    queryFn: ({ pageParam }) => unwrap(api.GET("/v1/admin/payouts", { params: { query: { status, cursor: pageParam || undefined, limit: 50 } } })),
    initialPageParam: "", getNextPageParam: (p) => p.nextCursor ?? undefined,
  });

export function useReviewPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: S["ReviewDecision"] }) => unwrap(api.POST("/v1/admin/payouts/{id}/review", { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "payouts"] }),
  });
}

export const useReconciliation = (provider?: string) =>
  useQuery({ queryKey: ["admin", "recon", provider ?? ""] as const, queryFn: () => unwrap(api.GET("/v1/admin/reconciliation", { params: { query: { provider: provider || undefined, limit: 60 } } })) });

// ── Seller approvals (KYC) ──
export type KycStatus = "pending" | "verified" | "rejected";
/** Document links expire after five minutes, so the queue refetches before they go stale and never caches for long. */
export const useKycQueue = (status: KycStatus) =>
  useInfiniteQuery({
    queryKey: ["admin", "kyc", status] as const,
    queryFn: ({ pageParam }) => unwrap(api.GET("/v1/admin/kyc", { params: { query: { status, cursor: pageParam || undefined, limit: 20 } } })),
    initialPageParam: "", getNextPageParam: (p) => p.nextCursor ?? undefined, staleTime: 0, gcTime: 60_000, refetchInterval: 240_000,
  });

export function useKycDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, decision, reason }: { userId: string; decision: "approve" | "reject"; reason?: string }) =>
      unwrap(api.POST("/v1/admin/kyc/{userId}/decision", { params: { path: { userId } }, body: { decision, ...(reason ? { reason } : {}) } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "kyc"] }),
  });
}

// ── Overview totals ──
export const useAdminStats = (days: 7 | 30 | 90) =>
  useQuery({ queryKey: ["admin", "stats", days] as const, queryFn: () => unwrap(api.GET("/v1/admin/stats", { params: { query: { days } } })),
    staleTime: 60_000, placeholderData: keepPreviousData });
