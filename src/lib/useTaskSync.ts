"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Keeps a server-rendered task page in sync with everyone else's edits.
//
// My Tasks and All Tasks are both `force-dynamic` server components, so the
// cheapest correct refresh is router.refresh() — it re-runs the page on the
// server and streams new props down, rather than us re-implementing each
// page's query on the client.
//
// Three triggers, deliberately overlapping:
//   1. Realtime — instant, the main path (needs 021_realtime_tasks.sql applied).
//   2. Tab focus — covers the laptop-lid-closed case, where the socket dropped.
//   3. Slow poll — safety net so the page still self-updates if Realtime isn't
//      enabled on the project or the socket silently died. Paused while hidden
//      so background tabs don't hammer Supabase.
const POLL_MS = 45_000;

export function useTaskSync() {
  const router = useRouter();

  useEffect(() => {
    const supa = createClient();

    const channel = supa
      .channel("task-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        () => router.refresh()
      )
      .subscribe();

    const onFocus = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);

    const poll = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, POLL_MS);

    return () => {
      supa.removeChannel(channel);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
      clearInterval(poll);
    };
  }, [router]);
}
