"use client";
import { keepPreviousData, useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, idempotencyKey, unwrap, type S } from "./browser";

type PriceType = S["PriceType"];
type Range = "1M" | "3M" | "6M" | "1Y" | "ALL";

export const qk = {
  me: ["me"] as const,
  snapshot: (cc: string) => ["snapshot", cc] as const,
  trending: (cc: string) => ["trending", cc] as const,
  commodities: (cc: string) => ["commodities", cc] as const,
  commodity: (id: string, cc: string) => ["commodity", id, cc] as const,
  latest: (id: string, cc: string, pt: PriceType) => ["latest", id, cc, pt] as const,
  history: (id: string, cc: string, range: Range, market?: string) => ["history", id, cc, range, market ?? "all"] as const,
  forecast: (id: string, market?: string, region?: string) => ["forecast", id, market ?? "", region ?? ""] as const,
  explanation: (fid: string, h: number) => ["explanation", fid, h] as const,
  compare: (id: string, markets: string[], range: string) => ["compare", id, markets.join(","), range] as const,
  markets: (cc: string) => ["markets", cc] as const,
  alerts: ["alerts"] as const,
  alertInsights: ["alerts", "insights"] as const,
};

export const useMe = () => useQuery({ queryKey: qk.me, queryFn: () => unwrap(api.GET("/v1/me")), staleTime: 60_000 });

export const useSnapshot = (cc: string) =>
  useQuery({ queryKey: qk.snapshot(cc), queryFn: () => unwrap(api.GET("/v1/dashboard/snapshot", { params: { query: { country: cc } } })), staleTime: 60_000, enabled: Boolean(cc) });

export const useTrending = (cc: string) =>
  useQuery({ queryKey: qk.trending(cc), queryFn: () => unwrap(api.GET("/v1/prices/trending", { params: { query: { country: cc, limit: 8 } } })), staleTime: 60_000, enabled: Boolean(cc) });

export const useCommodities = (cc: string) =>
  useQuery({ queryKey: qk.commodities(cc), queryFn: () => unwrap(api.GET("/v1/commodities", { params: { query: { country: cc, limit: 100 } } })), staleTime: 3_600_000, enabled: Boolean(cc) });

export const useCommodity = (id: string, cc: string) =>
  useQuery({ queryKey: qk.commodity(id, cc), queryFn: () => unwrap(api.GET("/v1/commodities/{id}", { params: { path: { id }, query: { country: cc } } })), staleTime: 3_600_000, enabled: Boolean(id && cc) });

export const useMarkets = (cc: string) =>
  useQuery({ queryKey: qk.markets(cc), queryFn: () => unwrap(api.GET("/v1/markets", { params: { query: { country: cc, limit: 100 } } })), staleTime: 3_600_000, enabled: Boolean(cc) });

export const useLatest = (id: string, cc: string, pt: PriceType = "wholesale") =>
  useQuery({ queryKey: qk.latest(id, cc, pt), queryFn: () => unwrap(api.GET("/v1/prices/latest", { params: { query: { commodity_id: id, country: cc, price_type: pt } } })), staleTime: 60_000, enabled: Boolean(id && cc) });

export const useHistory = (id: string, cc: string, range: Range, market?: string) =>
  useQuery({
    queryKey: qk.history(id, cc, range, market),
    queryFn: () => unwrap(api.GET("/v1/prices/history", { params: { query: { commodity_id: id, country: cc, range, market_id: market, interval: range === "1Y" || range === "ALL" ? "week" : "day" } } })),
    placeholderData: keepPreviousData, staleTime: 300_000, enabled: Boolean(id && cc),
  });

export const useForecast = (id: string, opts: { market?: string; region?: string }) =>
  useQuery({
    queryKey: qk.forecast(id, opts.market, opts.region),
    queryFn: () => unwrap(api.GET("/v1/forecasts", { params: { query: { commodity_id: id, market_id: opts.market, region_id: opts.region } } })),
    enabled: Boolean(opts.market || opts.region), staleTime: 600_000,
  });

export const useExplanation = (forecastId: string | null | undefined, horizon: 1 | 3 | 6) =>
  useQuery({
    queryKey: qk.explanation(forecastId ?? "", horizon),
    queryFn: () => unwrap(api.GET("/v1/forecasts/{id}/explanation", { params: { path: { id: forecastId! }, query: { horizon_months: horizon } } })),
    enabled: Boolean(forecastId), staleTime: 600_000,
  });

