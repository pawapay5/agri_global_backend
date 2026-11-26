"use client";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, idempotencyKey, unwrap, type S } from "./browser";

/**
 * Hooks for messages, marketplace, orders, seller centre, wallet, disputes and moderation.
 * Kept apart from queries.ts so that module stays about prices and insights.
 */

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
/** Poll only while the tab is visible (no realtime socket yet; see the messages feature). */
const pollWhileVisible = (ms: number) => () => (visible() ? ms : false);

/** Multipart upload through the BFF: the browser sets the boundary; CSRF is added by the client middleware. */
function form(fields: Record<string, string | Blob | undefined>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, v);
  return fd;
}
const asForm = { bodySerializer: (b: unknown) => b as FormData };

// ── Messages ──
export const useConversations = () =>
  useInfiniteQuery({
    queryKey: ["conversations"] as const,
    queryFn: ({ pageParam }) => unwrap(api.GET("/v1/conversations", { params: { query: { cursor: pageParam || undefined, limit: 30 } } })),
    initialPageParam: "", getNextPageParam: (p) => p.nextCursor ?? undefined, refetchInterval: pollWhileVisible(15_000),
  });

export const useMessages = (id: string) =>
  useInfiniteQuery({
    queryKey: ["conversations", id, "messages"] as const,
    queryFn: ({ pageParam }) => unwrap(api.GET("/v1/conversations/{id}/messages", { params: { path: { id }, query: { cursor: pageParam || undefined, limit: 40 } } })),
    initialPageParam: "", getNextPageParam: (p) => p.nextCursor ?? undefined, refetchInterval: pollWhileVisible(4_000), enabled: Boolean(id),
  });

export function useSendMessage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S["MessageSend"]) => unwrap(api.POST("/v1/conversations/{id}/messages", { params: { path: { id } }, body })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["conversations", id, "messages"] }); void qc.invalidateQueries({ queryKey: ["conversations"], exact: true }); },
  });
}

export function useSendImage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => unwrap(api.POST("/v1/conversations/{id}/images", { params: { path: { id } }, body: form({ file, clientId: crypto.randomUUID() }) as never, ...asForm })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations", id, "messages"] }),
  });
}

export function useMarkConversationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.POST("/v1/conversations/{id}/read", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"], exact: true }),
  });
}

export const useStartConversation = () =>
  useMutation({ mutationFn: (body: S["ConversationCreate"]) => unwrap(api.POST("/v1/conversations", { body })) });

export const useBlockUser = () =>
  useMutation({ mutationFn: ({ id, block }: { id: string; block: boolean }) => unwrap(block ? api.POST("/v1/users/{id}/block", { params: { path: { id } } }) : api.DELETE("/v1/users/{id}/block", { params: { path: { id } } })) });

export const useReportAbuse = () =>
  useMutation({ mutationFn: (body: S["AbuseReport"]) => unwrap(api.POST("/v1/moderation/reports", { body })) });

// ── Listings (buyer side) ──
export type ListingFilters = { q?: string; type?: "product" | "service"; commodityId?: string; regionId?: string; minPrice?: number; maxPrice?: number; sort?: "recent" | "lowest" | "highest" | "nearest" };
export const useListings = (cc: string, f: ListingFilters) =>
  useInfiniteQuery({
    queryKey: ["listings", cc, f] as const,
    queryFn: ({ pageParam }) => unwrap(api.GET("/v1/marketplace/listings", { params: { query: {
      country: cc, q: f.q || undefined, type: f.type, commodity_id: f.commodityId, region_id: f.regionId, min_price: f.minPrice, max_price: f.maxPrice, sort: f.sort, cursor: pageParam || undefined, limit: 24,
    } } })),
    initialPageParam: "", getNextPageParam: (p) => p.nextCursor ?? undefined, placeholderData: keepPreviousData, enabled: Boolean(cc),
  });

