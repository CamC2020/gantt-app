"use client";

import { useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile, PullLane, PullTicket, PullMilestone, PullTicketStatus } from "@/lib/supabase/types";
import { addDays, formatISODate, parseISODate, todayISO } from "@/lib/date";

// ─── Layout ───────────────────────────────────────────────────────────────────
const DAY_W = 120;        // sticky-note column width per day
const LANE_LABEL_W = 130; // left swimlane label column
const TICKET_H = 92;      // ticket height
const LANE_PAD = 8;
const WEEKS_SHOWN = 8;    // board shows 8 weeks starting Monday of current week

// Same member palette as the Holiday Scheduler so colors are consistent site-wide
const MEMBER_COLORS = [
  { bg: "#fef08a", border: "#eab308" }, // yellow sticky (classic)
  { bg: "#bfdbfe", border: "#3b82f6" },
  { bg: "#bbf7d0", border: "#22c55e" },
  { bg: "#e9d5ff", border: "#a855f7" },
  { bg: "#fed7aa", border: "#f97316" },
  { bg: "#fbcfe8", border: "#ec4899" },
  { bg: "#99f6e4", border: "#14b8a6" },
  { bg: "#fecaca", border: "#ef4444" },
];

function getMonday(dateStr: string): string {
  const d = parseISODate(dateStr);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return formatISODate(d);
}

function ticketEnd(t: PullTicket): string | null {
  if (!t.start_date) return null;
  return addDays(t.start_date, Math.max(0, t.duration - 1));
}

const STATUS_LABEL: Record<PullTicketStatus, string> = {
  planned: "Planned",
  promised: "Promised",
  in_progress: "In Progress",
  done_early: "Done — Early",
  done_ontime: "Done — On Time",
  done_late: "Done — Late",
};

const DONE_RING: Partial<Record<PullTicketStatus, string>> = {
  done_early: "#16a34a",  // green
  done_ontime: "#2563eb", // blue
  done_late: "#dc2626",   // red
};

