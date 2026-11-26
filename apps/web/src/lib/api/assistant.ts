"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap, type S } from "./browser";

export type AssistantLanguage = S["AssistantLanguage"];
export type AssistantMessage = S["AssistantMessage"];

export const useAssistantStatus = () =>
  useQuery({ queryKey: ["assistant", "status"] as const, queryFn: () => unwrap(api.GET("/v1/assistant/status")), staleTime: 60_000 });

export const useAssistantHistory = () =>
  useQuery({ queryKey: ["assistant", "history"] as const, queryFn: () => unwrap(api.GET("/v1/assistant/messages")), staleTime: 30_000 });

/** A question by text, or by a WAV recording (local languages only). */
export function useAsk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (q: { language: AssistantLanguage; conversationId?: string | null } & ({ text: string } | { audio: Blob })) => {
      if ("audio" in q) {
        const fd = new FormData();
        fd.append("language", q.language);
        if (q.conversationId) fd.append("conversationId", q.conversationId);
        fd.append("audio", q.audio, "question.wav");
        return unwrap(api.POST("/v1/assistant/messages", { body: fd as never, bodySerializer: (b: unknown) => b as FormData }));
      }
      return unwrap(api.POST("/v1/assistant/messages", { body: { language: q.language, text: q.text, ...(q.conversationId ? { conversationId: q.conversationId } : {}) } }));
    },
    onSuccess: (m) => {
      qc.setQueryData(["assistant", "history"], (old: { conversationId: string | null; data: AssistantMessage[] } | undefined) =>
        ({ conversationId: m.conversationId, data: [...(old?.conversationId === m.conversationId ? old.data : []), m] }));
      void qc.invalidateQueries({ queryKey: ["assistant", "status"] });
    },
  });
}

export function useClearAssistant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.DELETE("/v1/assistant/messages")),
    onSuccess: () => qc.setQueryData(["assistant", "history"], { conversationId: null, data: [] }),
  });
}

export function useTranslate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { text: string; from: AssistantLanguage; to: AssistantLanguage }) => unwrap(api.POST("/v1/assistant/translate", { body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["assistant", "status"] }),
  });
}

/** Same-origin audio URL: the BFF adds the session, so the <audio> element needs no token. */
export const answerAudioUrl = (id: string) => `/api/v1/assistant/messages/${encodeURIComponent(id)}/audio`;