export const useListing = (id: string) =>
  useQuery({ queryKey: ["listing", id] as const, queryFn: () => unwrap(api.GET("/v1/marketplace/listings/{id}", { params: { path: { id } } })), enabled: Boolean(id) });

export const useSeller = (id: string | undefined) =>
  useQuery({ queryKey: ["seller", id] as const, queryFn: () => unwrap(api.GET("/v1/marketplace/sellers/{id}", { params: { path: { id: id! } } })), enabled: Boolean(id), staleTime: 300_000 });

export const useSellerReviews = (id: string | undefined) =>
  useQuery({ queryKey: ["seller", id, "reviews"] as const, queryFn: () => unwrap(api.GET("/v1/marketplace/sellers/{id}/reviews", { params: { path: { id: id! }, query: { limit: 5 } } })), enabled: Boolean(id), staleTime: 300_000 });

export function useFavourite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => unwrap(on ? api.POST("/v1/marketplace/listings/{id}/favourite", { params: { path: { id } } }) : api.DELETE("/v1/marketplace/listings/{id}/favourite", { params: { path: { id } } })),
    onSuccess: (_v, { id }) => { void qc.invalidateQueries({ queryKey: ["listing", id] }); void qc.invalidateQueries({ queryKey: ["favourites"] }); },
  });
}

export const useFavourites = () =>
  useQuery({ queryKey: ["favourites"] as const, queryFn: () => unwrap(api.GET("/v1/marketplace/favourites", { params: { query: { limit: 50 } } })) });

// ── Offers ──
export function useMakeOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ listingId, body }: { listingId: string; body: S["OfferCreate"] }) => unwrap(api.POST("/v1/marketplace/listings/{id}/offers", { params: { path: { id: listingId } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["offers"] }),
  });
}

export const useOffers = (role: "buyer" | "seller", status?: string) =>
  useQuery({ queryKey: ["offers", role, status ?? ""] as const, queryFn: () => unwrap(api.GET("/v1/marketplace/offers", { params: { query: { role, status: status as never } } })) });

export function useRespondOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: S["OfferResponse"] }) => unwrap(api.POST("/v1/marketplace/offers/{id}/respond", { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["offers"] }),
  });
}

// ── Cart, checkout, orders, payment ──
export const useCart = () => useQuery({ queryKey: ["cart"] as const, queryFn: () => unwrap(api.GET("/v1/marketplace/cart")) });

export function useUpsertCartItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S["CartItemUpsert"]) => unwrap(api.PUT("/v1/marketplace/cart/items", { body })),
    onSuccess: (v) => { if (v) qc.setQueryData(["cart"], v); },
  });
}

export function useRemoveCartItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE("/v1/marketplace/cart/items/{id}", { params: { path: { id } } })),
    onSuccess: (v) => { if (v) qc.setQueryData(["cart"], v); },
  });
}

export function useCheckoutCart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S["CheckoutRequest"]) => unwrap(api.POST("/v1/marketplace/checkout", { body, headers: { "Idempotency-Key": idempotencyKey() } })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["cart"] }); void qc.invalidateQueries({ queryKey: ["orders"] }); },
  });
}

export const useOrders = (role: "buyer" | "seller", status?: S["OrderStatus"]) =>
  useInfiniteQuery({
    queryKey: ["orders", role, status ?? ""] as const,
    queryFn: ({ pageParam }) => unwrap(api.GET("/v1/marketplace/orders", { params: { query: { role, status, cursor: pageParam || undefined, limit: 20 } as never } })),
    initialPageParam: "", getNextPageParam: (p) => p.nextCursor ?? undefined,
  });

export const useOrder = (id: string) =>
  useQuery({
    queryKey: ["order", id] as const, queryFn: () => unwrap(api.GET("/v1/marketplace/orders/{id}", { params: { path: { id } } })), enabled: Boolean(id),
    // Payment and delivery confirmations arrive by webhook; keep an open order fresh while it can still change.
    refetchInterval: (q) => (q.state.data && ["pending_payment", "paid_in_escrow", "accepted", "in_transit", "delivered", "disputed"].includes(q.state.data.status ?? "") ? pollWhileVisible(10_000)() : false),
  });

