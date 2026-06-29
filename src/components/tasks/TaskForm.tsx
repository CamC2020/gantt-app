"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/actions/tasks";
import type { Profile, Task } from "@/lib/supabase/types";

interface TaskFormProps {
  action: (prevState: ActionResult, formData: FormData) => Promise<ActionResult>;
  members: Profile[];
  task?: Task;
  onSuccess?: () => void;
  submitLabel: string;
}

const initialState: ActionResult = { error: null };

export default function TaskForm({
  action,
  members,
  task,
  onSuccess,
  submitLabel,
}: TaskFormProps) {
  const wrappedAction = async (prevState: ActionResult, formData: FormData) => {
    const result = await action(prevState, formData);
    if (!result.error) {
      onSuccess?.();
    }
    return result;
  };

  const [state, formAction, isPending] = useActionState(wrappedAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="title" className="text-sm font-medium text-zinc-700">
          Title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          defaultValue={task?.title}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
          placeholder="Design homepage"
        />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="start_date" className="text-sm font-medium text-zinc-700">
            Start date
          </label>
          <input
            id="start_date"
            name="start_date"
            type="date"
            required
            defaultValue={task?.start_date}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="end_date" className="text-sm font-medium text-zinc-700">
            End date
          </label>
          <input
            id="end_date"
            name="end_date"
            type="date"
            required
            defaultValue={task?.end_date}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="status" className="text-sm font-medium text-zinc-700">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={task?.status ?? "not_started"}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
          >
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
          </select>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="assignee_id" className="text-sm font-medium text-zinc-700">
            Assignee
          </label>
          <select
            id="assignee_id"
            name="assignee_id"
            defaultValue={task?.assignee_id ?? ""}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.full_name || member.email}
              </option>
            ))}
          </select>
        </div>
      </div>

      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {isPending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