export const useCompare = (id: string, markets: string[], range: "1M" | "3M" | "6M" | "1Y") =>
  useQuery({
    queryKey: qk.compare(id, markets, range),
    queryFn: () => unwrap(api.GET("/v1/prices/compare", { params: { query: { commodity_id: id, market_ids: markets, range } } })),
    enabled: markets.length >= 2, placeholderData: keepPreviousData,
  });

export const useAlerts = () => useQuery({ queryKey: qk.alerts, queryFn: () => unwrap(api.GET("/v1/alerts")) });
export const useAlertInsights = () => useQuery({ queryKey: qk.alertInsights, queryFn: () => unwrap(api.GET("/v1/alerts/insights")) });

export function useCreateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S["AlertCreate"]) => unwrap(api.POST("/v1/alerts", { body, headers: { "Idempotency-Key": idempotencyKey() } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.alerts }),
  });
}

export function useUpdateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: S["AlertUpdate"] }) => unwrap(api.PATCH("/v1/alerts/{id}", { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.alerts }),
  });
}

export function useDeleteAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE("/v1/alerts/{id}", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.alerts }),
  });
}

// ── Profile & onboarding ──
export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S["UserUpdate"]) => unwrap(api.PATCH("/v1/me", { body })),
    onSuccess: (me) => qc.setQueryData(qk.me, me),
  });
}

export const useInterests = () => useQuery({ queryKey: ["me", "interests"] as const, queryFn: () => unwrap(api.GET("/v1/me/interests")) });

export function useSaveInterests() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S["Interests"]) => unwrap(api.PUT("/v1/me/interests", { body })),
    onSuccess: (v) => qc.setQueryData(["me", "interests"], v),
  });
}

// ── Security: TOTP 2FA & devices ──
export const useTotpSetup = () => useMutation({ mutationFn: () => unwrap(api.POST("/v1/auth/2fa/totp/setup")) });

export function useTotpEnable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => unwrap(api.POST("/v1/auth/2fa/totp/enable", { body: { code } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.me }),
  });
}

export function useTotpDisable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => unwrap(api.POST("/v1/auth/2fa/totp/disable", { body: { code } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.me }),
  });
}

export const useDevices = () => useQuery({ queryKey: ["devices"] as const, queryFn: () => unwrap(api.GET("/v1/auth/devices")) });

export function useRevokeDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE("/v1/auth/devices/{id}", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }),
  });
}

// ── Notifications ──
export const useNotifications = (opts: { limit?: number; unread?: boolean } = {}) =>
  useQuery({
    queryKey: ["notifications", opts.limit ?? 20, opts.unread ?? false] as const,
    queryFn: () => unwrap(api.GET("/v1/notifications", { params: { query: { limit: opts.limit ?? 20, unread: opts.unread } } })),
    staleTime: 30_000,
  });

export const useUnreadCount = () =>
  useQuery({ queryKey: ["notifications", "unread-count"] as const, queryFn: () => unwrap(api.GET("/v1/notifications/unread-count")), staleTime: 30_000 });

/** Latest prices for several commodities at once (one cached query each, shared with the commodity pages). */
export function useLatestMany(ids: string[], cc: string, pt: PriceType = "wholesale") {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: qk.latest(id, cc, pt),
      queryFn: () => unwrap(api.GET("/v1/prices/latest", { params: { query: { commodity_id: id, country: cc, price_type: pt } } })),
      staleTime: 60_000, enabled: Boolean(cc && id),
    })),
  });
}

// ── Catalogue & insights ──
export const useCategories = () =>
  useQuery({ queryKey: ["categories"] as const, queryFn: () => unwrap(api.GET("/v1/commodity-categories")), staleTime: 3_600_000 });

export const useSeasonal = (id: string, cc: string, market?: string) =>
  useQuery({
    queryKey: ["seasonal", id, cc, market ?? "all"] as const,
    queryFn: () => unwrap(api.GET("/v1/insights/seasonal", { params: { query: { commodity_id: id, country: cc, market_id: market } } })),
    staleTime: 3_600_000, enabled: Boolean(id && cc),
  });