export function useOrderTransition(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S["OrderTransition"]) => unwrap(api.POST("/v1/marketplace/orders/{id}/transition", { params: { path: { id } }, body })),
    onSuccess: (v) => { if (v) qc.setQueryData(["order", id], v); void qc.invalidateQueries({ queryKey: ["orders"] }); },
  });
}

export const usePayOrder = (id: string) =>
  useMutation({ mutationFn: (body: S["PayRequest"]) => unwrap(api.POST("/v1/payments/orders/{id}/pay", { params: { path: { id } }, body, headers: { "Idempotency-Key": idempotencyKey() } })) });

export const usePaymentMethods = () => useQuery({ queryKey: ["payment-methods"] as const, queryFn: () => unwrap(api.GET("/v1/payments/methods")) });

export function useReviewOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S["ReviewCreate"]) => unwrap(api.POST("/v1/marketplace/orders/{id}/review", { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["order", id] }),
  });
}

// ── Disputes ──
export const useDispute = (id: string) =>
  useQuery({ queryKey: ["dispute", id] as const, queryFn: () => unwrap(api.GET("/v1/disputes/{id}", { params: { path: { id } } })), enabled: Boolean(id), refetchInterval: pollWhileVisible(30_000) });

export function useAddEvidence(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ note, file }: { note?: string; file?: File }) => unwrap(api.POST("/v1/disputes/{id}/evidence", { params: { path: { id } }, body: form({ note: note || undefined, file }) as never, ...asForm })),
    onSuccess: (v) => { if (v) qc.setQueryData(["dispute", id], v); },
  });
}

// ── Seller centre ──
export const useSellerProfile = (enabled = true) =>
  useQuery({ queryKey: ["seller-profile"] as const, queryFn: () => unwrap(api.GET("/v1/marketplace/seller-profile")), enabled, staleTime: 300_000, retry: (n, e) => !(e && typeof e === "object" && "status" in e && (e as { status: number }).status === 404) && n < 2 });

export function useSaveSellerProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S["SellerProfileUpdate"]) => unwrap(api.PUT("/v1/marketplace/seller-profile", { body })),
    onSuccess: (v) => { if (v) qc.setQueryData(["seller-profile"], v); },
  });
}

export function useSubmitKyc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (f: { idType: string; idNumber: string; idPhoto: File; selfie: File }) => unwrap(api.POST("/v1/marketplace/seller-profile/kyc", { body: form(f) as never, ...asForm })),
    onSuccess: (v) => { if (v) qc.setQueryData(["seller-profile"], v); },
  });
}

export const useMyListings = (status?: S["ListingStatus"]) =>
  useInfiniteQuery({
    queryKey: ["listings", "mine", status ?? ""] as const,
    queryFn: ({ pageParam }) => unwrap(api.GET("/v1/marketplace/listings/mine", { params: { query: { status, cursor: pageParam || undefined, limit: 30 } } })),
    initialPageParam: "", getNextPageParam: (p) => p.nextCursor ?? undefined,
  });

export function useCreateListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S["ListingCreate"]) => unwrap(api.POST("/v1/marketplace/listings", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["listings", "mine"] }),
  });
}

export function useUpdateListing(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S["ListingUpdate"]) => unwrap(api.PATCH("/v1/marketplace/listings/{id}", { params: { path: { id } }, body })),
    onSuccess: (v) => { if (v) qc.setQueryData(["listing", id], v); void qc.invalidateQueries({ queryKey: ["listings", "mine"] }); },
  });
}

export function useListingPhotos(id: string) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["listing", id] });
  return {
    add: useMutation({ mutationFn: (file: File) => unwrap(api.POST("/v1/marketplace/listings/{id}/photos", { params: { path: { id } }, body: form({ file }) as never, ...asForm })), onSuccess: done }),
    remove: useMutation({ mutationFn: (photoId: string) => unwrap(api.DELETE("/v1/marketplace/listings/{id}/photos/{photoId}", { params: { path: { id, photoId } } })), onSuccess: done }),
  };
}