export default function PullPlanBoard({
  initialLanes, initialTickets, initialMilestones, members, currentUserId, isAdmin,
}: {
  initialLanes: PullLane[];
  initialTickets: PullTicket[];
  initialMilestones: PullMilestone[];
  members: Profile[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const [lanes, setLanes] = useState<PullLane[]>(initialLanes);
  const [tickets, setTickets] = useState<PullTicket[]>(initialTickets);
  const [milestones, setMilestones] = useState<PullMilestone[]>(initialMilestones);
  const [editing, setEditing] = useState<PullTicket | null>(null); // ticket edit modal
  const [newLaneName, setNewLaneName] = useState("");
  const [showLaneForm, setShowLaneForm] = useState(false);
  const [msLabel, setMsLabel] = useState("");
  const [msDate, setMsDate] = useState("");
  const [showMsForm, setShowMsForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drag state
  const dragTicketId = useRef<string | null>(null);

  const supa = createClient();
  const today = todayISO();

  const boardStart = getMonday(today);
  const totalDays = WEEKS_SHOWN * 7;
  const boardEnd = addDays(boardStart, totalDays - 1);
  const days = useMemo(
    () => Array.from({ length: totalDays }, (_, i) => addDays(boardStart, i)),
    [boardStart, totalDays]
  );

  const colorMap = useMemo(
    () => new Map(members.map((m, i) => [m.id, MEMBER_COLORS[i % MEMBER_COLORS.length]])),
    [members]
  );
  const memberMap = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);

  function canEdit(t: PullTicket) { return isAdmin || t.owner_id === currentUserId; }

  // PPC: of promised/completed tickets whose promise date has passed or that are done,
  // what fraction finished on time or early?
  const ppc = useMemo(() => {
    const done = tickets.filter(t => t.status.startsWith("done_"));
    if (done.length === 0) return null;
    const kept = done.filter(t => t.status !== "done_late").length;
    return Math.round((kept / done.length) * 100);
  }, [tickets]);

  const roadblockCount = tickets.filter(t => t.roadblock).length;

  // Tickets not yet placed on the board (no start date)
  const trayTickets = tickets.filter(t => !t.start_date);

  // ── DB helpers ────────────────────────────────────────────────────────────
  async function patchTicket(id: string, patch: Partial<PullTicket>) {
    setTickets(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));
    const { error: err } = await supa.from("pull_tickets").update(patch).eq("id", id);
    if (err) setError(err.message);
  }

  async function addTicket() {
    const { data, error: err } = await supa
      .from("pull_tickets")
      .insert({ owner_id: currentUserId, description: "New task", duration: 1 })
      .select("id, lane_id, owner_id, description, start_date, duration, crew_size, status, roadblock, roadblock_note, promised_end, sort_order")
      .single();
    if (err) { setError(err.message); return; }
    if (data) {
      const t = data as PullTicket;
      setTickets(prev => [...prev, t]);
      setEditing(t);
    }
  }

  async function deleteTicket(id: string) {
    setTickets(prev => prev.filter(t => t.id !== id));
    setEditing(null);
    await supa.from("pull_tickets").delete().eq("id", id);
  }

  async function addLane() {
    const name = newLaneName.trim();
    if (!name) return;
    const { data, error: err } = await supa
      .from("pull_lanes")
      .insert({ name, sort_order: lanes.length })
      .select("id, name, sort_order")
      .single();
    if (err) { setError(err.message); return; }
    if (data) setLanes(prev => [...prev, data as PullLane]);
    setNewLaneName("");
    setShowLaneForm(false);
  }

  async function removeLane(id: string) {
    if (!confirm("Remove this swimlane? Tickets in it move to the tray.")) return;
    setLanes(prev => prev.filter(l => l.id !== id));
    setTickets(prev => prev.map(t => (t.lane_id === id ? { ...t, lane_id: null, start_date: null } : t)));
    await supa.from("pull_lanes").delete().eq("id", id);
  }

  async function addMilestone() {
    if (!msLabel.trim() || !msDate) return;
    const { data, error: err } = await supa
      .from("pull_milestones")
      .insert({ label: msLabel.trim(), date: msDate })
      .select("id, label, date")
      .single();
    if (err) { setError(err.message); return; }
    if (data) setMilestones(prev => [...prev, data as PullMilestone].sort((a, b) => a.date.localeCompare(b.date)));
    setMsLabel(""); setMsDate(""); setShowMsForm(false);
  }

  async function removeMilestone(id: string) {
    setMilestones(prev => prev.filter(m => m.id !== id));
    await supa.from("pull_milestones").delete().eq("id", id);
  }

  // ── Promise / complete flows ──────────────────────────────────────────────
  async function promiseTicket(t: PullTicket) {
    const end = ticketEnd(t);
    if (!end) return;
    await patchTicket(t.id, { status: "promised", promised_end: end });
    setEditing(null);
  }

  async function completeTicket(t: PullTicket) {
    const end = ticketEnd(t);
    const promised = t.promised_end;
    let status: PullTicketStatus = "done_ontime";
    if (promised && end) {
      if (today < promised && end <= promised) status = "done_early";
      else if (end && end > promised) status = "done_late";
      else if (today > promised) status = "done_late";
    }
    await patchTicket(t.id, { status, roadblock: false });
    setEditing(null);
  }

  // ── Drag & drop (HTML5 DnD) ───────────────────────────────────────────────
  function onDragStart(e: React.DragEvent, t: PullTicket) {
    if (!canEdit(t)) { e.preventDefault(); return; }
    dragTicketId.current = t.id;
    e.dataTransfer.effectAllowed = "move";
  }

  async function dropOnCell(laneId: string, date: string) {
    const id = dragTicketId.current;
    dragTicketId.current = null;
    if (!id) return;
    await patchTicket(id, { lane_id: laneId, start_date: date });
  }

  async function dropOnTray() {
    const id = dragTicketId.current;
    dragTicketId.current = null;
    if (!id) return;
    await patchTicket(id, { lane_id: null, start_date: null });
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  const laneTickets = (laneId: string) =>
    tickets.filter(t => t.lane_id === laneId && t.start_date);

  // Stack overlapping tickets in a lane into rows
  function stackLane(list: PullTicket[]): Map<string, number> {
    const rows: { end: string }[] = [];
    const rowOf = new Map<string, number>();
    const sorted = [...list].sort((a, b) => (a.start_date! < b.start_date! ? -1 : 1));
    for (const t of sorted) {
      const s = t.start_date!;
      const e = ticketEnd(t)!;
      let placed = false;
      for (let r = 0; r < rows.length; r++) {
        if (rows[r].end < s) { rows[r].end = e; rowOf.set(t.id, r); placed = true; break; }
      }
      if (!placed) { rows.push({ end: e }); rowOf.set(t.id, rows.length - 1); }
    }
    return rowOf;
  }

  function TicketCard({ t, compact = false }: { t: PullTicket; compact?: boolean }) {
    const color = colorMap.get(t.owner_id) ?? MEMBER_COLORS[0];
    const owner = memberMap.get(t.owner_id);
    const ownerName = owner?.full_name?.split(" ")[0] || owner?.email.split("@")[0] || "?";
    const isDone = t.status.startsWith("done_");
    const ring = DONE_RING[t.status];
    return (
      <div
        draggable={canEdit(t) && !isDone}
        onDragStart={e => onDragStart(e, t)}
        onClick={() => setEditing(t)}
        className="rounded-sm shadow-md cursor-pointer select-none overflow-hidden hover:shadow-lg transition-shadow"
        style={{
          backgroundColor: color.bg,
          borderLeft: `4px solid ${color.border}`,
          outline: ring ? `2px solid ${ring}` : undefined,
          opacity: isDone ? 0.75 : 1,
          height: compact ? undefined : TICKET_H,
          width: compact ? 150 : undefined,
          padding: "5px 7px",
          position: "relative",
        }}
        title={`${t.description} — ${ownerName}${t.crew_size ? ` · crew ${t.crew_size}` : ""} · ${STATUS_LABEL[t.status]}`}
      >
        {/* Promise pin */}
        {(t.status === "promised" || t.status === "in_progress" || isDone) && (
          <span className="absolute top-0.5 right-1 text-[11px]" title={`Promised: ${t.promised_end ?? ""}`}>📌</span>
        )}
        {t.roadblock && (
          <span className="absolute bottom-0.5 right-1 text-[11px]" title={t.roadblock_note || "Roadblock"}>🚧</span>
        )}
        <div className={`text-[11px] font-semibold text-zinc-800 leading-tight ${compact ? "line-clamp-2" : "line-clamp-3"}`}>
          {isDone && <span className="mr-1">{t.status === "done_late" ? "✕" : "✓"}</span>}
          {t.description}
        </div>
        <div className="mt-0.5 text-[10px] text-zinc-600">
          {ownerName}
          {t.crew_size ? ` · 👷${t.crew_size}` : ""}
          {` · ${t.duration}d`}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 select-none">
      {error && (
        <div className="flex items-center gap-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-700">✕</button>
        </div>
      )}

      {/* ── Toolbar / metrics ── */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={addTicket}
          className="rounded bg-[#1A3560] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#152b4e] transition-colors">
          + New Ticket
        </button>
        <button onClick={() => setShowLaneForm(v => !v)}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors">
          + Swimlane
        </button>
        <button onClick={() => setShowMsForm(v => !v)}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors">
          + Milestone
        </button>
        <div className="ml-auto flex items-center gap-4 text-sm">
          {roadblockCount > 0 && (
            <span className="text-amber-700 font-medium">🚧 {roadblockCount} roadblock{roadblockCount > 1 ? "s" : ""}</span>
          )}
          {ppc !== null && (
            <span className="font-semibold" title="Percent Promises Complete — completed tickets finished on time or early">
              PPC: <span className={ppc >= 80 ? "text-green-700" : ppc >= 60 ? "text-amber-600" : "text-red-600"}>{ppc}%</span>
            </span>
          )}
        </div>
      </div>

      {showLaneForm && (
        <div className="flex items-center gap-2">
          <input value={newLaneName} onChange={e => setNewLaneName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addLane()}
            placeholder="Swimlane name (e.g. North Yard)" autoFocus
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6] w-64" />
          <button onClick={addLane} className="rounded bg-[#1A3560] px-3 py-1.5 text-sm text-white">Add</button>
        </div>
      )}

      {showMsForm && (
        <div className="flex items-center gap-2">
          <input value={msLabel} onChange={e => setMsLabel(e.target.value)} placeholder="Milestone label" autoFocus
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6] w-64" />
          <input type="date" value={msDate} onChange={e => setMsDate(e.target.value)}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6]" />
          <button onClick={addMilestone} className="rounded bg-[#1A3560] px-3 py-1.5 text-sm text-white">Add</button>
        </div>
      )}

      {/* ── Ticket tray (unplanned) ── */}
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={dropOnTray}
        className="flex min-h-[70px] flex-wrap items-start gap-2 rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 p-2"
      >
        <span className="w-full text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Ticket Tray — drag tickets from here onto the board
        </span>
        {trayTickets.length === 0 && <span className="text-xs text-zinc-400 italic">No unplanned tickets. Click “+ New Ticket”.</span>}
        {trayTickets.map(t => <TicketCard key={t.id} t={t} compact />)}
      </div>

      {/* ── Board ── */}
      <div className="overflow-x-auto overflow-y-auto rounded-lg border border-zinc-300 bg-white" style={{ maxHeight: "65vh" }}>
        <div style={{ width: LANE_LABEL_W + totalDays * DAY_W }}>

          {/* Date header */}
          <div className="sticky top-0 z-20 flex border-b-2 border-zinc-300 bg-white">
            <div className="sticky left-0 z-30 shrink-0 border-r-2 border-zinc-300 bg-[#1A3560]" style={{ width: LANE_LABEL_W }} />
            {days.map(d => {
              const dt = parseISODate(d);
              const dow = dt.getDay();
              const isWknd = dow === 0 || dow === 6;
              const isToday = d === today;
              const ms = milestones.filter(m => m.date === d);
              return (
                <div key={d}
                  className={`shrink-0 border-r border-zinc-200 px-1 py-1 text-center ${isWknd ? "bg-zinc-100" : ""} ${isToday ? "bg-blue-50" : ""}`}
                  style={{ width: DAY_W }}>
                  <div className={`text-[10px] font-semibold ${isToday ? "text-[#2E6EA6]" : "text-zinc-400"}`}>
                    {dt.toLocaleDateString("en-CA", { weekday: "short" })}
                  </div>
                  <div className={`text-xs font-bold ${isToday ? "text-[#2E6EA6]" : "text-zinc-700"}`}>
                    {dt.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                  </div>
                  {ms.map(m => (
                    <div key={m.id} className="mt-0.5 flex items-center justify-center gap-1 text-[10px] font-semibold text-orange-600"
                      title={`Milestone: ${m.label}`}>
                      <span>◆</span><span className="truncate">{m.label}</span>
                      <button onClick={() => removeMilestone(m.id)} className="text-orange-300 hover:text-orange-700">✕</button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {/* Swimlanes */}
          {lanes.length === 0 && (
            <div className="p-8 text-center text-sm text-zinc-400">
              No swimlanes yet — click “+ Swimlane” to add areas of the site (e.g. North Yard, Access Road).
            </div>
          )}
          {lanes.map(lane => {
            const list = laneTickets(lane.id);
            const rowOf = stackLane(list);
            const rowCount = Math.max(1, ...Array.from(rowOf.values()).map(r => r + 1));
            const laneH = rowCount * (TICKET_H + LANE_PAD) + LANE_PAD;
            return (
              <div key={lane.id} className="relative flex border-b border-zinc-200" style={{ height: laneH }}>
                {/* Lane label */}
                <div className="sticky left-0 z-10 flex shrink-0 items-center justify-between border-r-2 border-zinc-300 bg-[#f2f5f9] px-2"
                  style={{ width: LANE_LABEL_W }}>
                  <span className="text-xs font-semibold text-[#1A3560] leading-tight">{lane.name}</span>
                  <button onClick={() => removeLane(lane.id)} className="text-zinc-300 hover:text-red-500 text-xs" title="Remove swimlane">✕</button>
                </div>

                {/* Day cells (drop targets) */}
                {days.map(d => {
                  const dow = parseISODate(d).getDay();
                  const isWknd = dow === 0 || dow === 6;
                  const isToday = d === today;
                  return (
                    <div key={d}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => dropOnCell(lane.id, d)}
                      className={`shrink-0 border-r border-zinc-100 ${isWknd ? "bg-zinc-50" : ""} ${isToday ? "bg-blue-50/60" : ""}`}
                      style={{ width: DAY_W }} />
                  );
                })}

                {/* Tickets (absolutely positioned over the grid) */}
                {list.map(t => {
                  const offset = Math.max(0, Math.round((parseISODate(t.start_date!).getTime() - parseISODate(boardStart).getTime()) / 86400000));
                  if (t.start_date! > boardEnd || ticketEnd(t)! < boardStart) return null;
                  const row = rowOf.get(t.id) ?? 0;
                  return (
                    <div key={t.id} className="absolute z-10"
                      style={{
                        left: LANE_LABEL_W + offset * DAY_W + 3,
                        top: LANE_PAD + row * (TICKET_H + LANE_PAD),
                        width: t.duration * DAY_W - 6,
                      }}>
                      <TicketCard t={t} />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-zinc-500">
        {members.map(m => {
          const c = colorMap.get(m.id)!;
          return (
            <span key={m.id} className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: c.bg, border: `1px solid ${c.border}` }} />
              {m.full_name || m.email}
            </span>
          );
        })}
        <span className="ml-auto flex items-center gap-3">
          <span>📌 promised</span>
          <span>🚧 roadblock</span>
          <span><span className="inline-block h-3 w-3 rounded-sm border-2 border-green-600 align-middle" /> done early</span>
          <span><span className="inline-block h-3 w-3 rounded-sm border-2 border-blue-600 align-middle" /> on time</span>
          <span><span className="inline-block h-3 w-3 rounded-sm border-2 border-red-600 align-middle" /> late</span>
        </span>
      </div>

      {/* ── Edit modal ── */}
      {editing && (
        <TicketModal
          key={editing.id}
          ticket={tickets.find(t => t.id === editing.id) ?? editing}
          lanes={lanes}
          owner={memberMap.get(editing.owner_id)}
          editable={canEdit(editing)}
          onPatch={patch => patchTicket(editing.id, patch)}
          onPromise={() => promiseTicket(tickets.find(t => t.id === editing.id) ?? editing)}
          onStart={() => patchTicket(editing.id, { status: "in_progress" })}
          onComplete={() => completeTicket(tickets.find(t => t.id === editing.id) ?? editing)}
          onDelete={() => deleteTicket(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ─── Ticket edit modal ─────────────────────────────────────────────────────────
function TicketModal({
  ticket, lanes, owner, editable, onPatch, onPromise, onStart, onComplete, onDelete, onClose,
}: {
  ticket: PullTicket;
  lanes: PullLane[];
  owner: Profile | undefined;
  editable: boolean;
  onPatch: (patch: Partial<PullTicket>) => void;
  onPromise: () => void;
  onStart: () => void;
  onComplete: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [desc, setDesc] = useState(ticket.description);
  const [dur, setDur] = useState(String(ticket.duration));
  const [crew, setCrew] = useState(ticket.crew_size != null ? String(ticket.crew_size) : "");
  const [start, setStart] = useState(ticket.start_date ?? "");
  const [laneId, setLaneId] = useState(ticket.lane_id ?? "");
  const [rb, setRb] = useState(ticket.roadblock);
  const [rbNote, setRbNote] = useState(ticket.roadblock_note);

  const isDone = ticket.status.startsWith("done_");

  function save() {
    const d = Math.max(1, parseInt(dur, 10) || 1);
    onPatch({
      description: desc.trim() || "Untitled",
      duration: d,
      crew_size: crew.trim() === "" ? null : Math.max(1, parseInt(crew, 10) || 1),
      start_date: start || null,
      lane_id: laneId || null,
      roadblock: rb,
      roadblock_note: rb ? rbNote : "",
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#1A3560]">Ticket</h2>
          <span className="text-[11px] text-zinc-400">
            {owner?.full_name || owner?.email} · {STATUS_LABEL_MODAL[ticket.status]}
          </span>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">Description</span>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} disabled={!editable}
              className="rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6] disabled:bg-zinc-50" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Duration (days)</span>
              <input type="number" min={1} value={dur} onChange={e => setDur(e.target.value)} disabled={!editable}
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6] disabled:bg-zinc-50" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Crew size</span>
              <input type="number" min={1} value={crew} onChange={e => setCrew(e.target.value)} disabled={!editable}
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6] disabled:bg-zinc-50" />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Start date</span>
              <input type="date" value={start} onChange={e => setStart(e.target.value)} disabled={!editable}
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6] disabled:bg-zinc-50" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Swimlane</span>
              <select value={laneId} onChange={e => setLaneId(e.target.value)} disabled={!editable}
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6] disabled:bg-zinc-50">
                <option value="">— tray —</option>
                {lanes.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          </div>

          {ticket.promised_end && (
            <p className="text-xs text-zinc-500">📌 Promised finish: <span className="font-semibold">{ticket.promised_end}</span></p>
          )}

          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" checked={rb} onChange={e => setRb(e.target.checked)} disabled={!editable} />
            🚧 Roadblock
          </label>
          {rb && (
            <input value={rbNote} onChange={e => setRbNote(e.target.value)} placeholder="What's blocking this work?" disabled={!editable}
              className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm outline-none focus:border-amber-500" />
          )}
        </div>

        {/* Actions */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {editable && !isDone && ticket.status === "planned" && ticket.start_date && (
            <button onClick={onPromise}
              className="rounded bg-[#2A6B35] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#235a2c]">
              📌 Promise
            </button>
          )}
          {editable && ticket.status === "promised" && (
            <button onClick={onStart}
              className="rounded bg-[#2E6EA6] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#265d8d]">
              ▶ Start Work
            </button>
          )}
          {editable && !isDone && (ticket.status === "promised" || ticket.status === "in_progress") && (
            <button onClick={onComplete}
              className="rounded bg-[#1A3560] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#152b4e]">
              ✓ Complete
            </button>
          )}
          <span className="flex-1" />
          {editable && (
            <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-600">Delete</button>
          )}
          <button onClick={onClose} className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50">Cancel</button>
          {editable && (
            <button onClick={save} className="rounded bg-[#1A3560] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#152b4e]">Save</button>
          )}
        </div>
      </div>
    </div>
  );
}

const STATUS_LABEL_MODAL: Record<PullTicketStatus, string> = {
  planned: "Planned",
  promised: "Promised",
  in_progress: "In Progress",
  done_early: "Done — Early",
  done_ontime: "Done — On Time",
  done_late: "Done — Late",
};
