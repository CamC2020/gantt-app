"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  Profile, PullLane, PullTicket, PullMilestone, PullTicketStatus,
  PullRole, PullTicketDep, PullLocation, PullMilestoneLink,
} from "@/lib/supabase/types";
import { addDays, diffInDays, formatISODate, parseISODate, todayISO } from "@/lib/date";
import TicketCard, { ticketEnd } from "./TicketCard";
import TicketModal from "./TicketModal";
import {
  IconRail, PanelShell, RolesPanel, LocationsPanel, MembersPanel,
  ConstraintsPanel, FilterPanel, OverviewPanel,
  type PanelId, type Filters,
} from "./Sidebar";

// ─── Layout constants (scaled by zoom) ─────────────────────────────────────────
const BASE_DAY_W = 36;    // active-zone day column
const BASE_WEEK_W = 92;   // future-zone week column
const LINE_W = 14;        // active line bar
const LANE_PAD = 8;
const HEADER_H = 44;
const ACTIVE_WEEKS_BEFORE = 2;  // active zone shows 2 weeks before the active line
const FUTURE_WEEKS = 20;        // future zone length

const LANE_TINTS: [string, string][] = [
  ["#eaf6f2", "#dff0ea"], // mint  [active side, future side]
  ["#fdecef", "#f9e2e7"], // rose
  ["#edf1fb", "#e2e9f7"],
  ["#fdf5e6", "#f8eeda"],
];

const TICKET_SELECT =
  "id, lane_id, owner_id, description, start_date, duration, crew_size, status, roadblock, roadblock_note, promised_end, sort_order, role_id, responsible_id, location, location_id, row_index, work_sat, work_sun, notes, variance_reason, variance_note, roadblock_need_by, roadblock_priority";

function getMonday(dateStr: string): string {
  const d = parseISODate(dateStr);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return formatISODate(d);
}

