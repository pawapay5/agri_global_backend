"use client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  useQuery({ queryKey: qk.snapshot(cc), queryFn: () => unwrap(api.GET("/v1/dashboard/snapshot", { params: { query: { country: cc } } })), staleTime: 60_000 });

export const useTrending = (cc: string) =>
  useQuery({ queryKey: qk.trending(cc), queryFn: () => unwrap(api.GET("/v1/prices/trending", { params: { query: { country: cc, limit: 8 } } })), staleTime: 60_000 });

export const useCommodities = (cc: string) =>
  useQuery({ queryKey: qk.commodities(cc), queryFn: () => unwrap(api.GET("/v1/commodities", { params: { query: { country: cc, limit: 100 } } })), staleTime: 3_600_000 });

export const useCommodity = (id: string, cc: string) =>
  useQuery({ queryKey: qk.commodity(id, cc), queryFn: () => unwrap(api.GET("/v1/commodities/{id}", { params: { path: { id }, query: { country: cc } } })), staleTime: 3_600_000 });

export const useMarkets = (cc: string) =>
  useQuery({ queryKey: qk.markets(cc), queryFn: () => unwrap(api.GET("/v1/markets", { params: { query: { country: cc, limit: 100 } } })), staleTime: 3_600_000 });

export const useLatest = (id: string, cc: string, pt: PriceType = "wholesale") =>
  useQuery({ queryKey: qk.latest(id, cc, pt), queryFn: () => unwrap(api.GET("/v1/prices/latest", { params: { query: { commodity_id: id, country: cc, price_type: pt } } })), staleTime: 60_000 });

export const useHistory = (id: string, cc: string, range: Range, market?: string) =>
  useQuery({
    queryKey: qk.history(id, cc, range, market),
    queryFn: () => unwrap(api.GET("/v1/prices/history", { params: { query: { commodity_id: id, country: cc, range, market_id: market, interval: range === "1Y" || range === "ALL" ? "week" : "day" } } })),
    placeholderData: keepPreviousData, staleTime: 300_000,
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
