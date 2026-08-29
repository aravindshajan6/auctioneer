"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "sonner";
import { useRealtimeConnection } from "@/lib/realtime/use-socket";

function RealtimeBridge() {
  useRealtimeConnection();
  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Live prices arrive over the socket, so polling would only add
            // load and fight the authoritative stream.
            refetchOnWindowFocus: false,
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <RealtimeBridge />
      {children}
      <Toaster
        position="bottom-right"
        theme="dark"
        richColors
        closeButton
        toastOptions={{
          classNames: {
            toast: "!bg-onyx !border-pewter/60 !text-linen !font-sans",
            description: "!text-fog",
          },
        }}
      />
    </QueryClientProvider>
  );
}
