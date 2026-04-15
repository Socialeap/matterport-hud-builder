/**
 * React hook that owns the RAG pipeline lifecycle.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, PipelineStatus } from "@/lib/rag/types";
import { RAGPipeline } from "@/lib/rag/rag-pipeline";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

interface UseRAGPipelineReturn {
  status: PipelineStatus;
  statusDetail: string;
  messages: ChatMessage[];
  ingest: (spec: string | Record<string, unknown>) => Promise<void>;
  ask: (question: string) => Promise<void>;
  reset: () => void;
}

export function useRAGPipeline(): UseRAGPipelineReturn {
  const pipelineRef = useRef<RAGPipeline | null>(null);
  const [status, setStatus] = useState<PipelineStatus>("idle");
  const [statusDetail, setStatusDetail] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Lazy-create the pipeline
  const getPipeline = useCallback(() => {
    if (!pipelineRef.current) {
      pipelineRef.current = new RAGPipeline(SUPABASE_URL, SUPABASE_ANON_KEY);
      pipelineRef.current.onStatus((s, detail) => {
        setStatus(s);
        setStatusDetail(detail ?? "");
      });
    }
    return pipelineRef.current;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      pipelineRef.current?.dispose();
      pipelineRef.current = null;
    };
  }, []);

  const ingest = useCallback(
    async (spec: string | Record<string, unknown>) => {
      await getPipeline().ingest(spec);
    },
    [getPipeline],
  );

  const ask = useCallback(
    async (question: string) => {
      const userMsg: ChatMessage = { role: "user", content: question };
      setMessages((prev) => [...prev, userMsg]);

      try {
        const answer = await getPipeline().query(question, [
          ...messages,
          userMsg,
        ]);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: answer },
        ]);
      } catch (err) {
        const errMsg =
          err instanceof Error ? err.message : "Something went wrong";
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Sorry, I encountered an error: ${errMsg}`,
          },
        ]);
      }
    },
    [getPipeline, messages],
  );

  const reset = useCallback(() => {
    pipelineRef.current?.dispose();
    pipelineRef.current = null;
    setMessages([]);
    setStatus("idle");
    setStatusDetail("");
  }, []);

  return { status, statusDetail, messages, ingest, ask, reset };
}
