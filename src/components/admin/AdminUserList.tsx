"use client";

import { useState, useTransition } from "react";
import { setAdminStatus } from "@/lib/actions/admin";
import type { Profile } from "@/lib/supabase/types";

interface Props {
  profiles: Profile[];
  currentUserId: string;
}

export default function AdminUserList({ profiles, currentUserId }: Props) {
  const [list, setList] = useState(profiles);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function toggle(profile: Profile) {
    setError(null);
    setPending(profile.id);
    const result = await setAdminStatus(profile.id, !profile.is_admin);
    if (result.error) {
      setError(result.error);
    } else {
      setList(prev => prev.map(p => p.id === profile.id ? { ...p, is_admin: !p.is_admin } : p));
    }
    setPending(null);
  }

  const admins = list.filter(p => p.is_admin);
  const members = list.filter(p => !p.is_admin);

  function renderRow(profile: Profile) {
    const isYou = profile.id === currentUserId;
    return (
      <div key={profile.id} className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 last:border-0">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-zinc-800">
            {profile.full_name || profile.email}
            {isYou && <span className="ml-2 text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-semibold">You</span>}
          </span>
          {profile.full_name && (
            <span className="text-xs text-zinc-400">{profile.email}</span>
          )}
        </div>
        <button
          disabled={pending === profile.id || isYou}
          onClick={() => startTransition(() => { toggle(profile); })}
          className={`text-xs px-3 py-1.5 rounded font-semibold border transition-colors disabled:opacity-40 ${
            profile.is_admin
              ? "border-red-200 text-red-600 hover:bg-red-50"
              : "border-green-200 text-green-700 hover:bg-green-50"
          }`}
        >
          {pending === profile.id
            ? "Saving…"
            : profile.is_admin
            ? "Remove Admin"
            : "Make Admin"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <section>
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">
          Admins — {admins.length}
        </h2>
        <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
          {admins.length === 0 ? (
            <p className="px-4 py-3 text-sm text-zinc-400 italic">No admins.</p>
          ) : admins.map(renderRow)}
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">
          Members — {members.length}
        </h2>
        <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
          {members.length === 0 ? (
            <p className="px-4 py-3 text-sm text-zinc-400 italic">No members yet.</p>
          ) : members.map(renderRow)}
        </div>
      </section>
    </div>
  );
}
