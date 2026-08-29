"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "./events";
import { useRealtimeStore } from "./store";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * One socket for the whole tab.
 *
 * Socket.IO multiplexes rooms over a single connection, so opening one per
 * component would waste sockets and duplicate every event. The connection is
 * created lazily on first use and shared via this module-level handle.
 */
let shared: AppSocket | null = null;
let refCount = 0;

function getSocket(): AppSocket {
  if (!shared) {
    shared = io({
      path: "/ws",
      transports: ["polling", "websocket"],
      withCredentials: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5_000,
    });
  }
  return shared;
}

/** Connect the shared socket and wire it into the realtime store. */
export function useRealtimeConnection() {
  useEffect(() => {
    const socket = getSocket();
    refCount += 1;

    const store = useRealtimeStore.getState();
    const onConnect = () => store.setConnected(true);
    const onDisconnect = () => store.setConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("server:time", ({ now }) => useRealtimeStore.getState().setServerTime(now));
    socket.on("lot:state", (p) => useRealtimeStore.getState().applyState(p));
    socket.on("lot:bid", (p) => useRealtimeStore.getState().applyBid(p));
    socket.on("lot:closed", (p) => useRealtimeStore.getState().applyClosed(p));
    socket.on("lot:viewers", (p) => useRealtimeStore.getState().setViewers(p.auctionId, p.count));
    socket.on("chat:message", (p) => useRealtimeStore.getState().applyChat(p));

    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("server:time");
      socket.off("lot:state");
      socket.off("lot:bid");
      socket.off("lot:closed");
      socket.off("lot:viewers");
      socket.off("chat:message");
      refCount -= 1;
      // Only the last consumer tears the connection down.
      if (refCount === 0 && shared) {
        shared.disconnect();
        shared = null;
      }
    };
  }, []);
}

/** Join a lot's room for as long as this component is mounted. */
export function useLotRoom(auctionId: string | null) {
  const joined = useRef<string | null>(null);

  useEffect(() => {
    if (!auctionId) return;
    const socket = getSocket();

    const join = () => socket.emit("lot:join", auctionId);
    join();
    // Rejoin after a reconnect, or the room membership is silently lost.
    socket.on("connect", join);
    joined.current = auctionId;

    return () => {
      socket.off("connect", join);
      socket.emit("lot:leave", auctionId);
      joined.current = null;
    };
  }, [auctionId]);
}

export function sendChat(auctionId: string, body: string) {
  getSocket().emit("chat:send", { auctionId, body });
}
