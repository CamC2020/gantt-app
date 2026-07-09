"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PullTicket, PullLane, PullRole, PullLocation, PullTicketStatus } from "@/lib/supabase/types";
import { VARIANCE_REASONS } from "@/lib/supabase/types";
import { diffInDays, todayISO } from "@/lib/date";
import { ticketEnd, STATUS_LABEL } from "@/components/pullplan/TicketCard";

const STATUS_CHIP: Record<PullTicketStatus, string> = {
  planned: "bg-zinc-100 text-zinc-600",
  promised: "bg-blue-100 text-blue-700",
  in_progress: "bg-indigo-100 text-indigo-700",
  done_early: "bg-green-100 text-green-700",
  done_ontime: "bg-blue-100 text-blue-700",
  done_late: "bg-red-100 text-red-700",
};

export default function PullMyTasks({
  initialTickets, supportTickets = [], lanes, roles, locations, currentUserId,
}: {
  initialTickets: PullTicket[];
  supportTickets?: PullTicket[];
  lanes: PullLane[];
  roles: PullRole[];
  locations: PullLocation[];
  currentUserId: string;
}) {
  const [tickets, setTickets] = useState<PullTicket[]>(initialTickets);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [rbDraft, setRbDraft] = useState("");
  const [varFor, setVarFor] = useState<string | null>(null); // ticket id awaiting variance reason
  const [varReason, setVarReason] = useState("");
  const [varNote, setVarNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const supa = createClient();
  const today = todayISO();

  const laneMap = useMemo(() => new Map(lanes.map(l => [l.id, l])), [lanes]);
  const roleMap = useMemo(() => new Map(roles.map(r => [r.id, r])), [roles]);
  const locMap = useMemo(() => new Map(locations.map(l => [l.id, l])), [locations]);

  async function patch(id: string, p: Partial<PullTicket>) {
    setTickets(prev => prev.map(t => (t.id === id ? { ...t, ...p } : t)));
    const { error: err } = await supa.from("pull_tickets").update(p).eq("id", id);
    if (err) setError(err.message);
  }

  function outcome(t: PullTicket): PullTicketStatus {
    const end = ticketEnd(t);
    if (t.promised_end && end) {
      if (end < t.promised_end) return "done_early";
      if (end > t.promised_end || today > t.promised_end) return "done_late";
    }
    return "done_ontime";
  }

  async function complete(t: PullTicket, reason = "", note = "") {
    await patch(t.id, { status: outcome(t), roadblock: false, variance_reason: reason, variance_note: note });
    setVarFor(null); setVarReason(""); setVarNote("");
  }

  function handleComplete(t: PullTicket) {
    if (outcome(t) !== "done_ontime") { setVarFor(t.id); setVarReason(""); setVarNote(""); return; }
    complete(t);
  }

  // Grouping
  const groups = useMemo(() => {
    const active = tickets.filter(t => !t.status.startsWith("done_"));
    const done = tickets.filter(t => t.status.startsWith("done_"));
    const blocked = active.filter(t => t.roadblock);
    const inProgress = active.filter(t => !t.roadblock && t.status === "in_progress");
    const promised = active.filter(t => !t.roadblock && t.status === "promised");
    const unscheduled = active.filter(t => !t.roadblock && t.status === "planned" && !t.start_date);
    const planned = active.filter(t => !t.roadblock && t.status === "planned" && t.start_date)
      .sort((a, b) => a.start_date!.localeCompare(b.start_date!));
    return [
      { title: "🚧 Roadblocked", list: blocked, border: "border-amber-400" },
      { title: "▶ In Progress", list: inProgress, border: "border-indigo-400" },
      { title: "📌 Promised", list: promised, border: "border-blue-400" },
      { title: "📅 Planned", list: planned, border: "border-zinc-300" },
      { title: "🗂 Unscheduled (in tray)", list: unscheduled, border: "border-dashed border-zinc-300" },
      { title: "✅ Completed", list: done, border: "border-green-400" },
    ].filter(g => g.list.length > 0);
  }, [tickets]);

  function TicketRow({ t }: { t: PullTicket }) {
    const role = t.role_id ? roleMap.get(t.role_id) : undefined;
    const loc = t.location_id ? locMap.get(t.location_id) : undefined;
    const lane = t.lane_id ? laneMap.get(t.lane_id) : undefined;
    const end = ticketEnd(t);
    const isDone = t.status.startsWith("done_");
    const open = expanded === t.id;
    const daysToStart = t.start_date ? diffInDays(today, t.start_date) : null;
    const daysToEnd = end ? diffInDays(today, end) : null;
    const urgency =
      isDone ? "" :
      t.roadblock ? "border-l-amber-500" :
      daysToEnd !== null && daysToEnd < 0 ? "border-l-red-500" :
      daysToEnd !== null && daysToEnd <= 2 ? "border-l-orange-400" :
      "border-l-zinc-200";

    return (
      <div className={`rounded-lg border border-zinc-200 border-l-4 bg-white shadow-sm ${urgency}`}>
        <button className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
          onClick={() => {
            setExpanded(open ? null : t.id);
            setNoteDraft(t.notes);
            setRbDraft(t.roadblock_note);
          }}>
          {role && <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: role.color }} title={role.name} />}
          <span className="flex-1 truncate text-sm font-medium text-zinc-800">{t.description}</span>
          {t.roadblock && <span title={t.roadblock_note}>🚧</span>}
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_CHIP[t.status]}`}>
            {STATUS_LABEL[t.status]}
          </span>
        </button>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 px-3 pb-2 text-[11px] text-zinc-500">
          {t.start_date
            ? <span>{t.start_date}{end && end !== t.start_date ? ` → ${end}` : ""} · {t.duration}d</span>
            : <span className="italic">not scheduled</span>}
          {lane && <span>{lane.name}</span>}
          {loc && <span style={{ color: loc.color }}>📍 {loc.name}</span>}
          {t.crew_size != null && <span>👥 {t.crew_size}</span>}
          {!isDone && daysToStart !== null && daysToStart > 0 && <span>starts in {daysToStart}d</span>}
          {!isDone && daysToEnd !== null && daysToEnd >= 0 && daysToStart !== null && daysToStart <= 0 && (
            <span className={daysToEnd <= 2 ? "font-semibold text-orange-600" : ""}>{daysToEnd}d left</span>
          )}
          {!isDone && daysToEnd !== null && daysToEnd < 0 && (
            <span className="font-semibold text-red-600">{-daysToEnd}d overdue</span>
          )}
          {t.promised_end && <span>📌 promised {t.promised_end}</span>}
        </div>

        {open && (
          <div className="flex flex-col gap-2 border-t border-zinc-100 px-3 py-2.5">
            {/* Action buttons */}
            {!isDone && (
              <div className="flex flex-wrap items-center gap-2">
                {t.status === "planned" && t.start_date && (
                  <button onClick={() => patch(t.id, { status: "promised", promised_end: end })}
                    className="rounded bg-[#2A6B35] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#235a2c]">
                    📌 Promise
                  </button>
                )}
                {t.status === "promised" && (
                  <button onClick={() => patch(t.id, { status: "in_progress" })}
                    className="rounded bg-[#2E6EA6] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#265d8d]">
                    ▶ Start Work
                  </button>
                )}
                {(t.status === "promised" || t.status === "in_progress") && (
                  <button onClick={() => handleComplete(t)}
                    className="rounded bg-[#1A3560] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#152b4e]">
                    ✓ Complete
                  </button>
                )}
                {t.status === "promised" && (
                  <button onClick={() => patch(t.id, { status: "planned", promised_end: null })}
                    className="rounded border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50">
                    ↩ Unpromise
                  </button>
                )}
                <label className="ml-auto flex items-center gap-1.5 text-xs text-zinc-600">
                  <input type="checkbox" checked={t.roadblock}
                    onChange={e => patch(t.id, { roadblock: e.target.checked, roadblock_note: e.target.checked ? rbDraft : "" })} />
                  🚧 Roadblock
                </label>
              </div>
            )}

            {/* Variance prompt */}
            {varFor === t.id && (
              <div className="flex flex-col gap-2 rounded border border-blue-200 bg-blue-50 p-2">
                <span className="text-xs font-semibold text-[#1A3560]">
                  Completing {outcome(t) === "done_late" ? "LATE" : "EARLY"} — variance reason required.
                </span>
                <select value={varReason} onChange={e => setVarReason(e.target.value)}
                  className="rounded border border-blue-300 bg-white px-2 py-1.5 text-sm outline-none">
                  <option value="">— select reason —</option>
                  {VARIANCE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <input value={varNote} onChange={e => setVarNote(e.target.value)} placeholder="Optional note"
                  className="rounded border border-blue-300 bg-white px-2 py-1.5 text-sm outline-none" />
                <div className="flex gap-2">
                  <button onClick={() => complete(t, varReason, varNote.trim())} disabled={!varReason}
                    className="rounded bg-[#1A3560] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                    Confirm Complete
                  </button>
                  <button onClick={() => setVarFor(null)} className="text-xs text-zinc-500">Cancel</button>
                </div>
              </div>
            )}

            {t.roadblock && !isDone && (
              <input value={rbDraft} onChange={e => setRbDraft(e.target.value)}
                onBlur={() => patch(t.id, { roadblock_note: rbDraft })}
                placeholder="What's blocking this work?"
                className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm outline-none focus:border-amber-500" />
            )}

            {isDone && t.variance_reason && (
              <p className="text-xs text-zinc-500">
                Variance: <span className="font-semibold">{t.variance_reason}</span>
                {t.variance_note && <> — {t.variance_note}</>}
              </p>
            )}

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Notes</span>
              <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)}
                onBlur={() => { if (noteDraft !== t.notes) patch(t.id, { notes: noteDraft }); }}
                rows={2} placeholder="Add a note… (saved when you click away)"
                className="rounded border border-zinc-200 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6]" />
            </div>

            <a href="/pullplan" className="text-[11px] text-[#2E6EA6] underline hover:text-[#1A3560]">
              Open in Pull Plan →
            </a>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <div className="flex items-center gap-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-700">✕</button>
        </div>
      )}
      {groups.map(g => (
        <div key={g.title}>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">{g.title} ({g.list.length})</h2>
          <div className="flex flex-col gap-2">
            {g.list.map(t => <TicketRow key={t.id} t={t} />)}
          </div>
        </div>
      ))}

      {/* Tickets where I'm on the support crew — view only, no email reminders */}
      {supportTickets.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">🤝 Support ({supportTickets.length})</h2>
          <div className="flex flex-col gap-2">
            {supportTickets.map(t => {
              const role = t.role_id ? roleMap.get(t.role_id) : undefined;
              const loc = t.location_id ? locMap.get(t.location_id) : undefined;
              const lane = t.lane_id ? laneMap.get(t.lane_id) : undefined;
              const end = ticketEnd(t);
              return (
                <div key={t.id} className="rounded-lg border border-zinc-200 border-l-4 border-l-zinc-300 bg-white shadow-sm">
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    {role && <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: role.color }} title={role.name} />}
                    <span className="flex-1 truncate text-sm font-medium text-zinc-800">{t.description}</span>
                    {t.roadblock && <span title={t.roadblock_note}>🚧</span>}
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_CHIP[t.status]}`}>
                      {STATUS_LABEL[t.status]}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 px-3 pb-2 text-[11px] text-zinc-500">
                    {t.start_date
                      ? <span>{t.start_date}{end && end !== t.start_date ? ` → ${end}` : ""} · {t.duration}d</span>
                      : <span className="italic">not scheduled</span>}
                    {lane && <span>{lane.name}</span>}
                    {loc && <span style={{ color: loc.color }}>📍 {loc.name}</span>}
                    {t.crew_size != null && <span>👥 {t.crew_size}</span>}
                    <span className="italic text-zinc-400">supporting</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
