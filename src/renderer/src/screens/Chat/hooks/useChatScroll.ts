import { useCallback, useEffect, useRef } from "react";
import type { ChatMessage } from "../types";

/**
 * Auto-scroll behavior for the chat messages container.
 *
 * - Tracks whether the user has manually scrolled up; pauses auto-scroll in that case.
 * - Re-engages auto-scroll when a new user message is sent.
 * - Exposes the container ref and a bottom sentinel ref to be placed in JSX.
 */
// @lat: [[chat-performance#Streaming auto-scroll stays instant]]
export function useChatScroll(messages: ChatMessage[]): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const prevMessageCountRef = useRef(messages.length);

  const scrollToBottom = useCallback(
    (options?: { force?: boolean; behavior?: ScrollBehavior }) => {
      if (!options?.force && userScrolledUpRef.current) return;
      const container = containerRef.current;
      if (!container) return;
      // Instant scroll during streaming — smooth scroll on every chunk stacks
      // competing animations and makes the transcript jitter.
      if (options?.behavior === "smooth") {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
        return;
      }
      container.scrollTop = container.scrollHeight;
    },
    [],
  );

  // Track manual scroll position
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    function handleScroll(): void {
      const el = container!;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      userScrolledUpRef.current = !atBottom;
    }
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-scroll on incoming messages; force-scroll when user sends a new one
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    const userJustSent =
      messages.length > prevCount &&
      messages[messages.length - 1]?.role === "user";
    if (userJustSent) {
      userScrolledUpRef.current = false;
      scrollToBottom({ force: true, behavior: "smooth" });
    } else {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  return { containerRef, bottomRef };
}
