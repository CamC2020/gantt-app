"use client";

import { useTransition } from "react";
import { deleteProject } from "@/lib/actions/projects";

export default function DeleteProjectButton({ projectId }: { projectId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!confirm("Delete this project? This cannot be undone.")) return;
        startTransition(async () => {
          await deleteProject(projectId);
        });
      }}
      className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
    >
      {isPending ? "Deleting…" : "Delete project"}
    </button>
  );
}
