"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile, MemberHoliday } from "@/lib/supabase/types";

interface Props {
  profiles: Profile[];
  initialHolidays: MemberHoliday[];
  currentUserId: string;
}

// Stable colour per member index
const MEMBER_COLORS = [
  { bg: "bg-blue-200",   border: "border-blue-400",   text: "text-blue-800",   dot: "#3b82f6" },
  { bg: "bg-green-200",  border: "border-green-400",  text: "text-green-800",  dot: "#22c55e" },
  { bg: "bg-purple-200", border: "border-purple-400", text: "text-purple-800", dot: "#a855f7" },
  { bg: "bg-orange-200", border: "border-orange-400", text: "text-orange-800", dot: "#f97316" },
  { bg: "bg-pink-200",   border: "border-pink-400",   text: "text-pink-800",   dot: "#ec4899" },
  { bg: "bg-teal-200",   border: "border-teal-400",   text: "text-teal-800",   dot: "#14b8a6" },
  { bg: "bg-red-200",    border: "border-red-400",    text: "text-red-800",    dot: "#ef4444" },
  { bg: "bg-amber-200",  border: "border-amber-400",  text: "text-amber-800",  dot: "#f59e0b" },
];

function fmt(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function isoFromDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  const cur = new Date(start + "T00:00:00");
  const last = new Date(end + "T00:00:00");
  while (cur <= last) {
    out.push(isoFromDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export default function HolidayScheduler({ profiles, initialHolidays, currentUserId }: Props) {
  const [holidays, setHolidays] = useState<MemberHoliday[]>(initialHolidays);
  const [viewDate, setViewDate] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supa = createClient();

  const colorMap = new Map(profiles.map((p, i) => [p.id, MEMBER_COLORS[i % MEMBER_COLORS.length]]));

  // Build a map: iso date → list of (holiday, profile)
  const dayMap = new Map<string, { holiday: MemberHoliday; profile: Profile }[]>();
  for (const h of holidays) {
    const profile = profiles.find(p => p.id === h.user_id);
    if (!profile) continue;
    for (const d of datesInRange(h.start_date, h.end_date)) {
      const list = dayMap.get(d) ?? [];
      list.push({ holiday: h, profile });
      dayMap.set(d, list);
    }
  }

  // Calendar grid for current month
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayISO = isoFromDate(new Date());

  const monthLabel = viewDate.toLocaleDateString("en-CA", { month: "long", year: "numeric" });

  function prevMonth() { setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1)); }
  function nextMonth() { setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1)); }

  async function addHoliday() {
    if (!startDate || !endDate) return;
    if (endDate < startDate) { setError("End date must be on or after start date."); return; }
    setSaving(true);
    setError(null);
    const { data, error: err } = await supa
      .from("member_holidays")
      .insert({ user_id: currentUserId, start_date: startDate, end_date: endDate, label: label.trim() || "Holiday" })
      .select("id, user_id, start_date, end_date, label")
      .single();
    if (err) { setError(err.message); }
    else if (data) {
      setHolidays(prev => [...prev, data as MemberHoliday].sort((a, b) => a.start_date.localeCompare(b.start_date)));
      setStartDate(""); setEndDate(""); setLabel("");
    }
    setSaving(false);
  }

  async function removeHoliday(id: string) {
    await supa.from("member_holidays").delete().eq("id", id);
    setHolidays(prev => prev.filter(h => h.id !== id));
  }

  return (
    <div className="space-y-6">
      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {profiles.map(p => {
          const color = colorMap.get(p.id)!;
          return (
            <div key={p.id} className="flex items-center gap-1.5">
              <span className={`w-3 h-3 rounded-sm inline-block ${color.bg} border ${color.border}`} />
              <span className="text-xs text-zinc-600">{p.full_name || p.email}</span>
            </div>
          );
        })}
      </div>

      {/* Calendar */}
      <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-sm">
        {/* Month nav */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 bg-[#1A3560]">
          <button onClick={prevMonth} className="text-white hover:text-blue-200 text-lg font-bold px-2">‹</button>
          <span className="text-white font-semibold text-sm tracking-wide">{monthLabel}</span>
          <button onClick={nextMonth} className="text-white hover:text-blue-200 text-lg font-bold px-2">›</button>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 border-b border-zinc-100">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
            <div key={d} className="text-center text-[11px] font-semibold text-zinc-400 py-2">{d}</div>
          ))}
        </div>

        {/* Calendar cells */}
        <div className="grid grid-cols-7">
          {/* Blank cells before first day */}
          {Array.from({ length: firstDay }).map((_, i) => (
            <div key={`blank-${i}`} className="border-r border-b border-zinc-50 min-h-[72px]" />
          ))}

          {/* Day cells */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const entries = dayMap.get(iso) ?? [];
            const isToday = iso === todayISO;
            const isWeekend = new Date(iso + "T00:00:00").getDay() === 0 || new Date(iso + "T00:00:00").getDay() === 6;

            return (
              <div key={iso}
                className={`border-r border-b border-zinc-100 min-h-[72px] p-1 ${isWeekend ? "bg-zinc-50" : ""}`}>
                <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full
                  ${isToday ? "bg-[#1A3560] text-white" : "text-zinc-500"}`}>
                  {day}
                </div>
                <div className="flex flex-col gap-0.5">
                  {/* Deduplicate: one bar per holiday range per day (show only first occurrence) */}
                  {Array.from(new Map(entries.map(e => [e.holiday.id, e])).values()).map(({ holiday, profile }) => {
                    const color = colorMap.get(profile.id)!;
                    const isStart = iso === holiday.start_date;
                    const name = profile.full_name?.split(" ")[0] || profile.email.split("@")[0];
                    return (
                      <div key={holiday.id}
                        className={`text-[10px] px-1 py-0.5 rounded truncate ${color.bg} ${color.text} border ${color.border}`}
                        title={`${profile.full_name || profile.email}: ${holiday.label} (${holiday.start_date} – ${holiday.end_date})`}>
                        {isStart ? `${name}: ${holiday.label}` : name}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Add holiday form */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-[#1A3560] mb-4">Add My Time Off</h2>
        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500 font-medium">First Day Off</label>
            <input type="date" value={startDate}
              onChange={e => { setStartDate(e.target.value); if (!endDate || e.target.value > endDate) setEndDate(e.target.value); }}
              className="rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500 font-medium">Last Day Off</label>
            <input type="date" value={endDate} min={startDate}
              onChange={e => setEndDate(e.target.value)}
              className="rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6]" />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
            <label className="text-xs text-zinc-500 font-medium">Label (optional)</label>
            <input type="text" value={label} placeholder="e.g. Vacation"
              onChange={e => setLabel(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") addHoliday(); }}
              className="rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6]" />
          </div>
          <button onClick={addHoliday} disabled={!startDate || !endDate || saving}
            className="rounded bg-[#1A3560] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#152b4e] disabled:opacity-40 transition-colors">
            {saving ? "Saving…" : "Add"}
          </button>
        </div>
      </div>

      {/* Upcoming holidays list */}
      <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-zinc-100 bg-zinc-50">
          <h2 className="text-sm font-semibold text-zinc-700">All Scheduled Time Off</h2>
        </div>
        {holidays.length === 0 ? (
          <p className="px-5 py-4 text-sm text-zinc-400 italic">No time off scheduled yet.</p>
        ) : (
          <div className="divide-y divide-zinc-100">
            {holidays.map(h => {
              const profile = profiles.find(p => p.id === h.user_id);
              if (!profile) return null;
              const color = colorMap.get(h.user_id)!;
              const isMe = h.user_id === currentUserId;
              const name = profile.full_name || profile.email;
              const days = datesInRange(h.start_date, h.end_date).length;
              return (
                <div key={h.id} className="flex items-center gap-3 px-5 py-3">
                  <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${color.bg} border ${color.border}`} />
                  <span className="text-xs font-medium text-zinc-700 w-28 shrink-0 truncate">{name}</span>
                  <span className="text-xs font-mono text-zinc-500 shrink-0">
                    {h.start_date === h.end_date ? fmt(h.start_date) : `${fmt(h.start_date)} – ${fmt(h.end_date)}`}
                  </span>
                  <span className="text-xs text-zinc-400 shrink-0">({days}d)</span>
                  <span className="text-xs text-zinc-600 flex-1 truncate">{h.label}</span>
                  {isMe && (
                    <button onClick={() => removeHoliday(h.id)}
                      className="text-red-400 hover:text-red-600 text-[11px] shrink-0">
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
