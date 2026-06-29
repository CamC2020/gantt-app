"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/actions/projects";

interface AddMemberFormProps {
  action: (prevState: ActionResult, formData: FormData) => Promise<ActionResult>;
}

const initialState: ActionResult = { error: null };

export default function AddMemberForm({ action }: AddMemberFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          name="email"
          type="email"
          required
          placeholder="teammate@example.com"
          className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {isPending ? "Adding…" : "Add"}
        </button>
      </div>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
