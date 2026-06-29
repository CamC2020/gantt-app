"use client";

import { useState } from "react";
import TaskForm from "@/components/tasks/TaskForm";
import { createTask } from "@/lib/actions/tasks";
import type { Profile } from "@/lib/supabase/types";

interface NewTaskPanelProps {
  projectId: string;
  members: Profile[];
}

export default function NewTaskPanel({ projectId, members }: NewTaskPanelProps) {
  const [open, setOpen] = useState(false);
  const action = (prevState: { error: string | null }, formData: FormData) =>
    createTask(projectId, prevState, formData);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
      >
        + New task
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900">New task</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-zinc-500 hover:text-zinc-800"
        >
          Cancel
        </button>
      </div>
      <TaskForm
        action={action}
        members={members}
        submitLabel="Create task"
        onSuccess={() => setOpen(false)}
      />
    </div>
  );
}
