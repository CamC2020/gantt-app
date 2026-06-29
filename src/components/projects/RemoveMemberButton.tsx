"use client";

import { useTransition } from "react";
import { removeProjectMember } from "@/lib/actions/projects";

interface RemoveMemberButtonProps {
  projectId: string;
  userId: string;
}

export default function RemoveMemberButton({
  projectId,
  userId,
}: RemoveMemberButtonProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await removeProjectMember(projectId, userId);
        })
      }
      className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
    >
      Remove
    </button>
  );
}
