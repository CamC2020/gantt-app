"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { TaskStatus } from "@/lib/supabase/types";

export const STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  done: "Done",
};

export const STATUS_STYLES: Record<TaskStatus, string> = {
  not_started: "bg-zinc-100 text-zinc-600",
  in_progress: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
};

const ORDER: TaskStatus[] = ["not_started", "in_progress", "done"];

interface Props {
  taskId: string;
  status: TaskStatus;
  // False for users who aren't admin/champion/assignee/support on this task —
  // update_task_status would reject them, so don't offer the control at all.
  canEdit: boolean;
  onOptimistic?: (status: TaskStatus) => void;
}

export default function StatusButtons({ taskId, status, canEdit, onOptimistic }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();
  const router = useRouter();
  const supa = createClient();

  if (!canEdit) {
    return (
      <span className="text-xs text-zinc-400 italic">
        View only — you&rsquo;re not assigned to this task.
      </span>
    );
  }

  function updateStatus(next: TaskStatus) {
    if (next === status || saving) return;
    setError(null);

    // The optimistic flip and the write share one transition, so the flip stays
    // on screen until the refreshed server row lands — and unwinds by itself if
    // the RPC rejects us (e.g. someone unassigned mid-edit).
    startTransition(async () => {
      onOptimistic?.(next);

      const { error: rpcError } = await supa.rpc("update_task_status", {
        p_task_id: taskId,
        p_status: next,
      });

      if (rpcError) {
        setError(rpcError.message);
        return;
      }

      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {ORDER.map(s => (
        <button
          key={s}
          disabled={saving}
          onClick={() => updateStatus(s)}
          className={`text-xs px-3 py-1 rounded-full font-medium border transition-colors disabled:opacity-50 ${
            status === s
              ? `${STATUS_STYLES[s]} border-transparent ring-2 ring-offset-1 ring-blue-400`
              : "bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400"
          }`}
        >
          {STATUS_LABELS[s]}
        </button>
      ))}
      {saving && <span className="text-xs text-zinc-400">Saving…</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
