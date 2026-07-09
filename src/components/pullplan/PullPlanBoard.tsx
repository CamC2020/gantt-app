"use client";

import { useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  Profile, PullLane, PullTicket, PullMilestone, PullTicketStatus,
  PullRole, PullTicketDep,
} from "@/lib/supabase/types";
import { addDays, formatISODate, parseISODate, todayISO } from "@/lib/date";

// ─── Layout ───────────────────────────────────────────────────────────────────
const DAY_W = 96;         // column width per day
const LANE_LABEL_W = 120; // left swimlane label column
const TICKET_H = 96;      // ticket height
const LANE_PAD = 8;
const HEADER_H = 46;
const WEEKS_SHOWN = 12;   // board shows 12 weeks starting Monday of current week
const ACTIVE_LINE_W = 14;

// TouchPlan-style role palette (header = solid, body = light tint)
export const ROLE_COLORS = [
  "#22c55e", "#f97316", "#a855f7", "#3b82f6", "#14b8a6",
  "#ec4899", "#eab308", "#ef4444", "#6366f1", "#84cc16",
];

// Pale swimlane background tints, alternating (like TouchPlan's shift lanes)
const LANE_TINTS = ["#e8f6f3", "#fdeef0", "#eef2fb", "#fdf6e8", "#f0ecfa", "#eefaf0"];

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

// Light tint of a hex color (mix with white)
function tint(hex: string, amt = 0.72): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * amt);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