/** Follow / unfollow a commodity by rewriting the interests list (PUT replaces it), keeping markets and topics. */
export function useToggleFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, follow, current }: { id: string; follow: boolean; current: S["Interests"] | undefined }) => {
      const ids = new Set(current?.commodityIds ?? []);
      if (follow) ids.add(id); else ids.delete(id);
      return unwrap(api.PUT("/v1/me/interests", { body: { ...current, commodityIds: [...ids] } }));
    },
    onSuccess: (v) => qc.setQueryData(["me", "interests"], v),
  });
}

// ── Geo: regions, heatmap, nearby ──
export const useRegions = (cc: string) =>
  useQuery({ queryKey: ["regions", cc] as const, queryFn: () => unwrap(api.GET("/v1/regions", { params: { query: { country: cc } } })), staleTime: 86_400_000, enabled: Boolean(cc) });

export const useRegionsGeo = (cc: string) =>
  useQuery({ queryKey: ["regions-geo", cc] as const, queryFn: () => unwrap(api.GET("/v1/regions/geojson", { params: { query: { country: cc } } })), staleTime: 86_400_000, enabled: Boolean(cc) });

export const useChoropleth = (cc: string, commodityId: string, days: number) =>
  useQuery({
    queryKey: ["choropleth", cc, commodityId, days] as const,
    queryFn: () => unwrap(api.GET("/v1/regions/choropleth", { params: { query: { country: cc, commodity_id: commodityId, days } } })),
    staleTime: 600_000, placeholderData: keepPreviousData, enabled: Boolean(cc && commodityId),
  });

export const useNearby = (p: { lat: number | null; lng: number | null; radiusKm: number; commodityId?: string }) =>
  useQuery({
    queryKey: ["nearby", p.lat, p.lng, p.radiusKm, p.commodityId ?? ""] as const,
    queryFn: () => unwrap(api.GET("/v1/markets/nearby", { params: { query: { lat: p.lat!, lng: p.lng!, radius_km: p.radiusKm, commodity_id: p.commodityId, limit: 50 } } })),
    staleTime: 300_000, placeholderData: keepPreviousData, enabled: p.lat != null && p.lng != null,
  });

// ── Alerts history & notifications inbox ──
export const useAlertHistory = (alertId?: string) =>
  useInfiniteQuery({
    queryKey: ["alerts", "history", alertId ?? ""] as const,
    queryFn: ({ pageParam }) => unwrap(api.GET("/v1/alerts/history", { params: { query: { alert_id: alertId, cursor: pageParam || undefined, limit: 20 } } })),
    initialPageParam: "", getNextPageParam: (p) => p.nextCursor ?? undefined,
  });