export const useWallet = () => useQuery({ queryKey: ["wallet"] as const, queryFn: () => unwrap(api.GET("/v1/wallet")) });
export const useLedger = () =>
  useInfiniteQuery({
    queryKey: ["wallet", "ledger"] as const,
    queryFn: ({ pageParam }) => unwrap(api.GET("/v1/wallet/ledger", { params: { query: { cursor: pageParam || undefined, limit: 25 } } })),
    initialPageParam: "", getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
export const usePayoutAccounts = () => useQuery({ queryKey: ["wallet", "accounts"] as const, queryFn: () => unwrap(api.GET("/v1/wallet/payout-accounts")) });
export const usePayouts = () => useQuery({ queryKey: ["wallet", "payouts"] as const, queryFn: () => unwrap(api.GET("/v1/wallet/payouts")) });

export function useAddPayoutAccount() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: S["PayoutAccountCreate"]) => unwrap(api.POST("/v1/wallet/payout-accounts", { body })), onSuccess: () => qc.invalidateQueries({ queryKey: ["wallet", "accounts"] }) });
}

export function useRequestPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S["PayoutRequest"]) => unwrap(api.POST("/v1/wallet/payouts", { body, headers: { "Idempotency-Key": idempotencyKey() } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wallet"] }),
  });
}

export type Period = "7d" | "30d" | "90d" | "365d";
export const useSellerSummary = (period: Period) =>
  useQuery({ queryKey: ["seller-analytics", "summary", period] as const, queryFn: () => unwrap(api.GET("/v1/seller/analytics/summary", { params: { query: { period } } })), placeholderData: keepPreviousData });
export const useSellerSeries = (metric: "revenue" | "orders" | "views" | "offers" | "kg_sold", period: Period) =>
  useQuery({ queryKey: ["seller-analytics", "series", metric, period] as const, queryFn: () => unwrap(api.GET("/v1/seller/analytics/timeseries", { params: { query: { metric, period, interval: period === "365d" ? "week" : "day" } } })), placeholderData: keepPreviousData });
export const useTopProducts = (period: Period) =>
  useQuery({ queryKey: ["seller-analytics", "top", period] as const, queryFn: () => unwrap(api.GET("/v1/seller/analytics/top-products", { params: { query: { period, limit: 10 } } })), placeholderData: keepPreviousData });

// ── Admin: moderation & disputes ──
export const useModerationQueue = (targetType?: S["ModerationTarget"]) =>
  useInfiniteQuery({
    queryKey: ["admin", "moderation", targetType ?? ""] as const,
    queryFn: ({ pageParam }) => unwrap(api.GET("/v1/admin/moderation", { params: { query: { target_type: targetType, cursor: pageParam || undefined, limit: 25 } } })),
    initialPageParam: "", getNextPageParam: (p) => p.nextCursor ?? undefined,
  });

export function useModerationDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: S["ModerationDecision"] }) => unwrap(api.POST("/v1/admin/moderation/{id}/decision", { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "moderation"] }),
  });
}

export const useAdminDisputes = (status?: "open" | "under_review" | "resolved") =>
  useInfiniteQuery({
    queryKey: ["admin", "disputes", status ?? ""] as const,
    queryFn: ({ pageParam }) => unwrap(api.GET("/v1/admin/disputes", { params: { query: { status, cursor: pageParam || undefined, limit: 25 } } })),
    initialPageParam: "", getNextPageParam: (p) => p.nextCursor ?? undefined,
  });

export function useDisputeDecision(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S["DisputeDecision"]) => unwrap(api.POST("/v1/admin/disputes/{id}/decision", { params: { path: { id } }, body })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["admin", "disputes"] }); void qc.invalidateQueries({ queryKey: ["dispute", id] }); },
  });
}