function fmtShort(iso: string) {
  return parseISODate(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
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
  done_early: "#16a34a",
  done_ontime: "#2563eb",
  done_late: "#dc2626",
};

const TICKET_SELECT =
  "id, lane_id, owner_id, description, start_date, duration, crew_size, status, roadblock, roadblock_note, promised_end, sort_order, role_id, responsible_id, location";

export default function PullPlanBoard({
  initialLanes, initialTickets, initialMilestones, initialRoles, initialDeps,
  initialActiveDate, members, currentUserId, isAdmin,
}: {
  initialLanes: PullLane[];
  initialTickets: PullTicket[];
  initialMilestones: PullMilestone[];
  initialRoles: PullRole[];
  initialDeps: PullTicketDep[];
  initialActiveDate: string | null;
  members: Profile[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const [lanes, setLanes] = useState<PullLane[]>(initialLanes);
  const [tickets, setTickets] = useState<PullTicket[]>(initialTickets);
  const [milestones, setMilestones] = useState<PullMilestone[]>(initialMilestones);
  const [roles, setRoles] = useState<PullRole[]>(initialRoles);
  const [deps, setDeps] = useState<PullTicketDep[]>(initialDeps);
  const [activeDate, setActiveDate] = useState<string>(initialActiveDate ?? todayISO());
  const [editing, setEditing] = useState<string | null>(null); // ticket id
  const [showLaneForm, setShowLaneForm] = useState(false);
  const [showMsForm, setShowMsForm] = useState(false);
  const [showRoles, setShowRoles] = useState(false);
  const [newLaneName, setNewLaneName] = useState("");
  const [msLabel, setMsLabel] = useState("");
  const [msDate, setMsDate] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleColor, setNewRoleColor] = useState(ROLE_COLORS[0]);
  const [showArrows, setShowArrows] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  const totalW = LANE_LABEL_W + totalDays * DAY_W;

  const roleMap = useMemo(() => new Map(roles.map(r => [r.id, r])), [roles]);
  const memberMap = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);
  const ticketMap = useMemo(() => new Map(tickets.map(t => [t.id, t])), [tickets]);

  function canEdit(t: PullTicket) { return isAdmin || t.owner_id === currentUserId || t.responsible_id === currentUserId; }

  function roleColor(t: PullTicket): string {
    return t.role_id ? (roleMap.get(t.role_id)?.color ?? "#94a3b8") : "#94a3b8";
  }

  const ppc = useMemo(() => {
    const done = tickets.filter(t => t.status.startsWith("done_"));
    if (done.length === 0) return null;
    const kept = done.filter(t => t.status !== "done_late").length;
    return Math.round((kept / done.length) * 100);
  }, [tickets]);

  const roadblockCount = tickets.filter(t => t.roadblock).length;
  const trayTickets = tickets.filter(t => !t.start_date);

  // ── Lane layout: stack overlapping tickets, compute cumulative tops ────────
  const laneLayouts = useMemo(() => {
    let top = 0;
    return lanes.map((lane, idx) => {
      const list = tickets.filter(t => t.lane_id === lane.id && t.start_date);
      const rows: { end: string }[] = [];
      const rowOf = new Map<string, number>();
      const sorted = [...list].sort((a, b) => (a.start_date! < b.start_date! ? -1 : 1));
      for (const t of sorted) {
        const s = t.start_date!, e = ticketEnd(t)!;
        let placed = false;
        for (let r = 0; r < rows.length; r++) {
          if (rows[r].end < s) { rows[r].end = e; rowOf.set(t.id, r); placed = true; break; }
        }
        if (!placed) { rows.push({ end: e }); rowOf.set(t.id, rows.length - 1); }
      }
      const rowCount = Math.max(1, rows.length);
      const height = rowCount * (TICKET_H + LANE_PAD) + LANE_PAD;
      const layout = { lane, list, rowOf, height, top, tintColor: LANE_TINTS[idx % LANE_TINTS.length] };
      top += height;
      return layout;
    });
  }, [lanes, tickets]);

  const lanesH = laneLayouts.reduce((a, l) => a + l.height, 0);

  // Position of a ticket on the board (for arrows)
  const ticketPos = useMemo(() => {
    const m = new Map<string, { x: number; y: number; w: number }>();
    for (const ll of laneLayouts) {
      for (const t of ll.list) {
        const offset = Math.round((parseISODate(t.start_date!).getTime() - parseISODate(boardStart).getTime()) / 86400000);
        const row = ll.rowOf.get(t.id) ?? 0;
        m.set(t.id, {
          x: LANE_LABEL_W + offset * DAY_W + 3,
          y: ll.top + LANE_PAD + row * (TICKET_H + LANE_PAD),
          w: t.duration * DAY_W - 6,
        });
      }
    }
    return m;
  }, [laneLayouts, boardStart]);

  // ── DB helpers ──────────────────────────────────────────────────────────────
  async function patchTicket(id: string, patch: Partial<PullTicket>) {
    setTickets(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));
    const { error: err } = await supa.from("pull_tickets").update(patch).eq("id", id);
    if (err) setError(err.message);
  }

  async function addTicket() {
    const { data, error: err } = await supa
      .from("pull_tickets")
      .insert({ owner_id: currentUserId, responsible_id: currentUserId, description: "New task", duration: 1 })
      .select(TICKET_SELECT)
      .single();
    if (err) { setError(err.message); return; }
    if (data) {
      const t = data as PullTicket;
      setTickets(prev => [...prev, t]);
      setEditing(t.id);
    }
  }

  async function deleteTicket(id: string) {
    setTickets(prev => prev.filter(t => t.id !== id));
    setDeps(prev => prev.filter(d => d.ticket_id !== id && d.predecessor_id !== id));
    setEditing(null);
    await supa.from("pull_tickets").delete().eq("id", id);
  }

  async function setTicketDeps(id: string, predIds: string[]) {
    setDeps(prev => [
      ...prev.filter(d => d.ticket_id !== id),
      ...predIds.map(p => ({ ticket_id: id, predecessor_id: p })),
    ]);
    await supa.from("pull_ticket_deps").delete().eq("ticket_id", id);
    if (predIds.length > 0) {
      await supa.from("pull_ticket_deps").insert(predIds.map(p => ({ ticket_id: id, predecessor_id: p })));
    }
  }

  async function addLane() {
    const name = newLaneName.trim();
    if (!name) return;
    const { data, error: err } = await supa
      .from("pull_lanes").insert({ name, sort_order: lanes.length })
      .select("id, name, sort_order").single();
    if (err) { setError(err.message); return; }
    if (data) setLanes(prev => [...prev, data as PullLane]);
    setNewLaneName(""); setShowLaneForm(false);
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
      .from("pull_milestones").insert({ label: msLabel.trim(), date: msDate })
      .select("id, label, date").single();
    if (err) { setError(err.message); return; }
    if (data) setMilestones(prev => [...prev, data as PullMilestone].sort((a, b) => a.date.localeCompare(b.date)));
    setMsLabel(""); setMsDate(""); setShowMsForm(false);
  }

  async function removeMilestone(id: string) {
    setMilestones(prev => prev.filter(m => m.id !== id));
    await supa.from("pull_milestones").delete().eq("id", id);
  }

  async function addRole() {
    const name = newRoleName.trim();
    if (!name) return;
    const { data, error: err } = await supa
      .from("pull_roles").insert({ name, color: newRoleColor })
      .select("id, name, color").single();
    if (err) { setError(err.message); return; }
    if (data) setRoles(prev => [...prev, data as PullRole].sort((a, b) => a.name.localeCompare(b.name)));
    setNewRoleName("");
  }

  async function removeRole(id: string) {
    setRoles(prev => prev.filter(r => r.id !== id));
    setTickets(prev => prev.map(t => (t.role_id === id ? { ...t, role_id: null } : t)));
    await supa.from("pull_roles").delete().eq("id", id);
  }

  async function saveActiveDate(d: string) {
    setActiveDate(d);
    await supa.from("pull_settings").update({ active_date: d }).eq("id", 1);
  }

  // ── Promise / complete ──────────────────────────────────────────────────────
  async function promiseTicket(t: PullTicket) {
    const end = ticketEnd(t);
    if (!end) return;
    await patchTicket(t.id, { status: "promised", promised_end: end });
  }

  async function completeTicket(t: PullTicket) {
    const end = ticketEnd(t);
    const promised = t.promised_end;
    let status: PullTicketStatus = "done_ontime";
    if (promised && end) {
      if (end < promised) status = "done_early";
      else if (end > promised || today > promised) status = "done_late";
    }
    await patchTicket(t.id, { status, roadblock: false });
    setEditing(null);
  }

  // ── Drag & drop ─────────────────────────────────────────────────────────────
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

  // ── Ticket card (TouchPlan sticky style) ────────────────────────────────────
  function TicketCard({ t, compact = false }: { t: PullTicket; compact?: boolean }) {
    const rc = roleColor(t);
    const resp = memberMap.get(t.responsible_id ?? t.owner_id);
    const respName = resp?.full_name?.split(" ")[0] || resp?.email.split("@")[0] || "?";
    const isDone = t.status.startsWith("done_");
    const ring = DONE_RING[t.status];
    const end = ticketEnd(t);
    const isFuture = !!t.start_date && t.start_date > activeDate;
    return (
      <div
        draggable={canEdit(t) && !isDone}
        onDragStart={e => onDragStart(e, t)}
        onClick={() => setEditing(t.id)}
        className="flex cursor-pointer select-none flex-col overflow-hidden rounded-[3px] shadow-md transition-shadow hover:shadow-lg"
        style={{
          backgroundColor: tint(rc),
          outline: ring ? `2.5px solid ${ring}` : undefined,
          opacity: isDone ? 0.8 : isFuture ? 0.92 : 1,
          height: compact ? 84 : TICKET_H,
          width: compact ? 140 : undefined,
        }}
        title={`${t.description} — ${respName} · ${STATUS_LABEL[t.status]}`}
      >
        {/* Header strip: location tag on solid role color */}
        <div className="flex items-center justify-between px-1.5 py-0.5" style={{ backgroundColor: rc }}>
          <span className="truncate text-[9px] font-bold text-white">{t.location || " "}</span>
          <span className="flex items-center gap-1 text-[10px]">
            {(t.status === "promised" || t.status === "in_progress" || isDone) && <span title={`Promised: ${t.promised_end ?? ""}`}>📌</span>}
            {t.roadblock && <span title={t.roadblock_note || "Roadblock"}>🚧</span>}
          </span>
        </div>
        {/* Dates */}
        {t.start_date && (
          <div className="px-1.5 pt-0.5 text-[9px] font-medium text-zinc-500">
            {fmtShort(t.start_date)}{end && end !== t.start_date ? ` – ${fmtShort(end)}` : ""}
          </div>
        )}
        {/* Description */}
        <div className={`flex-1 px-1.5 pt-0.5 text-[11px] font-semibold leading-tight text-zinc-800 ${compact ? "line-clamp-2" : "line-clamp-3"}`}>
          {isDone && <span className="mr-1">{t.status === "done_late" ? "✕" : "✓"}</span>}
          {t.description}
        </div>
        {/* Footer: crew + duration icons like TouchPlan */}
        <div className="flex items-center justify-between px-1.5 pb-1 text-[10px] font-semibold text-zinc-600">
          <span title="Responsible">{respName}</span>
          <span className="flex items-center gap-2">
            {t.crew_size != null && <span title="Crew size">👥 {t.crew_size}</span>}
            <span title="Duration">🕐 {t.duration}</span>
          </span>
        </div>
      </div>
    );
  }

  // Active line X position (at the END of the active day, like TouchPlan)
  const activeOffset = Math.min(
    totalDays,
    Math.max(0, Math.round((parseISODate(activeDate).getTime() - parseISODate(boardStart).getTime()) / 86400000) + 1)
  );
  const activeX = LANE_LABEL_W + activeOffset * DAY_W;

  const editingTicket = editing ? ticketMap.get(editing) ?? null : null;

  return (
    <div className="flex select-none flex-col gap-3">
      {error && (
        <div className="flex items-center gap-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-700">✕</button>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={addTicket}
          className="rounded bg-[#1A3560] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#152b4e]">
          + Ticket
        </button>
        <button onClick={() => setShowLaneForm(v => !v)}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">
          + Swimlane
        </button>
        <button onClick={() => setShowMsForm(v => !v)}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">
          + Milestone
        </button>
        <button onClick={() => setShowRoles(v => !v)}
          className={`rounded border px-3 py-1.5 text-sm ${showRoles ? "border-[#2E6EA6] bg-blue-50 text-[#1A3560]" : "border-zinc-300 text-zinc-700 hover:bg-zinc-50"}`}>
          Roles
        </button>
        <label className="ml-2 flex items-center gap-1.5 text-xs text-zinc-600">
          <input type="checkbox" checked={showArrows} onChange={e => setShowArrows(e.target.checked)} />
          Connections
        </label>
        <label className="flex items-center gap-1.5 text-xs text-zinc-600">
          Active line:
          <input type="date" value={activeDate} onChange={e => e.target.value && saveActiveDate(e.target.value)}
            className="rounded border border-zinc-300 px-1.5 py-1 text-xs outline-none focus:border-[#2E6EA6]" />
        </label>
        <div className="ml-auto flex items-center gap-4 text-sm">
          {roadblockCount > 0 && (
            <span className="font-medium text-amber-700">🚧 {roadblockCount} roadblock{roadblockCount > 1 ? "s" : ""}</span>
          )}
          {ppc !== null && (
            <span className="font-semibold" title="Percent Promises Complete">
              PPC: <span className={ppc >= 80 ? "text-green-700" : ppc >= 60 ? "text-amber-600" : "text-red-600"}>{ppc}%</span>
            </span>
          )}
        </div>
      </div>

      {showLaneForm && (
        <div className="flex items-center gap-2">
          <input value={newLaneName} onChange={e => setNewLaneName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addLane()}
            placeholder="Swimlane name (e.g. North Yard, Day Shift)" autoFocus
            className="w-72 rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6]" />
          <button onClick={addLane} className="rounded bg-[#1A3560] px-3 py-1.5 text-sm text-white">Add</button>
        </div>
      )}

      {showMsForm && (
        <div className="flex items-center gap-2">
          <input value={msLabel} onChange={e => setMsLabel(e.target.value)} placeholder="Milestone label" autoFocus
            className="w-64 rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6]" />
          <input type="date" value={msDate} onChange={e => setMsDate(e.target.value)}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6]" />
          <button onClick={addMilestone} className="rounded bg-[#1A3560] px-3 py-1.5 text-sm text-white">Add</button>
        </div>
      )}

      {/* ── Roles panel ── */}
      {showRoles && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">Roles / Trades</h3>
          <div className="mb-3 flex flex-wrap gap-2">
            {roles.length === 0 && <span className="text-xs italic text-zinc-400">No roles yet — add trades below (e.g. Excavation, Electrical).</span>}
            {roles.map(r => (
              <span key={r.id} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white"
                style={{ backgroundColor: r.color }}>
                {r.name}
                <button onClick={() => removeRole(r.id)} className="text-white/60 hover:text-white">✕</button>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={newRoleName} onChange={e => setNewRoleName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addRole()}
              placeholder="Role name (e.g. Sitework)"
              className="w-56 rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6]" />
            <div className="flex items-center gap-1">
              {ROLE_COLORS.map(c => (
                <button key={c} onClick={() => setNewRoleColor(c)}
                  className={`h-6 w-6 rounded-full border-2 ${newRoleColor === c ? "border-zinc-800" : "border-transparent"}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
            <button onClick={addRole} className="rounded bg-[#1A3560] px-3 py-1.5 text-sm text-white">Add Role</button>
          </div>
        </div>
      )}

      {/* ── Ticket tray ── */}
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={dropOnTray}
        className="flex min-h-[70px] flex-wrap items-start gap-2 rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 p-2"
      >
        <span className="w-full text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Ticket Tray — drag tickets onto the board
        </span>
        {trayTickets.length === 0 && <span className="text-xs italic text-zinc-400">No unplanned tickets. Click “+ Ticket”.</span>}
        {trayTickets.map(t => <TicketCard key={t.id} t={t} compact />)}
      </div>

      {/* ── Board ── */}
      <div className="overflow-x-auto overflow-y-auto rounded-lg border border-zinc-300 bg-white" style={{ maxHeight: "68vh" }}>
        <div className="relative" style={{ width: totalW }}>

          {/* Date header */}
          <div className="sticky top-0 z-30 flex border-b-2 border-zinc-300 bg-white" style={{ height: HEADER_H }}>
            <div className="sticky left-0 z-40 shrink-0 border-r-2 border-zinc-300 bg-[#1A3560]" style={{ width: LANE_LABEL_W }} />
            {days.map(d => {
              const dt = parseISODate(d);
              const dow = dt.getDay();
              const isWknd = dow === 0 || dow === 6;
              const isToday = d === today;
              const ms = milestones.filter(m => m.date === d);
              return (
                <div key={d}
                  className={`relative shrink-0 border-r border-zinc-200 px-1 py-0.5 text-center ${isWknd ? "bg-zinc-100" : ""} ${isToday ? "bg-blue-50" : ""}`}
                  style={{ width: DAY_W }}>
                  <div className={`text-[9px] font-semibold ${isToday ? "text-[#2E6EA6]" : "text-zinc-400"}`}>
                    {dt.toLocaleDateString("en-CA", { weekday: "short" })}
                  </div>
                  <div className={`text-[11px] font-bold ${isToday ? "text-[#2E6EA6]" : "text-zinc-700"}`}>
                    {dt.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                  </div>
                  {ms.map(m => (
                    <div key={m.id} className="flex items-center justify-center gap-0.5 text-[9px] font-semibold text-orange-600"
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
          {laneLayouts.length === 0 && (
            <div className="p-8 text-center text-sm text-zinc-400">
              No swimlanes yet — click “+ Swimlane” to add areas or shifts (e.g. North Yard, Day Shift).
            </div>
          )}
          {laneLayouts.map(ll => (
            <div key={ll.lane.id} className="relative flex border-b border-zinc-200" style={{ height: ll.height, backgroundColor: ll.tintColor }}>
              <div className="sticky left-0 z-20 flex shrink-0 items-start justify-between border-r-2 border-zinc-300 bg-[#f2f5f9] px-2 pt-2"
                style={{ width: LANE_LABEL_W }}>
                <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-600">{ll.lane.name}</span>
                <button onClick={() => removeLane(ll.lane.id)} className="text-xs text-zinc-300 hover:text-red-500" title="Remove swimlane">✕</button>
              </div>
              {days.map(d => {
                const dow = parseISODate(d).getDay();
                const isWknd = dow === 0 || dow === 6;
                return (
                  <div key={d}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => dropOnCell(ll.lane.id, d)}
                    className={`shrink-0 border-r border-black/5 ${isWknd ? "bg-black/5" : ""}`}
                    style={{ width: DAY_W }} />
                );
              })}
              {ll.list.map(t => {
                const pos = ticketPos.get(t.id);
                if (!pos || t.start_date! > boardEnd || ticketEnd(t)! < boardStart) return null;
                return (
                  <div key={t.id} className="absolute z-10"
                    style={{ left: pos.x, top: LANE_PAD + (ll.rowOf.get(t.id) ?? 0) * (TICKET_H + LANE_PAD), width: pos.w }}>
                    <TicketCard t={t} />
                  </div>
                );
              })}
            </div>
          ))}

          {/* Dependency arrows overlay */}
          {showArrows && lanesH > 0 && (
            <svg className="pointer-events-none absolute z-20" style={{ left: 0, top: HEADER_H, width: totalW, height: lanesH }}>
              <defs>
                <marker id="pp-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 z" fill="#334155" />
                </marker>
              </defs>
              {deps.map(dep => {
                const from = ticketPos.get(dep.predecessor_id);
                const to = ticketPos.get(dep.ticket_id);
                if (!from || !to) return null;
                const x1 = from.x + from.w, y1 = from.y + TICKET_H / 2;
                const x2 = to.x, y2 = to.y + TICKET_H / 2;
                const midX = x1 + Math.max(14, (x2 - x1) / 2);
                const d = x2 > x1 + 10
                  ? `M ${x1} ${y1} C ${midX} ${y1}, ${x2 - Math.max(14, (x2 - x1) / 2)} ${y2}, ${x2 - 2} ${y2}`
                  : `M ${x1} ${y1} C ${x1 + 30} ${y1}, ${x2 - 30} ${y2}, ${x2 - 2} ${y2}`;
                return <path key={`${dep.ticket_id}-${dep.predecessor_id}`} d={d} fill="none" stroke="#334155" strokeWidth="1.6" markerEnd="url(#pp-arrow)" opacity={0.75} />;
              })}
            </svg>
          )}

          {/* Active line */}
          {lanesH > 0 && activeOffset > 0 && activeOffset < totalDays && (
            <div className="absolute z-20 flex items-start justify-center"
              style={{ left: activeX - ACTIVE_LINE_W / 2, top: HEADER_H, width: ACTIVE_LINE_W, height: lanesH, backgroundColor: "#3f3f46" }}
              title={`Active line: ${activeDate} — work left of this line is active`}>
              <span className="mt-2 text-[9px] font-bold tracking-wider text-white" style={{ writingMode: "vertical-rl" }}>
                Active {fmtShort(activeDate)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-zinc-500">
        {roles.map(r => (
          <span key={r.id} className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: r.color }} />
            {r.name}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-3">
          <span>📌 promised</span>
          <span>🚧 roadblock</span>
          <span><span className="inline-block h-3 w-3 rounded-sm border-2 border-green-600 align-middle" /> early</span>
          <span><span className="inline-block h-3 w-3 rounded-sm border-2 border-blue-600 align-middle" /> on time</span>
          <span><span className="inline-block h-3 w-3 rounded-sm border-2 border-red-600 align-middle" /> late</span>
        </span>
      </div>

      {/* ── Edit modal ── */}
      {editingTicket && (
        <TicketModal
          key={editingTicket.id}
          ticket={editingTicket}
          lanes={lanes}
          roles={roles}
          members={members}
          allTickets={tickets}
          predIds={deps.filter(d => d.ticket_id === editingTicket.id).map(d => d.predecessor_id)}
          editable={canEdit(editingTicket)}
          onPatch={patch => patchTicket(editingTicket.id, patch)}
          onSetDeps={ids => setTicketDeps(editingTicket.id, ids)}
          onPromise={() => promiseTicket(editingTicket)}
          onStart={() => patchTicket(editingTicket.id, { status: "in_progress" })}
          onComplete={() => completeTicket(editingTicket)}
          onDelete={() => deleteTicket(editingTicket.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ─── Ticket edit modal ─────────────────────────────────────────────────────────
function TicketModal({
  ticket, lanes, roles, members, allTickets, predIds, editable,
  onPatch, onSetDeps, onPromise, onStart, onComplete, onDelete, onClose,
}: {
  ticket: PullTicket;
  lanes: PullLane[];
  roles: PullRole[];
  members: Profile[];
  allTickets: PullTicket[];
  predIds: string[];
  editable: boolean;
  onPatch: (patch: Partial<PullTicket>) => void;
  onSetDeps: (predIds: string[]) => void;
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
  const [roleId, setRoleId] = useState(ticket.role_id ?? "");
  const [respId, setRespId] = useState(ticket.responsible_id ?? "");
  const [location, setLocation] = useState(ticket.location);
  const [rb, setRb] = useState(ticket.roadblock);
  const [rbNote, setRbNote] = useState(ticket.roadblock_note);
  const [preds, setPreds] = useState<string[]>(predIds);

  const isDone = ticket.status.startsWith("done_");
  const candidates = allTickets.filter(t => t.id !== ticket.id);

  function save() {
    onPatch({
      description: desc.trim() || "Untitled",
      duration: Math.max(1, parseInt(dur, 10) || 1),
      crew_size: crew.trim() === "" ? null : Math.max(1, parseInt(crew, 10) || 1),
      start_date: start || null,
      lane_id: laneId || null,
      role_id: roleId || null,
      responsible_id: respId || null,
      location: location.trim(),
      roadblock: rb,
      roadblock_note: rb ? rbNote : "",
    });
    onSetDeps(preds);
    onClose();
  }

  function togglePred(id: string) {
    setPreds(prev => (prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#1A3560]">Ticket</h2>
          <span className="text-[11px] text-zinc-400">{STATUS_LABEL[ticket.status]}</span>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">Description</span>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} disabled={!editable}
              className="rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6] disabled:bg-zinc-50" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Role / Trade</span>
              <select value={roleId} onChange={e => setRoleId(e.target.value)} disabled={!editable}
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6] disabled:bg-zinc-50">
                <option value="">— none —</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Responsible</span>
              <select value={respId} onChange={e => setRespId(e.target.value)} disabled={!editable}
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6] disabled:bg-zinc-50">
                <option value="">— unassigned —</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Location</span>
              <input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Zone A" disabled={!editable}
                className="rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6] disabled:bg-zinc-50" />
            </label>
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

          {/* Predecessors */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">Predecessors (work that must finish first)</span>
            {candidates.length === 0 ? (
              <span className="text-xs italic text-zinc-400">No other tickets yet.</span>
            ) : (
              <div className="max-h-36 overflow-y-auto rounded border border-zinc-200 p-2">
                {candidates.map(c => (
                  <label key={c.id} className="flex items-center gap-2 py-0.5 text-xs text-zinc-700">
                    <input type="checkbox" checked={preds.includes(c.id)} onChange={() => togglePred(c.id)} disabled={!editable} />
                    <span className="truncate">{c.description}{c.start_date ? ` (${c.start_date})` : " (tray)"}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {ticket.promised_end && (
            <p className="text-xs text-zinc-500">📌 Promised finish: <span className="font-semibold">{ticket.promised_end}</span></p>
          )}

          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" checked={rb} onChange={e => setRb(e.target.checked)} disabled={!editable} />
            🚧 Roadblock / constraint
          </label>
          {rb && (
            <input value={rbNote} onChange={e => setRbNote(e.target.value)} placeholder="What's blocking this work?" disabled={!editable}
              className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm outline-none focus:border-amber-500" />
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {editable && !isDone && ticket.status === "planned" && ticket.start_date && (
            <button onClick={onPromise} className="rounded bg-[#2A6B35] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#235a2c]">
              📌 Promise
            </button>
          )}
          {editable && ticket.status === "promised" && (
            <button onClick={onStart} className="rounded bg-[#2E6EA6] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#265d8d]">
              ▶ Start Work
            </button>
          )}
          {editable && !isDone && (ticket.status === "promised" || ticket.status === "in_progress") && (
            <button onClick={onComplete} className="rounded bg-[#1A3560] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#152b4e]">
              ✓ Complete
            </button>
          )}
          <span className="flex-1" />
          {editable && <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-600">Delete</button>}
          <button onClick={onClose} className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50">Cancel</button>
          {editable && (
            <button onClick={save} className="rounded bg-[#1A3560] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#152b4e]">Save</button>
          )}
        </div>
      </div>
    </div>
  );
}
