"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, idempotencyKey, unwrap, type S } from "./browser";

/** Organisation (members, roles, invitations) and developer API keys. */

export const useOrg = () =>
  useQuery({
    queryKey: ["org"] as const, queryFn: () => unwrap(api.GET("/v1/org")),
    // 404 = the user isn't in an organisation; that's an answer, not a failure to retry.
    retry: (n, e) => !(e && typeof e === "object" && "status" in e && (e as { status: number }).status === 404) && n < 2,
  });

export function useRenameOrg() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (name: string) => unwrap(api.PATCH("/v1/org", { body: { name } })), onSuccess: (v) => { if (v) qc.setQueryData(["org"], v); } });
}

export const useOrgMembers = (enabled = true) => useQuery({ queryKey: ["org", "members"] as const, queryFn: () => unwrap(api.GET("/v1/org/members")), enabled });

export function useSetMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: S["OrgRole"] }) => unwrap(api.PATCH("/v1/org/members/{userId}", { params: { path: { userId } }, body: { role } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org"] }),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => unwrap(api.DELETE("/v1/org/members/{userId}", { params: { path: { userId } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org"] }),
  });
}

export const useOrgInvites = (enabled = true) => useQuery({ queryKey: ["org", "invites"] as const, queryFn: () => unwrap(api.GET("/v1/org/invites")), enabled });

export function useInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: S["OrgInviteCreate"]) => unwrap(api.POST("/v1/org/invites", { body, headers: { "Idempotency-Key": idempotencyKey() } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org"] }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => unwrap(api.DELETE("/v1/org/invites/{id}", { params: { path: { id } } })), onSuccess: () => qc.invalidateQueries({ queryKey: ["org"] }) });
}

export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => unwrap(api.POST("/v1/org/invites/accept", { body: { token } })),
    onSuccess: (v) => { if (v) qc.setQueryData(["org"], v); void qc.invalidateQueries({ queryKey: ["me"] }); void qc.invalidateQueries({ queryKey: ["billing"] }); },
  });
}

// ── Developer API keys ──
export const useApiKeys = () => useQuery({ queryKey: ["api-keys"] as const, queryFn: () => unwrap(api.GET("/v1/api-keys")) });

export function useCreateApiKey() {
  const qc = useQueryClient();
  // The secret is only in this response: it's never cached in the query client.
  return useMutation({ mutationFn: (name: string) => unwrap(api.POST("/v1/api-keys", { body: { name } })), onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }) });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => unwrap(api.DELETE("/v1/api-keys/{id}", { params: { path: { id } } })), onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }) });
}