function fmtShort(iso: string) {
  return parseISODate(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

type DragMode =
  | { kind: "ticket"; id: string; grabX: number; grabY: number }
  | { kind: "milestone"; id: string }
  | { kind: "resize"; id: string }
  | { kind: "line" };

export default function PullPlanBoard({
  initialLanes, initialTickets, initialMilestones, initialRoles, initialDeps,
  initialMsLinks = [], initialLocations, initialActiveDate, members, currentUserId, isAdmin,
}: {
  initialLanes: PullLane[];
  initialTickets: PullTicket[];
  initialMilestones: PullMilestone[];
  initialRoles: PullRole[];
  initialDeps: PullTicketDep[];
  initialMsLinks?: PullMilestoneLink[];
  initialLocations: PullLocation[];
  initialActiveDate: string | null;
  members: Profile[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const [lanes, setLanes] = useState<PullLane[]>(initialLanes);
  const [tickets, setTickets] = useState<PullTicket[]>(initialTickets);
  const [milestones, setMilestones] = useState<PullMilestone[]>(initialMilestones);
  const [roles, setRoles] = useState<PullRole[]>(initialRoles);
  const [locations, setLocations] = useState<PullLocation[]>(initialLocations);
  const [deps, setDeps] = useState<PullTicketDep[]>(initialDeps);
  const [msLinks, setMsLinks] = useState<PullMilestoneLink[]>(initialMsLinks);
  const [activeDate, setActiveDate] = useState<string>(initialActiveDate ?? todayISO());
  const [zoom, setZoom] = useState(1);
  const [panel, setPanel] = useState<PanelId>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState<{ kind: "ticket" | "milestone"; id: string } | null>(null);
  const [filters, setFilters] = useState<Filters>({ roleIds: new Set(), memberIds: new Set(), locationIds: new Set() });
  const [showLaneForm, setShowLaneForm] = useState(false);
  const [newLaneName, setNewLaneName] = useState("");
  const [showMsForm, setShowMsForm] = useState(false);
  const [msLabel, setMsLabel] = useState("");
  const [msDate, setMsDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Drag state (ghost position in board coordinates)
  const [drag, setDrag] = useState<DragMode | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<DragMode | null>(null);
  const ghostRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const trayRef = useRef<HTMLDivElement | null>(null);

  const supa = createClient();
  const today = todayISO();

  // ── Timeline geometry ───────────────────────────────────────────────────────
  const dayW = Math.round(BASE_DAY_W * zoom);
  const weekW = Math.round(BASE_WEEK_W * zoom);
  const ticketH = Math.max(32, Math.round(78 * zoom)); // ticket height scales with zoom
  const msSize = Math.max(30, Math.round(54 * zoom));  // milestone diamond scales with zoom
  // Active zone starts at least 2 weeks before the active line, extended back
  // to the earliest placed ticket so nothing is cut off.
  const earliestStart = tickets.reduce<string | null>(
    (min, t) => (t.start_date && (!min || t.start_date < min) ? t.start_date : min), null
  );
  const defaultStart = addDays(activeDate, -7 * ACTIVE_WEEKS_BEFORE);
  const activeStart = getMonday(
    earliestStart && earliestStart < defaultStart ? earliestStart : defaultStart
  );
  const activeDays = diffInDays(activeStart, activeDate) + 1;
  const activeW = activeDays * dayW;
  const firstFuture = addDays(activeDate, 1);
  const futureW = FUTURE_WEEKS * weekW;
  const totalW = activeW + LINE_W + futureW;
  const boardEnd = addDays(firstFuture, FUTURE_WEEKS * 7 - 1);

  function xForDate(d: string): number {
    if (d <= activeDate) return diffInDays(activeStart, d) * dayW;
    const idx = diffInDays(firstFuture, d);
    return activeW + LINE_W + Math.floor(idx / 7) * weekW + ((idx % 7) / 7) * weekW;
  }
  function widthForTicket(t: PullTicket): number {
    const end = ticketEnd(t)!;
    return Math.max(26, xForDate(addDays(end, 1)) - xForDate(t.start_date!) - 4 - (end >= activeDate && t.start_date! <= activeDate ? LINE_W : 0));
  }
  function dateForX(x: number): string {
    if (x < activeW) return addDays(activeStart, Math.max(0, Math.floor(x / dayW)));
    if (x < activeW + LINE_W) return activeDate;
    const rel = x - activeW - LINE_W;
    const week = Math.min(FUTURE_WEEKS - 1, Math.floor(rel / weekW));
    const dayFrac = Math.min(6, Math.floor(((rel % weekW) / weekW) * 7));
    return addDays(firstFuture, week * 7 + dayFrac);
  }

  const activeDayList = useMemo(
    () => Array.from({ length: activeDays }, (_, i) => addDays(activeStart, i)),
    [activeStart, activeDays]
  );
  const futureWeekList = useMemo(
    () => Array.from({ length: FUTURE_WEEKS }, (_, i) => addDays(firstFuture, i * 7)),
    [firstFuture]
  );

  // ── Maps & permissions ──────────────────────────────────────────────────────
  const roleMap = useMemo(() => new Map(roles.map(r => [r.id, r])), [roles]);
  const locMap = useMemo(() => new Map(locations.map(l => [l.id, l])), [locations]);
  const memberMap = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);
  const ticketMap = useMemo(() => new Map(tickets.map(t => [t.id, t])), [tickets]);

  function canEdit(t: PullTicket) {
    return isAdmin || t.owner_id === currentUserId || t.responsible_id === currentUserId;
  }

  const filtersActive = filters.roleIds.size + filters.memberIds.size + filters.locationIds.size > 0;
  function isHid(t: PullTicket): boolean {
    if (!filtersActive) return false;
    if (filters.roleIds.size && (!t.role_id || !filters.roleIds.has(t.role_id))) return true;
    if (filters.memberIds.size && !(t.responsible_id && filters.memberIds.has(t.responsible_id)) && !filters.memberIds.has(t.owner_id)) return true;
    if (filters.locationIds.size && (!t.location_id || !filters.locationIds.has(t.location_id))) return true;
    return false;
  }

  const trayTickets = tickets.filter(t => !t.start_date);

  // ── Lane layout (manual rows via row_index; lane grows, min 2 rows) ────────
  const laneLayouts = useMemo(() => {
    let top = 0;
    return lanes.map((lane, idx) => {
      const list = tickets.filter(t => t.lane_id === lane.id && t.start_date);
      const laneMs = milestones.filter(m => m.lane_id === lane.id && m.date);
      const maxRow = Math.max(
        list.reduce((m, t) => Math.max(m, t.row_index), 0),
        laneMs.reduce((m, x) => Math.max(m, x.row_index), 0)
      );
      const rows = Math.max(2, maxRow + 2); // spare row at the bottom for dropping
      const height = rows * (ticketH + LANE_PAD) + LANE_PAD;
      const layout = { lane, list, rows, height, top, tints: LANE_TINTS[idx % LANE_TINTS.length] };
      top += height;
      return layout;
    });
  }, [lanes, tickets, milestones, ticketH]);
  const lanesH = laneLayouts.reduce((a, l) => a + l.height, 0);

  const ticketPos = useMemo(() => {
    const m = new Map<string, { x: number; y: number; w: number; laneTop: number }>();
    for (const ll of laneLayouts) {
      for (const t of ll.list) {
        m.set(t.id, {
          x: xForDate(t.start_date!) + 2,
          y: ll.top + LANE_PAD + t.row_index * (ticketH + LANE_PAD),
          w: widthForTicket(t),
          laneTop: ll.top,
        });
      }
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laneLayouts, dayW, weekW, activeDate]);

  // Milestone diamond centers (lane placement, or floating at the top if no lane)
  const msPos = useMemo(() => {
    const map = new Map<string, { cx: number; cy: number }>();
    for (const m of milestones) {
      if (!m.date) continue;
      const cx = xForDate(m.date) + dayW / 2;
      const ll = m.lane_id ? laneLayouts.find(l => l.lane.id === m.lane_id) : undefined;
      if (ll) {
        const row = Math.min(ll.rows - 1, m.row_index);
        map.set(m.id, { cx, cy: ll.top + LANE_PAD + row * (ticketH + LANE_PAD) + ticketH / 2 });
      } else {
        map.set(m.id, { cx, cy: 14 + msSize / 2 });
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [milestones, laneLayouts, dayW, weekW, activeDate, ticketH, msSize]);

  // ── DB helpers ──────────────────────────────────────────────────────────────
  async function patchTicket(id: string, patch: Partial<PullTicket>) {
    setTickets(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));
    const { error: err } = await supa.from("pull_tickets").update(patch).eq("id", id);
    if (err) setError(err.message);
  }

  async function createTicket(fields: Partial<PullTicket>) {
    const { data, error: err } = await supa
      .from("pull_tickets")
      .insert({ owner_id: currentUserId, responsible_id: currentUserId, description: "New task", duration: 1, ...fields })
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

  async function addDep(ticketId: string, predId: string) {
    if (ticketId === predId) return;
    if (deps.some(d => d.ticket_id === ticketId && d.predecessor_id === predId)) return;
    setDeps(prev => [...prev, { ticket_id: ticketId, predecessor_id: predId }]);
    const { error: err } = await supa.from("pull_ticket_deps").insert({ ticket_id: ticketId, predecessor_id: predId });
    if (err) setError(err.message);
  }

  async function removeDep(ticketId: string, predId: string) {
    setDeps(prev => prev.filter(d => !(d.ticket_id === ticketId && d.predecessor_id === predId)));
    await supa.from("pull_ticket_deps").delete().eq("ticket_id", ticketId).eq("predecessor_id", predId);
  }

  async function addMsLink(ticketId: string, milestoneId: string, ticketIsPred: boolean) {
    if (msLinks.some(l => l.ticket_id === ticketId && l.milestone_id === milestoneId)) return;
    const tempId = `tmp-${Date.now()}`;
    setMsLinks(prev => [...prev, { id: tempId, ticket_id: ticketId, milestone_id: milestoneId, ticket_is_pred: ticketIsPred }]);
    const { data, error: err } = await supa.from("pull_milestone_links")
      .insert({ ticket_id: ticketId, milestone_id: milestoneId, ticket_is_pred: ticketIsPred })
      .select("id, ticket_id, milestone_id, ticket_is_pred").single();
    if (err) { setError(err.message); setMsLinks(prev => prev.filter(l => l.id !== tempId)); return; }
    if (data) setMsLinks(prev => prev.map(l => (l.id === tempId ? (data as PullMilestoneLink) : l)));
  }

  async function removeMsLink(id: string) {
    setMsLinks(prev => prev.filter(l => l.id !== id));
    await supa.from("pull_milestone_links").delete().eq("id", id);
  }

  async function addLane() {
    const name = newLaneName.trim();
    if (!name) return;
    const { data, error: err } = await supa.from("pull_lanes")
      .insert({ name, sort_order: lanes.length }).select("id, name, sort_order").single();
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
    if (!msLabel.trim()) return;
    const { data, error: err } = await supa.from("pull_milestones")
      .insert({ label: msLabel.trim(), date: msDate || null })
      .select("id, label, date, lane_id, row_index").single();
    if (err) { setError(err.message); return; }
    if (data) setMilestones(prev => [...prev, data as PullMilestone]);
    setMsLabel(""); setMsDate(""); setShowMsForm(false);
  }

  async function patchMilestone(id: string, patch: Partial<PullMilestone>) {
    setMilestones(prev => prev.map(m => (m.id === id ? { ...m, ...patch } : m)));
    const { error: err } = await supa.from("pull_milestones").update(patch).eq("id", id);
    if (err) setError(err.message);
  }

  async function removeMilestone(id: string) {
    if (!confirm("Remove this milestone?")) return;
    setMilestones(prev => prev.filter(m => m.id !== id));
    await supa.from("pull_milestones").delete().eq("id", id);
  }

  async function addRole(name: string, color: string) {
    const { data, error: err } = await supa.from("pull_roles")
      .insert({ name, color }).select("id, name, color").single();
    if (err) { setError(err.message); return; }
    if (data) setRoles(prev => [...prev, data as PullRole].sort((a, b) => a.name.localeCompare(b.name)));
  }
  async function removeRole(id: string) {
    setRoles(prev => prev.filter(r => r.id !== id));
    setTickets(prev => prev.map(t => (t.role_id === id ? { ...t, role_id: null } : t)));
    await supa.from("pull_roles").delete().eq("id", id);
  }

  async function addLocation(name: string, color: string) {
    const { data, error: err } = await supa.from("pull_locations")
      .insert({ name, color, sort_order: locations.length }).select("id, name, color, sort_order").single();
    if (err) { setError(err.message); return; }
    if (data) setLocations(prev => [...prev, data as PullLocation]);
  }
  async function removeLocation(id: string) {
    setLocations(prev => prev.filter(l => l.id !== id));
    setTickets(prev => prev.map(t => (t.location_id === id ? { ...t, location_id: null } : t)));
    await supa.from("pull_locations").delete().eq("id", id);
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
  async function completeTicket(t: PullTicket, varianceReason?: string, varianceNote?: string) {
    const end = ticketEnd(t);
    const promised = t.promised_end;
    let status: PullTicketStatus = "done_ontime";
    if (promised && end) {
      if (end < promised) status = "done_early";
      else if (end > promised || today > promised) status = "done_late";
    }
    await patchTicket(t.id, {
      status, roadblock: false,
      variance_reason: varianceReason ?? "",
      variance_note: varianceNote ?? "",
    });
    setEditing(null);
  }

  // What the completion status would be right now (drives the variance-reason prompt)
  function completionOutcome(t: PullTicket): PullTicketStatus {
    const end = ticketEnd(t);
    const promised = t.promised_end;
    if (promised && end) {
      if (end < promised) return "done_early";
      if (end > promised || today > promised) return "done_late";
    }
    return "done_ontime";
  }

  // ── Pointer drag system ─────────────────────────────────────────────────────
  function boardXY(e: PointerEvent | React.PointerEvent): { x: number; y: number } {
    const rect = boardRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startDrag(e: React.PointerEvent, mode: DragMode) {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = mode;
    movedRef.current = false;
    setDrag(mode);
    const { x, y } = boardXY(e);
    ghostRef.current = { x, y };
    setGhost({ x, y });

    const onMove = (ev: PointerEvent) => {
      if (!boardRef.current) return;
      const p = boardXY(ev);
      if (Math.abs(p.x - ghostRef.current!.x) + Math.abs(p.y - ghostRef.current!.y) > 3) movedRef.current = true;
      ghostRef.current = p;
      setGhost({ ...p });
    };
    const onUp = async (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const m = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      setGhost(null);
      if (!m) return;
      const moved = movedRef.current;

      if (m.kind === "line") {
        if (moved && boardRef.current) {
          const p = boardXY(ev);
          saveActiveDate(dateForX(p.x));
        }
        return;
      }

      if (m.kind === "milestone") {
        const ms = milestones.find(x => x.id === m.id);
        if (!ms) return;
        if (!moved) { handleMilestoneClick(ms); return; }
        if (trayRef.current) {
          const tr = trayRef.current.getBoundingClientRect();
          if (ev.clientX >= tr.left && ev.clientX <= tr.right && ev.clientY >= tr.top && ev.clientY <= tr.bottom) {
            await patchMilestone(ms.id, { date: null, lane_id: null, row_index: 0 });
            return;
          }
        }
        if (!boardRef.current) return;
        const p = boardXY(ev);
        const laneY = p.y - HEADER_H;
        const ll = laneLayouts.find(l => laneY >= l.top && laneY < l.top + l.height);
        const date = dateForX(Math.max(0, p.x - dayW / 2));
        if (!ll) { await patchMilestone(ms.id, { date, lane_id: null }); return; }
        const row = Math.min(ll.rows - 1, Math.max(0, Math.floor((laneY - ll.top - LANE_PAD) / (ticketH + LANE_PAD))));
        await patchMilestone(ms.id, { date, lane_id: ll.lane.id, row_index: row });
        return;
      }

      const t = ticketMap.get(m.id);
      if (!t) return;

      if (m.kind === "resize") {
        if (moved && boardRef.current && t.start_date) {
          const p = boardXY(ev);
          const endDate = dateForX(Math.max(xForDate(t.start_date), p.x - 4));
          const newDur = Math.max(1, diffInDays(t.start_date, endDate) + 1);
          if (newDur !== t.duration) await patchTicket(t.id, { duration: newDur });
        }
        return;
      }

      // kind === "ticket"
      if (!moved) { handleTicketClick(t); return; }
      // Dropped on the tray?
      if (trayRef.current) {
        const tr = trayRef.current.getBoundingClientRect();
        if (ev.clientX >= tr.left && ev.clientX <= tr.right && ev.clientY >= tr.top && ev.clientY <= tr.bottom) {
          await patchTicket(t.id, { lane_id: null, start_date: null, row_index: 0 });
          return;
        }
      }
      if (!boardRef.current) return;
      const p = boardXY(ev);
      const dropX = p.x - m.grabX;
      const laneY = p.y - HEADER_H; // pointer position within the lanes area
      const ll = laneLayouts.find(l => laneY >= l.top && laneY < l.top + l.height);
      if (!ll) return;
      const row = Math.min(ll.rows - 1, Math.max(0, Math.floor((laneY - ll.top - LANE_PAD) / (ticketH + LANE_PAD))));
      const date = dateForX(Math.max(0, dropX));
      await patchTicket(t.id, { lane_id: ll.lane.id, start_date: date, row_index: row });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function handleTicketClick(t: PullTicket) {
    if (connectMode) {
      if (!connectFrom) { setConnectFrom({ kind: "ticket", id: t.id }); return; }
      if (connectFrom.kind === "ticket" && connectFrom.id !== t.id) addDep(t.id, connectFrom.id);
      if (connectFrom.kind === "milestone") addMsLink(t.id, connectFrom.id, false); // milestone → ticket
      setConnectFrom(null);
      return;
    }
    setEditing(t.id);
  }

  function handleMilestoneClick(m: PullMilestone) {
    if (!connectMode) return;
    if (!connectFrom) { setConnectFrom({ kind: "milestone", id: m.id }); return; }
    if (connectFrom.kind === "ticket") addMsLink(connectFrom.id, m.id, true); // ticket → milestone
    setConnectFrom(null);
  }

  // Out of sequence: a ticket that starts on/before a predecessor's end,
  // or a milestone-predecessor relationship that's violated.
  const outOfSeqIds = useMemo(() => {
    const bad = new Set<string>();
    for (const dep of deps) {
      const pred = ticketMap.get(dep.predecessor_id);
      const succ = ticketMap.get(dep.ticket_id);
      if (!pred?.start_date || !succ?.start_date) continue;
      const predEnd = ticketEnd(pred)!;
      if (succ.start_date <= predEnd) bad.add(succ.id);
    }
    for (const l of msLinks) {
      const t = ticketMap.get(l.ticket_id);
      const m = milestones.find(x => x.id === l.milestone_id);
      if (!t?.start_date || !m?.date) continue;
      if (l.ticket_is_pred) {
        // ticket must finish before the milestone date
        if (ticketEnd(t)! >= m.date) bad.add(t.id);
      } else {
        // ticket must start after the milestone date
        if (t.start_date <= m.date) bad.add(t.id);
      }
    }
    return bad;
  }, [deps, msLinks, ticketMap, milestones]);

  // Esc exits connect mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setConnectMode(false); setConnectFrom(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ctrl+wheel zoom
  function onWheel(e: React.WheelEvent) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(z => Math.min(2.5, Math.max(0.5, z * (e.deltaY < 0 ? 1.1 : 0.9))));
  }

  // Double-click empty lane space creates a ticket in place
  async function onLaneDoubleClick(e: React.MouseEvent, laneId: string, laneTop: number) {
    if (!boardRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top - HEADER_H;
    const row = Math.max(0, Math.floor((y - laneTop - LANE_PAD) / (ticketH + LANE_PAD)));
    await createTicket({ lane_id: laneId, start_date: dateForX(x), row_index: row });
  }

  const editingTicket = editing ? ticketMap.get(editing) ?? null : null;

  // Ghost line position while dragging the active line
  const lineGhostX = drag?.kind === "line" && ghost ? ghost.x : null;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex select-none flex-col gap-2">
      {error && (
        <div className="flex items-center gap-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-700">✕</button>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <button onClick={() => createTicket({})}
          className="rounded bg-[#1A3560] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#152b4e]">+ Ticket</button>
        <button onClick={() => setShowLaneForm(v => !v)}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">+ Swimlane</button>
        <button onClick={() => setShowMsForm(v => !v)}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">+ Milestone</button>
        <button onClick={() => { setConnectMode(v => !v); setConnectFrom(null); }}
          className={`rounded border px-3 py-1.5 text-sm ${connectMode ? "border-[#1A3560] bg-[#1A3560] text-white" : "border-zinc-300 text-zinc-700 hover:bg-zinc-50"}`}
          title="Connect mode: click a predecessor ticket, then its successor">
          🔗 Connect
        </button>
        <div className="ml-2 flex items-center gap-1">
          <button onClick={() => setZoom(z => Math.max(0.5, z - 0.15))}
            className="rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-50">−</button>
          <span className="w-10 text-center text-xs text-zinc-500">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(2.5, z + 0.15))}
            className="rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-50">+</button>
        </div>
        {connectMode && (
          <span className="text-xs font-medium text-[#1A3560]">
            {connectFrom ? "Now click the ticket that FOLLOWS." : "Click the ticket that comes FIRST."} (Esc to exit)
          </span>
        )}
        {filtersActive && <span className="text-xs text-amber-600">🔍 Filters active</span>}
      </div>

      {showLaneForm && (
        <div className="flex items-center gap-2 px-1">
          <input value={newLaneName} onChange={e => setNewLaneName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addLane()} placeholder="Swimlane name" autoFocus
            className="w-72 rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6]" />
          <button onClick={addLane} className="rounded bg-[#1A3560] px-3 py-1.5 text-sm text-white">Add</button>
        </div>
      )}
      {showMsForm && (
        <div className="flex items-center gap-2 px-1">
          <input value={msLabel} onChange={e => setMsLabel(e.target.value)} placeholder="Milestone label" autoFocus
            className="w-64 rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6]" />
          <input type="date" value={msDate} onChange={e => setMsDate(e.target.value)}
            title="Optional — leave blank to add to the tray"
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6]" />
          <span className="text-[10px] text-zinc-400">date optional — blank goes to the tray</span>
          <button onClick={addMilestone} className="rounded bg-[#1A3560] px-3 py-1.5 text-sm text-white">Add</button>
        </div>
      )}

      {/* ── Ticket tray ── */}
      <div ref={trayRef}
        className="flex min-h-[64px] flex-wrap items-start gap-2 rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 p-2">
        <span className="w-full text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Ticket Tray — drag onto the board</span>
        {trayTickets.length === 0 && <span className="text-xs italic text-zinc-400">Empty. Click “+ Ticket” or double-click the board.</span>}
        {trayTickets.map(t => (
          <div key={t.id}
            onPointerDown={e => { if (canEdit(t)) startDrag(e, { kind: "ticket", id: t.id, grabX: 20, grabY: 20 }); else handleTicketClick(t); }}
            className={canEdit(t) ? "cursor-grab" : "cursor-pointer"}>
            <TicketCard t={t} role={t.role_id ? roleMap.get(t.role_id) : undefined}
              location={t.location_id ? locMap.get(t.location_id) : undefined}
              responsible={memberMap.get(t.responsible_id ?? t.owner_id)}
              hid={isHid(t)} connectFrom={connectFrom?.kind === "ticket" && connectFrom.id === t.id} compact />
          </div>
        ))}
        {/* Tray milestones */}
        {milestones.filter(m => !m.date).map(m => (
          <div key={m.id}
            className="relative flex h-[64px] w-[64px] cursor-grab items-center justify-center"
            style={{ touchAction: "none" }}
            onPointerDown={e => startDrag(e, { kind: "milestone", id: m.id })}
            onDoubleClick={() => removeMilestone(m.id)}
            title={`Milestone: ${m.label} — drag onto the board (double-click to remove)`}>
            <div className="absolute inset-1.5 rotate-45 rounded-[3px] border border-zinc-400 bg-zinc-200 shadow" />
            <span className="relative px-1 text-center text-[8px] font-bold leading-tight text-zinc-800">{m.label}</span>
          </div>
        ))}
      </div>

      {/* ── Sidebar + Board ── */}
      <div className="flex overflow-hidden rounded-lg border border-zinc-300 bg-white" style={{ height: "68vh" }}>
        <IconRail open={panel} onToggle={p => setPanel(cur => (cur === p ? null : p))} />

        {panel === "constraints" && (
          <PanelShell title="Constraints" onClose={() => setPanel(null)}>
            <ConstraintsPanel tickets={tickets} onOpen={id => setEditing(id)} />
          </PanelShell>
        )}
        {panel === "members" && (
          <PanelShell title="Members" onClose={() => setPanel(null)}>
            <MembersPanel members={members} />
          </PanelShell>
        )}
        {panel === "roles" && (
          <PanelShell title="Roles / Trades" onClose={() => setPanel(null)}>
            <RolesPanel roles={roles} onAdd={addRole} onRemove={removeRole} />
          </PanelShell>
        )}
        {panel === "locations" && (
          <PanelShell title="Locations" onClose={() => setPanel(null)}>
            <LocationsPanel locations={locations} onAdd={addLocation} onRemove={removeLocation} />
          </PanelShell>
        )}
        {panel === "filters" && (
          <PanelShell title="Filters" onClose={() => setPanel(null)}>
            <FilterPanel roles={roles} members={members} locations={locations} filters={filters} onChange={setFilters} />
          </PanelShell>
        )}
        {panel === "overview" && (
          <PanelShell title="Overview" onClose={() => setPanel(null)}>
            <OverviewPanel tickets={tickets} />
          </PanelShell>
        )}

        {/* Scrollable board */}
        <div className="flex-1 overflow-auto" onWheel={onWheel}>
          <div ref={boardRef} className="relative" style={{ width: totalW, height: HEADER_H + Math.max(lanesH, 200) }}>

            {/* ── Header ── */}
            <div className="sticky top-0 z-30 flex border-b border-zinc-300 bg-white" style={{ height: HEADER_H, width: totalW }}>
              {/* Active zone: daily columns */}
              {activeDayList.map(d => {
                const dt = parseISODate(d);
                const dow = dt.getDay();
                const isWknd = dow === 0 || dow === 6;
                const isMon = dow === 1;
                const isToday = d === today;
                return (
                  <div key={d}
                    className={`flex shrink-0 flex-col justify-end border-r border-zinc-200 pb-0.5 text-center ${isWknd ? "bg-zinc-200" : "bg-zinc-50"}`}
                    style={{ width: dayW }}>
                    <div className={`text-[8px] font-bold ${isToday ? "text-[#2E6EA6]" : "text-zinc-500"}`}>
                      {isMon ? fmtShort(d) : dt.getDate()}
                    </div>
                    <div className={`text-[8px] ${isToday ? "font-bold text-[#2E6EA6]" : "text-zinc-400"}`}>
                      {dt.toLocaleDateString("en-CA", { weekday: "short" })}
                    </div>
                  </div>
                );
              })}
              {/* Active line header stub */}
              <div className="shrink-0" style={{ width: LINE_W, backgroundColor: "#3f3f46" }} />
              {/* Future zone: charcoal week headers with orange tick */}
              {futureWeekList.map(d => (
                <div key={d} className="relative flex shrink-0 items-center justify-center border-r border-[#5a5f65]"
                  style={{ width: weekW, backgroundColor: "#4a4f55" }}>
                  <span className="text-[10px] font-semibold text-white">
                    {parseISODate(d).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                  <span className="absolute bottom-0 left-1/2 h-[3px] w-3 -translate-x-1/2 bg-orange-400" />
                </div>
              ))}
            </div>

            {/* ── Lanes ── */}
            {laneLayouts.length === 0 && (
              <div className="p-8 text-center text-sm text-zinc-400">
                No swimlanes yet — click “+ Swimlane” to add areas or shifts.
              </div>
            )}
            {laneLayouts.map(ll => (
              <div key={ll.lane.id} className="relative border-b border-zinc-300"
                style={{ height: ll.height }}
                onDoubleClick={e => onLaneDoubleClick(e, ll.lane.id, ll.top)}>
                {/* Zone backgrounds */}
                <div className="absolute inset-y-0 left-0" style={{ width: activeW, backgroundColor: ll.tints[0] }} />
                <div className="absolute inset-y-0" style={{ left: activeW + LINE_W, width: futureW, backgroundColor: ll.tints[1] }} />
                {/* Weekend shading + day gridlines (active zone) */}
                {activeDayList.map((d, i) => {
                  const dow = parseISODate(d).getDay();
                  return (
                    <div key={d} className="absolute inset-y-0 border-r border-black/5"
                      style={{ left: i * dayW, width: dayW, backgroundColor: dow === 0 || dow === 6 ? "rgba(0,0,0,.06)" : undefined }} />
                  );
                })}
                {/* Week gridlines (future zone) */}
                {futureWeekList.map((d, i) => (
                  <div key={d} className="absolute inset-y-0 border-r border-black/10"
                    style={{ left: activeW + LINE_W + i * weekW, width: weekW }} />
                ))}
                {/* Lane name pill — sticky so it stays visible while scrolling */}
                <div className="sticky left-1 top-1 z-10 w-fit pt-1 pl-1">
                  <span className="rounded bg-zinc-500/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow">
                    {ll.lane.name}
                    <button onClick={e => { e.stopPropagation(); removeLane(ll.lane.id); }}
                      className="ml-1.5 text-white/50 hover:text-white" title="Remove swimlane">✕</button>
                  </span>
                </div>
              </div>
            ))}

            {/* ── Tickets ── */}
            {laneLayouts.flatMap(ll => ll.list.map(t => {
              const pos = ticketPos.get(t.id);
              if (!pos || t.start_date! > boardEnd) return null;
              const dragging = drag?.kind === "ticket" && drag.id === t.id && ghost;
              const left = dragging ? ghost!.x - (drag as { grabX: number }).grabX : pos.x;
              const top = dragging ? ghost!.y - (drag as { grabY: number }).grabY : HEADER_H + pos.y;
              return (
                <div key={t.id}
                  className={`absolute ${dragging ? "z-40 opacity-80" : "z-10"} ${canEdit(t) ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                  style={{ left, top, width: pos.w, touchAction: "none" }}
                  onPointerDown={e => {
                    if ((e.target as HTMLElement).dataset.resize) return;
                    if (canEdit(t) && !t.status.startsWith("done_")) {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      startDrag(e, { kind: "ticket", id: t.id, grabX: e.clientX - rect.left, grabY: e.clientY - rect.top });
                    } else {
                      handleTicketClick(t);
                    }
                  }}>
                  <TicketCard t={t} role={t.role_id ? roleMap.get(t.role_id) : undefined}
                    location={t.location_id ? locMap.get(t.location_id) : undefined}
                    responsible={memberMap.get(t.responsible_id ?? t.owner_id)}
                    width={pos.w} height={ticketH} hid={isHid(t)}
                    connectFrom={connectFrom?.kind === "ticket" && connectFrom.id === t.id}
                    outOfSeq={outOfSeqIds.has(t.id)}
                    onToggleWeekend={canEdit(t) ? dow => patchTicket(t.id, dow === 6 ? { work_sat: !t.work_sat } : { work_sun: !t.work_sun }) : undefined} />
                  {/* Resize handle */}
                  {canEdit(t) && !t.status.startsWith("done_") && (
                    <div data-resize="1"
                      className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-white/40"
                      onPointerDown={e => startDrag(e, { kind: "resize", id: t.id })} />
                  )}
                </div>
              );
            }))}

            {/* ── Dependency arrows ── */}
            {lanesH > 0 && (
              // Below tickets (z-10) so arrow hit-areas never block ticket dragging
              <svg className="absolute" style={{ left: 0, top: HEADER_H, width: totalW, height: lanesH, pointerEvents: "none", zIndex: 5 }}>
                <defs>
                  <marker id="pp-arr" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                    <path d="M0,0 L7,3.5 L0,7 z" fill="#2E6EA6" />
                  </marker>
                  <marker id="pp-arr-red" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                    <path d="M0,0 L7,3.5 L0,7 z" fill="#dc2626" />
                  </marker>
                </defs>
                {deps.map(dep => {
                  const from = ticketPos.get(dep.predecessor_id);
                  const to = ticketPos.get(dep.ticket_id);
                  if (!from || !to) return null;
                  const pred = ticketMap.get(dep.predecessor_id);
                  const succ = ticketMap.get(dep.ticket_id);
                  const bad = !!(pred?.start_date && succ?.start_date && succ.start_date <= ticketEnd(pred)!);
                  const x1 = from.x + from.w, y1 = from.y + ticketH / 2;
                  const x2 = to.x, y2 = to.y + ticketH / 2;
                  const c = Math.max(16, Math.min(50, (x2 - x1) / 2));
                  const d = `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2 - 2} ${y2}`;
                  return (
                    <g key={`${dep.ticket_id}-${dep.predecessor_id}`}>
                      <path d={d} fill="none" stroke="transparent" strokeWidth="10" style={{ pointerEvents: "stroke", cursor: "pointer" }}
                        onClick={() => { if (confirm("Remove this connection?")) removeDep(dep.ticket_id, dep.predecessor_id); }} />
                      <path d={d} fill="none" stroke={bad ? "#dc2626" : "#2E6EA6"} strokeWidth={bad ? 2.2 : 1.8}
                        markerEnd={bad ? "url(#pp-arr-red)" : "url(#pp-arr)"} opacity={0.85} />
                    </g>
                  );
                })}
                {msLinks.map(l => {
                  const m = milestones.find(x => x.id === l.milestone_id);
                  const tp = ticketPos.get(l.ticket_id);
                  const t = ticketMap.get(l.ticket_id);
                  const mp = m ? msPos.get(m.id) : undefined;
                  if (!m || !m.date || !mp || !tp || !t) return null;
                  const mx = mp.cx;
                  const my = mp.cy;
                  const bad = outOfSeqIds.has(t.id) &&
                    (l.ticket_is_pred ? ticketEnd(t)! >= m.date : t.start_date! <= m.date);
                  let x1: number, y1: number, x2: number, y2: number;
                  if (l.ticket_is_pred) {
                    x1 = tp.x + tp.w; y1 = tp.y + ticketH / 2;
                    x2 = mx - msSize / 2 - 2; y2 = my;
                  } else {
                    x1 = mx + msSize / 2 + 2; y1 = my;
                    x2 = tp.x; y2 = tp.y + ticketH / 2;
                  }
                  const c = Math.max(16, Math.min(50, (x2 - x1) / 2));
                  const d = `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2 - 2} ${y2}`;
                  return (
                    <g key={l.id}>
                      <path d={d} fill="none" stroke="transparent" strokeWidth="10" style={{ pointerEvents: "stroke", cursor: "pointer" }}
                        onClick={() => { if (confirm("Remove this connection?")) removeMsLink(l.id); }} />
                      <path d={d} fill="none" stroke={bad ? "#dc2626" : "#2E6EA6"} strokeWidth={bad ? 2.2 : 1.8}
                        markerEnd={bad ? "url(#pp-arr-red)" : "url(#pp-arr)"} opacity={0.85} />
                    </g>
                  );
                })}
              </svg>
            )}

            {/* ── Milestones (diamonds) ── */}
            {milestones.map(m => {
              if (!m.date) return null; // in the tray
              const pos = msPos.get(m.id);
              if (!pos || m.date > boardEnd) return null;
              const size = msSize;
              const isFrom = connectFrom?.kind === "milestone" && connectFrom.id === m.id;
              const dragging = drag?.kind === "milestone" && drag.id === m.id && ghost;
              const left = dragging ? ghost!.x - size / 2 : pos.cx - size / 2;
              const top = dragging ? ghost!.y - size / 2 : HEADER_H + pos.cy - size / 2;
              return (
                <div key={m.id}
                  className={`absolute flex items-center justify-center ${dragging ? "z-40 opacity-80" : "z-20"} ${connectMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}`}
                  style={{ left, top, width: size, height: size, touchAction: "none" }}
                  onPointerDown={e => startDrag(e, { kind: "milestone", id: m.id })}
                  onDoubleClick={() => { if (!connectMode) removeMilestone(m.id); }}
                  title={`Milestone: ${m.label} — ${m.date}${connectMode ? " (click to connect)" : " (drag to move, double-click to remove)"}`}>
                  <div className="absolute inset-0 rotate-45 rounded-[3px] border border-zinc-400 shadow-md"
                    style={{ backgroundColor: "#e5e7eb", outline: isFrom ? "3px solid #1A3560" : undefined }} />
                  <span className="relative px-2 text-center font-bold leading-tight text-zinc-800"
                    style={{ fontSize: Math.max(7, Math.round(9 * zoom)) }}>{m.label}</span>
                </div>
              );
            })}

            {/* ── Active line ── */}
            <div
              className="absolute z-30 flex cursor-ew-resize items-start justify-center"
              style={{ left: lineGhostX !== null ? lineGhostX - LINE_W / 2 : activeW, top: 0, width: LINE_W, height: HEADER_H + Math.max(lanesH, 200), backgroundColor: "#3f3f46", opacity: lineGhostX !== null ? 0.6 : 1 }}
              onPointerDown={e => startDrag(e, { kind: "line" })}
              title={`Active line: ${activeDate} — drag to move`}>
              <span className="mt-3 whitespace-nowrap text-[9px] font-bold tracking-wider text-white" style={{ writingMode: "vertical-rl" }}>
                Active {fmtShort(activeDate)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center gap-4 px-1 text-[11px] text-zinc-500">
        {roles.map(r => (
          <span key={r.id} className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: r.color }} />{r.name}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-3">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full border border-zinc-400 bg-zinc-900 align-middle" />promised</span>
          <span>🚧 constraint</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-green-600 align-middle" />early</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-600 align-middle" />on time</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-600 align-middle" />late</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded-sm border-2 border-red-600 align-middle" />out of sequence</span>
        </span>
      </div>

      {/* ── Edit modal ── */}
      {editingTicket && (
        <TicketModal
          key={editingTicket.id}
          ticket={editingTicket}
          lanes={lanes}
          roles={roles}
          locations={locations}
          members={members}
          allTickets={tickets}
          predIds={deps.filter(d => d.ticket_id === editingTicket.id).map(d => d.predecessor_id)}
          editable={canEdit(editingTicket)}
          onPatch={patch => patchTicket(editingTicket.id, patch)}
          onSetDeps={ids => setTicketDeps(editingTicket.id, ids)}
          onPromise={() => promiseTicket(editingTicket)}
          onStart={() => patchTicket(editingTicket.id, { status: "in_progress" })}
          completionOutcome={completionOutcome(editingTicket)}
          onComplete={(reason, note) => completeTicket(editingTicket, reason, note)}
          onDelete={() => deleteTicket(editingTicket.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
