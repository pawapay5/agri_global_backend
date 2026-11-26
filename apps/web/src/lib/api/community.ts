"use client";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, idempotencyKey, unwrap, type S } from "./browser";

/** Hooks for the community feed and the farmer tools (knowledge base, calculators, market intel). */

const asForm = { bodySerializer: (b: unknown) => b as FormData };

// ── Community ──
export type FeedFilters = { type?: S["PostType"]; commodityId?: string };
export const useFeed = (cc: string, f: FeedFilters) =>
  useInfiniteQuery({
    queryKey: ["community", "feed", cc, f] as const,
    queryFn: ({ pageParam }) => unwrap(api.GET("/v1/community/feed", { params: { query: { country: cc, type: f.type, commodity_id: f.commodityId, cursor: pageParam || undefined, limit: 20 } } })),
    initialPageParam: "", getNextPageParam: (p) => p.nextCursor ?? undefined, placeholderData: keepPreviousData, enabled: Boolean(cc),
  });

export const usePost = (id: string) =>
  useQuery({ queryKey: ["community", "post", id] as const, queryFn: () => unwrap(api.GET("/v1/community/posts/{id}", { params: { path: { id } } })), enabled: Boolean(id) });

export const useComments = (id: string) =>
  useQuery({ queryKey: ["community", "post", id, "comments"] as const, queryFn: () => unwrap(api.GET("/v1/community/posts/{id}/comments", { params: { path: { id } } })), enabled: Boolean(id) });

export function useCreatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, photos }: { body: S["PostCreate"]; photos: File[] }) => {
      const post = await unwrap(api.POST("/v1/community/posts", { body }));
      // Photos attach after the post exists; a failed photo doesn't lose the post.
      for (const file of photos) {
        const fd = new FormData();
        fd.append("file", file);
        await unwrap(api.POST("/v1/community/posts/{id}/photos", { params: { path: { id: post.id! } }, body: fd as never, ...asForm })).catch(() => undefined);
      }
      return post;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["community", "feed"] }),
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE("/v1/community/posts/{id}", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["community"] }),
  });
}

export function useReact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, type }: { id: string; type: "like" | "helpful" | "insightful" | null }) =>
      unwrap(type ? api.PUT("/v1/community/posts/{id}/reaction", { params: { path: { id } }, body: { type } }) : api.DELETE("/v1/community/posts/{id}/reaction", { params: { path: { id } } })),
    onSuccess: (_v, { id }) => { void qc.invalidateQueries({ queryKey: ["community", "feed"] }); void qc.invalidateQueries({ queryKey: ["community", "post", id] }); },
  });
}

export const useSharePost = () => useMutation({ mutationFn: (id: string) => unwrap(api.POST("/v1/community/posts/{id}/share", { params: { path: { id } } })) });

export function useComment(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S["CommentCreate"]) => unwrap(api.POST("/v1/community/posts/{id}/comments", { params: { path: { id: postId } }, body })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["community", "post", postId] }); },
  });
}

export function useAcceptAnswer(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => unwrap(api.POST("/v1/community/posts/{id}/accept-answer", { params: { path: { id: postId } }, body: { commentId } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["community", "post", postId] }),
  });
}

export const useCommunityProfile = (id: string) =>
  useQuery({ queryKey: ["community", "user", id] as const, queryFn: () => unwrap(api.GET("/v1/community/users/{id}", { params: { path: { id } } })), enabled: Boolean(id) });

export function useFollow(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => unwrap(on ? api.POST("/v1/community/users/{id}/follow", { params: { path: { id } } }) : api.DELETE("/v1/community/users/{id}/follow", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["community", "user", id] }),
  });
}

// ── Farmer tools ──
export const useSubmitPrice = () =>
  useMutation({ mutationFn: (body: S["PriceSubmission"]) => unwrap(api.POST("/v1/prices/submissions", { body, headers: { "Idempotency-Key": idempotencyKey() } })) });