type NotificationCategory = S["NotificationCategory"];
export const useInbox = (opts: { category?: NotificationCategory; unread?: boolean }) =>
  useInfiniteQuery({
    queryKey: ["notifications", "inbox", opts.category ?? "", opts.unread ?? false] as const,
    queryFn: ({ pageParam }) => unwrap(api.GET("/v1/notifications", { params: { query: { category: opts.category, unread: opts.unread || undefined, cursor: pageParam || undefined, limit: 20 } } })),
    initialPageParam: "", getNextPageParam: (p) => p.nextCursor ?? undefined, staleTime: 30_000,
  });

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.POST("/v1/notifications/{id}/read", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (category?: NotificationCategory) => unwrap(api.POST("/v1/notifications/read-all", { params: { query: { category } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export const useNotificationPrefs = () =>
  useQuery({ queryKey: ["notifications", "preferences"] as const, queryFn: () => unwrap(api.GET("/v1/notifications/preferences")) });

export function useSaveNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S["NotificationPreferences"]) => unwrap(api.PUT("/v1/notifications/preferences", { body })),
    onSuccess: (v) => { if (v) qc.setQueryData(["notifications", "preferences"], v); },
  });
}

// ── Insights ──
export const useRecommendations = (commodityId: string, marketId: string) =>
  useQuery({
    queryKey: ["insights", "recommendations", commodityId, marketId] as const,
    queryFn: () => unwrap(api.GET("/v1/insights/recommendations", { params: { query: { commodity_id: commodityId, market_id: marketId } } })),
    staleTime: 600_000, enabled: Boolean(commodityId && marketId), retry: noRetryOn402,
  });

export const useAlternativeMarkets = (commodityId: string, marketId: string, radiusKm: number, transportCost?: number) =>
  useQuery({
    queryKey: ["insights", "alternatives", commodityId, marketId, radiusKm, transportCost ?? null] as const,
    queryFn: () => unwrap(api.GET("/v1/insights/alternative-markets", { params: { query: { commodity_id: commodityId, market_id: marketId, radius_km: radiusKm, transport_cost_per_kg_km: transportCost } } })),
    staleTime: 600_000, placeholderData: keepPreviousData, enabled: Boolean(commodityId && marketId), retry: noRetryOn402,
  });

export const usePlanting = (regionId: string, month: number) =>
  useQuery({
    queryKey: ["insights", "planting", regionId, month] as const,
    queryFn: () => unwrap(api.GET("/v1/insights/planting", { params: { query: { region_id: regionId, month } } })),
    staleTime: 3_600_000, enabled: Boolean(regionId), retry: noRetryOn402,
  });

export const useWeather = (lat: number | null, lng: number | null, commodityIds: string[]) =>
  useQuery({
    queryKey: ["insights", "weather", lat, lng, commodityIds.join(",")] as const,
    queryFn: () => unwrap(api.GET("/v1/insights/weather", { params: { query: { lat: lat!, lng: lng!, commodity_ids: commodityIds.length ? commodityIds : undefined } } })),
    staleTime: 1_800_000, enabled: lat != null && lng != null,
  });

export const useExportInsights = (commodityId: string, cc: string, destination?: string) =>
  useQuery({
    queryKey: ["insights", "export", commodityId, cc, destination ?? ""] as const,
    queryFn: () => unwrap(api.GET("/v1/insights/export", { params: { query: { commodity_id: commodityId, country: cc, destination } } })),
    staleTime: 3_600_000, placeholderData: keepPreviousData, enabled: Boolean(commodityId && cc), retry: noRetryOn402,
  });

/** A 402 (plan doesn't include this) won't change on retry; other failures get the default retries. */
function noRetryOn402(count: number, err: unknown) {
  return !(err && typeof err === "object" && "status" in err && (err as { status: number }).status === 402) && count < 3;
}

// ── Reports & data explorer ──
const PENDING = new Set(["queued", "running"]);

/** Report jobs, newest first. Re-polls every 4 s while any job on screen is still queued or running. */
export const useReportJobs = () =>
  useInfiniteQuery({
    queryKey: ["reports"] as const,
    queryFn: ({ pageParam }) => unwrap(api.GET("/v1/reports", { params: { query: { cursor: pageParam || undefined, limit: 20 } } })),
    initialPageParam: "", getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: (q) => (q.state.data?.pages.some((pg) => pg.data.some((j) => PENDING.has(j.status))) ? 4_000 : false),
  });

export function useCreateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S["ReportCreate"]) => unwrap(api.POST("/v1/reports", { body, headers: { "Idempotency-Key": idempotencyKey() } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reports"] }),
  });
}

export const useSubscription = () =>
  useQuery({ queryKey: ["billing", "subscription"] as const, queryFn: () => unwrap(api.GET("/v1/billing/subscription")), staleTime: 300_000 });

/** History for several commodities at once (explorer); each shares the cache with the commodity pages. */
export function useHistoryMany(ids: string[], cc: string, range: Range, market?: string, interval: "day" | "week" = "day") {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: [...qk.history(id, cc, range, market), interval] as const,
      queryFn: () => unwrap(api.GET("/v1/prices/history", { params: { query: { commodity_id: id, country: cc, range, market_id: market, interval } } })),
      staleTime: 300_000, enabled: Boolean(id && cc),
    })),
  });
}

// ── Billing ──
export const usePlans = (cc: string) =>
  useQuery({ queryKey: ["billing", "plans", cc] as const, queryFn: () => unwrap(api.GET("/v1/billing/plans", { params: { query: { country: cc } } })), staleTime: 3_600_000, enabled: Boolean(cc) });

export const useCheckout = () => useMutation({ mutationFn: (body: S["BillingCheckout"]) => unwrap(api.POST("/v1/billing/checkout", { body })) });

export function useCancelSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/v1/billing/cancel")),
    onSuccess: (v) => { if (v) qc.setQueryData(["billing", "subscription"], v); },
  });
}
