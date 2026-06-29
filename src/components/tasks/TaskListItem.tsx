"use client";

import { useState, useTransition } from "react";
import TaskForm from "@/components/tasks/TaskForm";
import { deleteTask, updateTask } from "@/lib/actions/tasks";
import type { Profile, Task } from "@/lib/supabase/types";

interface TaskListItemProps {
  task: Task;
  projectId: string;
  members: Profile[];
}

const STATUS_LABEL: Record<Task["status"], string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
};

const STATUS_COLOR: Record<Task["status"], string> = {
  not_started: "bg-zinc-100 text-zinc-600",
  in_progress: "bg-blue-100 text-blue-700",
  done: "bg-emerald-100 text-emerald-700",
};

export default function TaskListItem({ task, projectId, members }: TaskListItemProps) {
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const assignee = members.find((m) => m.id === task.assignee_id);

  const action = (prevState: { error: string | null }, formData: FormData) =>
    updateTask(task.id, projectId, prevState, formData);

  if (editing) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-900">Edit task</h3>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-sm text-zinc-500 hover:text-zinc-800"
          >
            Cancel
          </button>
        </div>
        <TaskForm
          action={action}
          members={members}
          task={task}
          submitLabel="Save changes"
          onSuccess={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-col gap-1">
        <p className="font-medium text-zinc-900">{task.title}</p>
        <p className="text-sm text-zinc-500">
          {task.start_date} → {task.end_date}
          {assignee && (
            <span> · {assignee.full_name || assignee.email}</span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[task.status]}`}
        >
          {STATUS_LABEL[task.status]}
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
        >
          Edit
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            if (!confirm("Delete this task?")) return;
            startTransition(async () => {
              await deleteTask(task.id, projectId);
            });
          }}
          className="text-sm font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
