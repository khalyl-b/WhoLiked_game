"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicRoomState } from "@/features/game/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const FALLBACK_POLL_MS = 10_000;
const DEADLINE_REFRESH_GRACE_MS = 175;

export function useRoomState(code: string) {
  const [state, setState] = useState<PublicRoomState | null>(null);
  const [error, setError] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const failures = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(code)}/state`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        const message = data.error || "Could not sync room.";
        if ([401, 403, 404].includes(response.status)) {
          failures.current = 0;
          setState(null);
          setError(message);
          setReconnecting(false);
          return;
        }
        throw new Error(message);
      }
      failures.current = 0;
      setState(data);
      setError("");
      setReconnecting(false);
    } catch (cause) {
      failures.current += 1;
      if (failures.current > 1) setReconnecting(true);
      setError(cause instanceof Error ? cause.message : "Could not sync room.");
    }
  }, [code]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), FALLBACK_POLL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (!state) return;

    const target = state.round?.status === "ACTIVE"
      ? state.round.answerDeadline
      : state.round?.status === "REVEAL"
        ? state.room.revealEndsAt
        : undefined;

    if (!target) return;

    const serverOffsetMs = new Date(state.serverTime).getTime() - Date.now();
    const delayMs = Math.max(
      DEADLINE_REFRESH_GRACE_MS,
      new Date(target).getTime() - (Date.now() + serverOffsetMs) + DEADLINE_REFRESH_GRACE_MS,
    );

    const timer = window.setTimeout(() => void refresh(), delayMs);
    return () => window.clearTimeout(timer);
  }, [state, refresh]);

  const roomId = state?.room.id;

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    let channel = supabase
      .channel(`room-ui-${code}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `code=eq.${code}` }, () => void refresh());

    if (roomId) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_players", filter: `room_id=eq.${roomId}` },
        () => void refresh(),
      );
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "round_end_votes", filter: `room_id=eq.${roomId}` },
        () => void refresh(),
      );
    }

    channel = channel.subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setReconnecting(true);
      if (status === "SUBSCRIBED") {
        setReconnecting(false);
        void refresh();
      }
    });
    return () => { void supabase.removeChannel(channel); };
  }, [code, refresh, roomId]);

  return { state, error, reconnecting, refresh };
}
