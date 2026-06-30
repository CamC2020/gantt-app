"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile, MemberHoliday } from "@/lib/supabase/types";

interface Props {
  profiles: Profile[];
  initialHolidays: MemberHoliday[];
  currentUserId: string;
}

export default function HolidayScheduler({ profiles, initialHolidays, currentUserId }: Props) {
  const [holidays, setHolidays] = useState<MemberHoliday[]>(initialHolidays);
  const [newDate, setNewDate] = useState<Record<string, string>>({});
  const [newLabel, setNewLabel] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supa = createClient();

  function userHolidays(userId: string) {
    return holidays.filter(h => h.user_id === userId).sort((a, b) => a.date.localeCompare(b.date));
  }

  async function addHoliday(userId: string) {
    const date = newDate[userId];
    const label = newLabel[userId]?.trim() || "Holiday";
    if (!date) return;

    setSaving(userId);
    setError(null);

    const { data, error: err } = await supa
      .from("member_holidays")
      .insert({ user_id: userId, date, label })
      .select("id, user_id, date, label")
      .single();

    if (err) {
      setError(err.message);
    } else if (data) {
      setHolidays(prev => [...prev, data as MemberHoliday]);
      setNewDate(prev => ({ ...prev, [userId]: "" }));
      setNewLabel(prev => ({ ...prev, [userId]: "" }));
    }
    setSaving(null);
  }

  async function removeHoliday(holiday: MemberHoliday) {
    setSaving(holiday.id);
    await supa.from("member_holidays").delete().eq("id", holiday.id);
    setHolidays(prev => prev.filter(h => h.id !== holiday.id));
    setSaving(null);
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {profiles.map(profile => {
        const isMe = profile.id === currentUserId;
        const userHols = userHolidays(profile.id);
        const name = profile.full_name || profile.email;

        return (
          <div key={profile.id} className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
            {/* Member header */}
            <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 border-b border-zinc-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-[#1A3560] flex items-center justify-center text-white text-xs font-bold shrink-0">
                  {name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <span className="text-sm font-semibold text-zinc-800">{name}</span>
                  {isMe && <span className="ml-2 text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-semibold">You</span>}
                  {profile.full_name && <p className="text-[11px] text-zinc-400">{profile.email}</p>}
                </div>
              </div>
              <span className="text-xs text-zinc-400">{userHols.length} day{userHols.length !== 1 ? "s" : ""}</span>
            </div>

            {/* Holidays list */}
            <div className="px-4 py-2">
              {userHols.length === 0 ? (
                <p className="text-xs text-zinc-400 italic py-1">No holidays entered.</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {userHols.map(h => (
                    <div key={h.id} className="flex items-center gap-3 py-1 border-b border-zinc-50 last:border-0">
                      <span className="text-xs font-mono text-zinc-500 w-24 shrink-0">{h.date}</span>
                      <span className="text-xs text-zinc-700 flex-1">{h.label}</span>
                      {isMe && (
                        <button
                          disabled={saving === h.id}
                          onClick={() => removeHoliday(h)}
                          className="text-red-400 hover:text-red-600 text-[11px] shrink-0 disabled:opacity-40"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Add form — only for own row */}
              {isMe && (
                <div className="flex items-center gap-2 mt-3 pt-2 border-t border-zinc-100">
                  <input
                    type="date"
                    value={newDate[profile.id] ?? ""}
                    onChange={e => setNewDate(prev => ({ ...prev, [profile.id]: e.target.value }))}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs outline-none focus:border-[#2E6EA6]"
                  />
                  <input
                    type="text"
                    value={newLabel[profile.id] ?? ""}
                    onChange={e => setNewLabel(prev => ({ ...prev, [profile.id]: e.target.value }))}
                    placeholder="e.g. Vacation"
                    className="flex-1 rounded border border-zinc-300 px-2 py-1 text-xs outline-none focus:border-[#2E6EA6]"
                    onKeyDown={e => { if (e.key === "Enter") addHoliday(profile.id); }}
                  />
                  <button
                    onClick={() => addHoliday(profile.id)}
                    disabled={!newDate[profile.id] || saving === profile.id}
                    className="rounded bg-[#1A3560] px-3 py-1 text-xs font-medium text-white hover:bg-[#152b4e] disabled:opacity-40"
                  >
                    {saving === profile.id ? "Saving…" : "Add"}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
