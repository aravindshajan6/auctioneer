"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { useLotLive } from "@/lib/realtime/store";
import { sendChat } from "@/lib/realtime/use-socket";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The gateway truncates at 280 and rate-limits; say so before it bites. */
const MAX_LENGTH = 280;

/**
 * Saleroom chatter.
 *
 * Chat is the one thing browsers send *up* the socket, and it is the only
 * place identity is required — the gateway drops messages from anonymous
 * sockets, so a signed-out viewer gets a read-only room rather than an input
 * that silently does nothing.
 */
export function ChatPanel({
  auctionId,
  viewerId,
  signInHref,
  className,
}: {
  auctionId: string;
  viewerId: string | null;
  signInHref: string;
  className?: string;
}) {
  const live = useLotLive(auctionId);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);

  // Follow the conversation, unless the viewer has scrolled back to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinned.current) return;
    el.scrollTop = el.scrollHeight;
  }, [live.chat.length]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim().slice(0, MAX_LENGTH);
    if (!body || !viewerId) return;
    sendChat(auctionId, body);
    setDraft("");
    pinned.current = true;
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
        aria-live="polite"
        aria-label="Saleroom chat"
      >
        {live.chat.length === 0 ? (
          <p className="py-8 text-center text-xs text-ash">
            The room is quiet. Say hello, or ask the specialist about the lot.
          </p>
        ) : (
          live.chat.map((message) => (
            <div key={message.id} className="flex gap-2.5">
              <Avatar name={message.userName} size={26} />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-xs font-medium",
                    message.userId === viewerId ? "text-gild-200" : "text-fog",
                  )}
                >
                  {message.userName}
                </p>
                <p className="text-sm leading-snug break-words text-linen">{message.body}</p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-pewter/40 p-3">
        {viewerId ? (
          <form onSubmit={submit} className="flex items-center gap-2">
            <label htmlFor="chat-input" className="sr-only">
              Message the saleroom
            </label>
            <input
              id="chat-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, MAX_LENGTH))}
              maxLength={MAX_LENGTH}
              placeholder="Message the room…"
              autoComplete="off"
              className="h-10 min-w-0 flex-1 rounded-full border border-pewter/60 bg-obsidian/70 px-4 text-sm text-linen placeholder:text-ash focus:border-gild-500/70"
            />
            <Button
              type="submit"
              variant="outline"
              size="icon"
              disabled={draft.trim().length === 0}
              aria-label="Send message"
            >
              <Send className="size-4" aria-hidden />
            </Button>
          </form>
        ) : (
          <p className="text-center text-xs text-ash">
            <Link href={signInHref} className="text-gild-300 underline-offset-4 hover:underline">
              Sign in
            </Link>{" "}
            to join the conversation.
          </p>
        )}
      </div>
    </div>
  );
}