export const useFertiliserPlan = () =>
  useMutation({ mutationFn: (body: S["FertiliserRequest"]) => unwrap(api.POST("/v1/knowledge/fertiliser/calculate", { body })) });

export const useCropGuides = (cc: string, commodityId?: string) =>
  useQuery({ queryKey: ["knowledge", "guides", cc, commodityId ?? ""] as const, queryFn: () => unwrap(api.GET("/v1/knowledge/crop-guides", { params: { query: { country: cc, commodity_id: commodityId } } })), enabled: Boolean(cc), staleTime: 3_600_000 });
export const useCropGuide = (id: string) =>
  useQuery({ queryKey: ["knowledge", "guide", id] as const, queryFn: () => unwrap(api.GET("/v1/knowledge/crop-guides/{id}", { params: { path: { id } } })), enabled: Boolean(id), staleTime: 3_600_000 });

export type PestFilters = { commodityId?: string; kind?: "pest" | "disease" | "weed" | "deficiency"; q?: string };
export const usePests = (cc: string, f: PestFilters) =>
  useQuery({ queryKey: ["knowledge", "pests", cc, f] as const, queryFn: () => unwrap(api.GET("/v1/knowledge/pests", { params: { query: { country: cc, commodity_id: f.commodityId, kind: f.kind, q: f.q || undefined } } })), staleTime: 3_600_000, placeholderData: keepPreviousData });
export const usePest = (id: string) =>
  useQuery({ queryKey: ["knowledge", "pest", id] as const, queryFn: () => unwrap(api.GET("/v1/knowledge/pests/{id}", { params: { path: { id } } })), enabled: Boolean(id), staleTime: 3_600_000 });

export const useProgrammes = (cc: string, open?: boolean) =>
  useQuery({ queryKey: ["knowledge", "programmes", cc, open ?? null] as const, queryFn: () => unwrap(api.GET("/v1/knowledge/programmes", { params: { query: { country: cc, open } } })), enabled: Boolean(cc), staleTime: 3_600_000 });

export const useTraining = (cc: string, kind?: "article" | "event" | "video" | "course", upcoming?: boolean) =>
  useQuery({ queryKey: ["knowledge", "training", cc, kind ?? "", upcoming ?? null] as const, queryFn: () => unwrap(api.GET("/v1/knowledge/training", { params: { query: { country: cc, kind, upcoming } } })), staleTime: 3_600_000 });

export type SupplierCategory = "seed" | "fertiliser" | "agrochemical" | "equipment" | "feed" | "veterinary" | "irrigation" | "packaging";
export const useSuppliers = (cc: string, f: { category?: SupplierCategory; regionId?: string; lat?: number | null; lng?: number | null }) =>
  useQuery({
    queryKey: ["knowledge", "suppliers", cc, f] as const,
    queryFn: () => unwrap(api.GET("/v1/knowledge/suppliers", { params: { query: { country: cc, category: f.category, region_id: f.regionId, lat: f.lat ?? undefined, lng: f.lng ?? undefined, limit: 50 } } })),
    enabled: Boolean(cc), staleTime: 3_600_000, placeholderData: keepPreviousData,
  });

export const useDemand = (cc: string, commodityId: string, weeks: number, regionId?: string) =>
  useQuery({ queryKey: ["intel", "demand", cc, commodityId, weeks, regionId ?? ""] as const, queryFn: () => unwrap(api.GET("/v1/market-intel/demand", { params: { query: { country: cc, commodity_id: commodityId, weeks, region_id: regionId } } })), enabled: Boolean(cc && commodityId), placeholderData: keepPreviousData, retry: no402 });
export const useSupply = (cc: string, commodityId: string) =>
  useQuery({ queryKey: ["intel", "supply", cc, commodityId] as const, queryFn: () => unwrap(api.GET("/v1/market-intel/supply", { params: { query: { country: cc, commodity_id: commodityId } } })), enabled: Boolean(cc && commodityId), retry: no402 });

function no402(n: number, e: unknown) { return !(e && typeof e === "object" && "status" in e && (e as { status: number }).status === 402) && n < 3; }
