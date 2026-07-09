"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  Profile, PullLane, PullTicket, PullMilestone, PullTicketStatus,
  PullRole, PullTicketDep, PullLocation, PullMilestoneLink, PullSnapshot, PullSnapshotData,
  PullConstraint, PullConstraintLink, PullTicketSupport, Task, TaskDependency,
} from "@/lib/supabase/types";
import { addDays, countWorkingDays, diffInDays, formatISODate, parseISODate, todayISO } from "@/lib/date";
import TicketCard, { ticketEnd } from "./TicketCard";
import TicketModal from "./TicketModal";
import {
  IconRail, PanelShell, RolesPanel, LocationsPanel, MembersPanel,
  ConstraintsPanel, FilterPanel, OverviewPanel, SnapshotsPanel,
  type PanelId, type Filters,
} from "./Sidebar";

// ─── Layout constants (scaled by zoom) ─────────────────────────────────────────
const BASE_DAY_W = 36;    // active-zone day column
const LINE_W = 14;        // active line bar
const LANE_PAD = 8;
const HEADER_H = 44;
const ACTIVE_WEEKS_BEFORE = 2;  // active zone shows 2 weeks before the active line
const INACTIVE_W = 240;         // fixed-width "Inactive" holding panel (no date grid)

const LANE_TINTS: [string, string][] = [
  ["#eaf6f2", "#dff0ea"], // mint  [active side, inactive side]
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
  | { kind: "constraint"; id: string }
  | { kind: "resize"; id: string }
  | { kind: "line" };

const PRIORITY_RING: Record<PullConstraint["priority"], string> = {
  on_track: "#9ca3af",
  needs_attention: "#f59e0b",
  critical: "#dc2626",
};

export default function PullPlanBoard({
  initialLanes, initialTickets, initialMilestones, initialRoles, initialDeps,
  initialMsLinks = [], initialLocations, initialSnapshots = [], initialConstraints = [], initialCLinks = [],
  initialSupport = [], masterTasks = [], masterDeps = [], lookaheadProjectId = null,
  initialImportSkips = [],
  initialActiveDate, members, currentUserId, isAdmin,
}: {
  initialLanes: PullLane[];
  initialTickets: PullTicket[];
  initialMilestones: PullMilestone[];
  initialRoles: PullRole[];
  initialDeps: PullTicketDep[];
  initialMsLinks?: PullMilestoneLink[];
  initialLocations: PullLocation[];
  initialSnapshots?: PullSnapshot[];
  initialConstraints?: PullConstraint[];
  initialCLinks?: PullConstraintLink[];
  initialSupport?: PullTicketSupport[];
  masterTasks?: Task[];
  masterDeps?: TaskDependency[];
  lookaheadProjectId?: string | null;
  initialImportSkips?: string[];
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
  const [snapshots, setSnapshots] = useState<PullSnapshot[]>(initialSnapshots);
  const [snapBusy, setSnapBusy] = useState(false);
  const [constraints, setConstraints] = useState<PullConstraint[]>(initialConstraints);
  const [cLinks, setCLinks] = useState<PullConstraintLink[]>(initialCLinks);
  const [support, setSupport] = useState<PullTicketSupport[]>(initialSupport);
  const [importSkips, setImportSkips] = useState<Set<string>>(() => new Set(initialImportSkips));
  const [importBusy, setImportBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [editingConstraint, setEditingConstraint] = useState<string | null>(null);
  const [showCForm, setShowCForm] = useState(false);
  const [cDesc, setCDesc] = useState("");
  const [cNeedBy, setCNeedBy] = useState("");
  const [cPriority, setCPriority] = useState<PullConstraint["priority"]>("on_track");
  const [activeDate, setActiveDate] = useState<string>(initialActiveDate ?? todayISO());
  const [zoom, setZoom] = useState(1);
  const [panel, setPanel] = useState<PanelId>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState<{ kind: "ticket" | "milestone" | "constraint"; id: string } | null>(null);
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
  // Only the active zone (up to the active line) is positioned by date. Everything
  // starting after the active line sits in a fixed-width "Inactive" panel as plain
  // square cards — no date grid, no arrows. The moment the active line reaches an
  // item's start date, it flips into the date-positioned active zone automatically.
  const dayW = Math.round(BASE_DAY_W * zoom);
  const ticketH = Math.max(28, Math.round(dayW * 1.1)); // ~square for a 1-day ticket
  const msSize = Math.max(30, Math.round(54 * zoom));   // milestone/constraint circle scales with zoom
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
  const totalW = activeW + LINE_W + INACTIVE_W;

  // Dates beyond the active line clamp to the line itself — a bar that runs past
  // it is visually cut off there, since anything beyond is the inactive panel.
  function xForDate(d: string): number {
    if (d <= activeDate) return diffInDays(activeStart, d) * dayW;
    return activeW;
  }
  function widthForTicket(t: PullTicket): number {
    const end = ticketEnd(t)!;
    return Math.max(26, xForDate(addDays(end, 1)) - xForDate(t.start_date!) - 4);
  }
  // Only meaningful for drops inside the active zone; a drop past the line just
  // needs SOME date after the active line to classify the item as inactive.
  function dateForX(x: number): string {
    if (x < activeW) return addDays(activeStart, Math.max(0, Math.floor(x / dayW)));
    if (x < activeW + LINE_W) return activeDate;
    return addDays(activeDate, 1);
  }

  const activeDayList = useMemo(
    () => Array.from({ length: activeDays }, (_, i) => addDays(activeStart, i)),
    [activeStart, activeDays]
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
  // "Active" items (start_date <= activeDate) are positioned by date and stacked
  // via row_index. "Inactive" items (start_date > activeDate) are plain squares
  // in the lane's Inactive panel — no date position, no row_index, no arrows.
  const laneLayouts = useMemo(() => {
    let top = 0;
    return lanes.map((lane, idx) => {
      const allT = tickets.filter(t => t.lane_id === lane.id && t.start_date);
      const allM = milestones.filter(m => m.lane_id === lane.id && m.date);
      const allC = constraints.filter(c => c.lane_id === lane.id && c.date);
      const list = allT.filter(t => t.start_date! <= activeDate);
      const laneMs = allM.filter(m => m.date! <= activeDate);
      const laneCs = allC.filter(c => c.date! <= activeDate);
      const inactiveTickets = allT.filter(t => t.start_date! > activeDate);
      const inactiveMilestones = allM.filter(m => m.date! > activeDate);
      const inactiveConstraints = allC.filter(c => c.date! > activeDate);
      const maxRow = Math.max(
        list.reduce((m, t) => Math.max(m, t.row_index), 0),
        laneMs.reduce((m, x) => Math.max(m, x.row_index), 0),
        laneCs.reduce((m, x) => Math.max(m, x.row_index), 0)
      );
      const rows = Math.max(2, maxRow + 2); // spare row at the bottom for dropping
      const height = rows * (ticketH + LANE_PAD) + LANE_PAD;
      const layout = {
        lane, list, rows, height, top, tints: LANE_TINTS[idx % LANE_TINTS.length],
        inactiveTickets, inactiveMilestones, inactiveConstraints,
      };
      top += height;
      return layout;
    });
  }, [lanes, tickets, milestones, constraints, ticketH, activeDate]);
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
  }, [laneLayouts, dayW, activeDate]);

  // Milestone diamond centers (lane placement, or floating at the top if no lane)
  const msPos = useMemo(() => {
    const map = new Map<string, { cx: number; cy: number }>();
    for (const m of milestones) {
      if (!m.date || m.date > activeDate) continue;
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
  }, [milestones, laneLayouts, dayW, activeDate, ticketH, msSize]);

  // Constraint circle centers (same placement rules as milestones)
  const cPos = useMemo(() => {
    const map = new Map<string, { cx: number; cy: number }>();
    for (const c of constraints) {
      if (!c.date || c.date > activeDate) continue;
      const cx = xForDate(c.date) + dayW / 2;
      const ll = c.lane_id ? laneLayouts.find(l => l.lane.id === c.lane_id) : undefined;
      if (ll) {
        const row = Math.min(ll.rows - 1, c.row_index);
        map.set(c.id, { cx, cy: ll.top + LANE_PAD + row * (ticketH + LANE_PAD) + ticketH / 2 });
      } else {
        map.set(c.id, { cx, cy: 14 + msSize / 2 });
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [constraints, laneLayouts, dayW, activeDate, ticketH, msSize]);

  // ── DB helpers ──────────────────────────────────────────────────────────────
  async function patchTicket(id: string, patch: Partial<PullTicket>) {
    setTickets(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));
    const { error: err } = await supa.from("pull_tickets").update(patch).eq("id", id);
    if (err) setError(err.message);
  }

  async function createTicket(fields: Partial<PullTicket>) {
    const { data, error: err } = await supa
      .from("pull_tickets")
      .insert({ owner_id: currentUserId, description: "New task", duration: 1, ...fields })
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
    const t = ticketMap.get(id);
    setTickets(prev => prev.filter(t => t.id !== id));
    setDeps(prev => prev.filter(d => d.ticket_id !== id && d.predecessor_id !== id));
    setEditing(null);
    await supa.from("pull_tickets").delete().eq("id", id);
    if (t?.source_task_id) {
      setImportSkips(prev => new Set(prev).add(t.source_task_id!));
      await supa.from("pull_import_skips").insert({ task_id: t.source_task_id }); // ignore duplicate-key errors
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

  // ── Constraints (first-class circle tickets) ────────────────────────────────
  async function addConstraint() {
    if (!cDesc.trim()) return;
    const { data, error: err } = await supa.from("pull_constraints")
      .insert({ description: cDesc.trim(), need_by: cNeedBy || null, priority: cPriority })
      .select("id, description, lane_id, date, row_index, need_by, priority, responsible_id, note, resolved")
      .single();
    if (err) { setError(err.message); return; }
    if (data) setConstraints(prev => [...prev, data as PullConstraint]);
    setCDesc(""); setCNeedBy(""); setCPriority("on_track"); setShowCForm(false);
  }

  async function patchConstraint(id: string, patch: Partial<PullConstraint>) {
    setConstraints(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
    const { error: err } = await supa.from("pull_constraints").update(patch).eq("id", id);
    if (err) setError(err.message);
  }

  async function deleteConstraint(id: string) {
    setConstraints(prev => prev.filter(c => c.id !== id));
    setCLinks(prev => prev.filter(l => l.constraint_id !== id));
    setEditingConstraint(null);
    await supa.from("pull_constraints").delete().eq("id", id);
  }

  async function addCLink(constraintId: string, ticketId: string) {
    if (cLinks.some(l => l.constraint_id === constraintId && l.ticket_id === ticketId)) return;
    const tempId = `tmp-${Date.now()}`;
    setCLinks(prev => [...prev, { id: tempId, constraint_id: constraintId, ticket_id: ticketId }]);
    const { data, error: err } = await supa.from("pull_constraint_links")
      .insert({ constraint_id: constraintId, ticket_id: ticketId })
      .select("id, constraint_id, ticket_id").single();
    if (err) { setError(err.message); setCLinks(prev => prev.filter(l => l.id !== tempId)); return; }
    if (data) setCLinks(prev => prev.map(l => (l.id === tempId ? (data as PullConstraintLink) : l)));
  }

  async function removeCLink(id: string) {
    setCLinks(prev => prev.filter(l => l.id !== id));
    await supa.from("pull_constraint_links").delete().eq("id", id);
  }

  async function removeMilestone(id: string) {
    if (!confirm("Remove this milestone?")) return;
    const m = milestones.find(x => x.id === id);
    setMilestones(prev => prev.filter(m => m.id !== id));
    await supa.from("pull_milestones").delete().eq("id", id);
    if (m?.source_task_id) {
      setImportSkips(prev => new Set(prev).add(m.source_task_id!));
      await supa.from("pull_import_skips").insert({ task_id: m.source_task_id });
    }
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

  // ── Snapshots ───────────────────────────────────────────────────────────────
  async function takeSnapshot(name: string) {
    setSnapBusy(true);
    const data: PullSnapshotData = { lanes, tickets, milestones, deps, msLinks, active_date: activeDate };
    const { data: row, error: err } = await supa.from("pull_snapshots")
      .insert({ name, created_by: currentUserId, data })
      .select("id, name, created_by, data, created_at").single();
    if (err) setError(err.message);
    else if (row) setSnapshots(prev => [row as PullSnapshot, ...prev]);
    setSnapBusy(false);
  }

  const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

  async function restoreSnapshot(id: string) {
    const snap = snapshots.find(s => s.id === id);
    if (!snap) return;
    if (!confirm(`Restore snapshot “${snap.name}”? This REPLACES the entire current board.`)) return;
    setSnapBusy(true);
    try {
      const d = snap.data;
      // Wipe current board (children first for FK order)
      let err =
        (await supa.from("pull_milestone_links").delete().neq("ticket_id", ZERO_UUID)).error ||
        (await supa.from("pull_ticket_deps").delete().neq("ticket_id", ZERO_UUID)).error ||
        (await supa.from("pull_tickets").delete().neq("id", ZERO_UUID)).error ||
        (await supa.from("pull_milestones").delete().neq("id", ZERO_UUID)).error ||
        (await supa.from("pull_lanes").delete().neq("id", ZERO_UUID)).error;
      if (err) throw err;

      // Re-insert, nulling references to roles/locations/members that no longer exist
      const roleIds = new Set(roles.map(r => r.id));
      const locIds = new Set(locations.map(l => l.id));
      const memberIds = new Set(members.map(m => m.id));
      const cleanTickets = d.tickets.map(t => ({
        ...t,
        role_id: t.role_id && roleIds.has(t.role_id) ? t.role_id : null,
        location_id: t.location_id && locIds.has(t.location_id) ? t.location_id : null,
        responsible_id: t.responsible_id && memberIds.has(t.responsible_id) ? t.responsible_id : null,
        owner_id: memberIds.has(t.owner_id) ? t.owner_id : currentUserId,
      }));

      if (d.lanes.length) { err = (await supa.from("pull_lanes").insert(d.lanes)).error; if (err) throw err; }
      if (d.milestones.length) { err = (await supa.from("pull_milestones").insert(d.milestones)).error; if (err) throw err; }
      if (cleanTickets.length) { err = (await supa.from("pull_tickets").insert(cleanTickets)).error; if (err) throw err; }
      if (d.deps.length) { err = (await supa.from("pull_ticket_deps").insert(d.deps)).error; if (err) throw err; }
      if (d.msLinks.length) { err = (await supa.from("pull_milestone_links").insert(d.msLinks)).error; if (err) throw err; }
      await supa.from("pull_settings").update({ active_date: d.active_date }).eq("id", 1);

      setLanes(d.lanes);
      setMilestones(d.milestones);
      setTickets(cleanTickets);
      setDeps(d.deps);
      setMsLinks(d.msLinks);
      setActiveDate(d.active_date);
      setEditing(null);
    } catch (e) {
      setError(`Restore failed: ${(e as { message?: string }).message ?? String(e)}. Reload the page before continuing.`);
    }
    setSnapBusy(false);
  }

  async function deleteSnapshot(id: string) {
    if (!confirm("Delete this snapshot?")) return;
    setSnapshots(prev => prev.filter(s => s.id !== id));
    await supa.from("pull_snapshots").delete().eq("id", id);
  }

  // ── Support members on tickets ──────────────────────────────────────────────
  async function setTicketSupport(ticketId: string, userIds: string[]) {
    setSupport(prev => [
      ...prev.filter(s => s.ticket_id !== ticketId),
      ...userIds.map(u => ({ ticket_id: ticketId, user_id: u })),
    ]);
    await supa.from("pull_ticket_support").delete().eq("ticket_id", ticketId);
    if (userIds.length > 0) {
      const { error: err } = await supa.from("pull_ticket_support")
        .insert(userIds.map(u => ({ ticket_id: ticketId, user_id: u })));
      if (err) setError(err.message);
    }
  }

  // ── Import Master: bring non-active master tasks onto the board ────────────
  async function importMaster() {
    if (importBusy) return;
    setImportBusy(true);
    try {
      const NO_HOL = new Set<string>();
      // WBS numbering over the whole master schedule (matches the Gantt's "#")
      const childrenOf = new Map<string | null, Task[]>();
      for (const t of masterTasks) {
        const k = t.parent_id ?? null;
        if (!childrenOf.has(k)) childrenOf.set(k, []);
        childrenOf.get(k)!.push(t);
      }
      for (const g of childrenOf.values()) g.sort((a, b) => a.sort_order - b.sort_order);
      const wbs = new Map<string, string>();
      (function walk(pid: string | null, prefix: string) {
        (childrenOf.get(pid) ?? []).forEach((t, i) => {
          const label = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
          wbs.set(t.id, label);
          walk(t.id, label);
        });
      })(null, "");

      const alreadyImported = new Set<string>([
        ...tickets.map(t => t.source_task_id).filter((x): x is string => !!x),
        ...milestones.map(m => m.source_task_id).filter((x): x is string => !!x),
      ]);
      const isLeaf = (t: Task) => (childrenOf.get(t.id) ?? []).length === 0;
      const candidates = masterTasks.filter(t =>
        isLeaf(t) && !t.is_constraint && t.start_date >= activeDate
        && !alreadyImported.has(t.id) && !importSkips.has(t.id)
      );
      if (candidates.length === 0) {
        setError("Nothing new to import — all master tasks past the active line are already on the board.");
        setImportBusy(false);
        return;
      }
      if (!confirm(`Import ${candidates.length} master schedule item${candidates.length > 1 ? "s" : ""} from ${activeDate} onward into the “Undefined” swimlane?`)) {
        setImportBusy(false);
        return;
      }

      // Ensure the "Undefined" swimlane exists (at the bottom)
      let undefLane = lanes.find(l => l.name.toLowerCase() === "undefined");
      if (!undefLane) {
        const { data, error: err } = await supa.from("pull_lanes")
          .insert({ name: "Undefined", sort_order: lanes.length })
          .select("id, name, sort_order").single();
        if (err) throw err;
        undefLane = data as PullLane;
        setLanes(prev => [...prev, undefLane!]);
      }

      const roleIds = new Set(roles.map(r => r.id));
      const memberIds = new Set(members.map(m => m.id));

      // Greedy row stacking within the Undefined lane (respect existing occupants)
      const rows: { end: string }[] = [];
      for (const t of tickets.filter(x => x.lane_id === undefLane!.id && x.start_date)) {
        const e = ticketEnd(t)!;
        const r = t.row_index;
        while (rows.length <= r) rows.push({ end: "0000" });
        if (rows[r].end < e) rows[r].end = e;
      }
      function placeRow(start: string, end: string): number {
        for (let r = 0; r < rows.length; r++) {
          if (rows[r].end < start) { rows[r].end = end; return r; }
        }
        rows.push({ end });
        return rows.length - 1;
      }

      const newTickets: PullTicket[] = [];
      const newMilestones: PullMilestone[] = [];
      const taskToTicket = new Map<string, string>();
      const taskToMilestone = new Map<string, string>();
      for (const t of tickets) if (t.source_task_id) taskToTicket.set(t.source_task_id, t.id);
      for (const m of milestones) if (m.source_task_id) taskToMilestone.set(m.source_task_id, m.id);

      const sorted = [...candidates].sort((a, b) => a.start_date.localeCompare(b.start_date));
      for (const mt of sorted) {
        const label = `${wbs.get(mt.id) ?? ""} ${mt.title}`.trim();
        if (mt.is_milestone) {
          const id = crypto.randomUUID();
          newMilestones.push({
            id, label, date: mt.start_date, lane_id: undefLane.id,
            row_index: placeRow(mt.start_date, mt.start_date), source_task_id: mt.id,
          });
          taskToMilestone.set(mt.id, id);
        } else {
          const id = crypto.randomUUID();
          const dur = Math.max(1, countWorkingDays(mt.start_date, mt.end_date, mt.work_sat ?? false, mt.work_sun ?? false, NO_HOL));
          newTickets.push({
            id, lane_id: undefLane.id, owner_id: currentUserId,
            description: label, start_date: mt.start_date, duration: dur,
            crew_size: mt.crew_size ?? null, status: "planned",
            roadblock: false, roadblock_note: "", promised_end: null, sort_order: 0,
            role_id: mt.role_id && roleIds.has(mt.role_id) ? mt.role_id : null,
            responsible_id: mt.champion_id && memberIds.has(mt.champion_id) ? mt.champion_id : null,
            location: "", location_id: null,
            row_index: placeRow(mt.start_date, mt.end_date),
            work_sat: mt.work_sat ?? false, work_sun: mt.work_sun ?? false,
            notes: "", variance_reason: "", variance_note: "",
            roadblock_need_by: null, roadblock_priority: "on_track",
            source_task_id: mt.id,
          });
          taskToTicket.set(mt.id, id);
        }
      }

      // Auto-connect predecessors among imported (and previously imported) items
      const newDeps: PullTicketDep[] = [];
      const newMsLinks: Omit<PullMilestoneLink, "id">[] = [];
      for (const d of masterDeps) {
        const predT = taskToTicket.get(d.predecessor_id);
        const succT = taskToTicket.get(d.task_id);
        const predM = taskToMilestone.get(d.predecessor_id);
        const succM = taskToMilestone.get(d.task_id);
        if (predT && succT) {
          if (!deps.some(x => x.ticket_id === succT && x.predecessor_id === predT) &&
              !newDeps.some(x => x.ticket_id === succT && x.predecessor_id === predT)) {
            newDeps.push({ ticket_id: succT, predecessor_id: predT });
          }
        } else if (predM && succT) {
          if (!msLinks.some(x => x.ticket_id === succT && x.milestone_id === predM)) {
            newMsLinks.push({ ticket_id: succT, milestone_id: predM, ticket_is_pred: false });
          }
        } else if (predT && succM) {
          if (!msLinks.some(x => x.ticket_id === predT && x.milestone_id === succM)) {
            newMsLinks.push({ ticket_id: predT, milestone_id: succM, ticket_is_pred: true });
          }
        }
      }

      if (newMilestones.length) {
        const { error: err } = await supa.from("pull_milestones").insert(newMilestones);
        if (err) throw err;
      }
      if (newTickets.length) {
        const { error: err } = await supa.from("pull_tickets").insert(newTickets);
        if (err) throw err;
      }
      if (newDeps.length) {
        const { error: err } = await supa.from("pull_ticket_deps").insert(newDeps);
        if (err) throw err;
      }
      let insertedMsLinks: PullMilestoneLink[] = [];
      if (newMsLinks.length) {
        const { data, error: err } = await supa.from("pull_milestone_links")
          .insert(newMsLinks).select("id, ticket_id, milestone_id, ticket_is_pred");
        if (err) throw err;
        insertedMsLinks = (data ?? []) as PullMilestoneLink[];
      }

      setMilestones(prev => [...prev, ...newMilestones]);
      setTickets(prev => [...prev, ...newTickets]);
      setDeps(prev => [...prev, ...newDeps]);
      setMsLinks(prev => [...prev, ...insertedMsLinks]);
    } catch (e) {
      setError(`Import failed: ${(e as { message?: string }).message ?? String(e)}`);
    }
    setImportBusy(false);
  }

  // ── Export to Lookahead: publish the active section as the lookahead ───────
  async function exportToLookahead() {
    if (!lookaheadProjectId || exportBusy) return;
    const expTickets = tickets.filter(t => !t.status.startsWith("done_") && t.start_date && t.start_date <= activeDate);
    const expMilestones = milestones.filter(m => m.date && m.date <= activeDate);
    const expConstraints = constraints.filter(c => !c.resolved && c.date && c.date <= activeDate);
    const total = expTickets.length + expMilestones.length + expConstraints.length;
    if (total === 0) { setError("Nothing to export — no unfinished items on or before the active line."); return; }
    if (!confirm(`Export ${total} item${total > 1 ? "s" : ""} to the Lookahead? This DELETES everything currently in the lookahead and replaces it.`)) return;
    setExportBusy(true);
    try {
      // Wipe the current lookahead
      const { data: oldTasks, error: qErr } = await supa.from("tasks").select("id").eq("project_id", lookaheadProjectId);
      if (qErr) throw qErr;
      const oldIds = (oldTasks ?? []).map(t => t.id);
      if (oldIds.length) {
        await supa.from("task_dependencies").delete().in("task_id", oldIds);
        await supa.from("task_dependencies").delete().in("predecessor_id", oldIds);
        const { error: dErr } = await supa.from("tasks").delete().eq("project_id", lookaheadProjectId);
        if (dErr) throw dErr;
      }

      // Build lookahead tasks
      const pullToTask = new Map<string, string>(); // pull item id -> new task id
      const newTasks: Record<string, unknown>[] = [];
      let idx = 0;
      const sortedT = [...expTickets].sort((a, b) => a.start_date!.localeCompare(b.start_date!));
      for (const t of sortedT) {
        const id = crypto.randomUUID();
        pullToTask.set(t.id, id);
        newTasks.push({
          id, project_id: lookaheadProjectId, title: t.description,
          start_date: t.start_date, end_date: ticketEnd(t),
          champion_id: t.responsible_id, status: t.status === "in_progress" ? "in_progress" : "not_started",
          parent_id: null, sort_order: idx++,
          work_sat: t.work_sat, work_sun: t.work_sun,
          is_milestone: false, is_constraint: false,
          crew_size: t.crew_size, role_id: t.role_id,
        });
      }
      for (const m of expMilestones) {
        const id = crypto.randomUUID();
        pullToTask.set(m.id, id);
        newTasks.push({
          id, project_id: lookaheadProjectId, title: m.label,
          start_date: m.date, end_date: m.date,
          champion_id: null, status: "not_started",
          parent_id: null, sort_order: idx++,
          work_sat: false, work_sun: false,
          is_milestone: true, is_constraint: false,
          crew_size: null, role_id: null,
        });
      }
      for (const c of expConstraints) {
        const id = crypto.randomUUID();
        pullToTask.set(c.id, id);
        newTasks.push({
          id, project_id: lookaheadProjectId, title: c.description,
          start_date: c.date, end_date: c.date,
          champion_id: c.responsible_id, status: "not_started",
          parent_id: null, sort_order: idx++,
          work_sat: false, work_sun: false,
          is_milestone: false, is_constraint: true,
          crew_size: null, role_id: null,
        });
      }
      const { error: iErr } = await supa.from("tasks").insert(newTasks);
      if (iErr) throw iErr;

      // Connections
      const newTaskDeps: { task_id: string; predecessor_id: string; lag_days: number }[] = [];
      for (const d of deps) {
        const a = pullToTask.get(d.predecessor_id), b = pullToTask.get(d.ticket_id);
        if (a && b) newTaskDeps.push({ task_id: b, predecessor_id: a, lag_days: 0 });
      }
      for (const l of msLinks) {
        const tk = pullToTask.get(l.ticket_id), ms = pullToTask.get(l.milestone_id);
        if (!tk || !ms) continue;
        newTaskDeps.push(l.ticket_is_pred
          ? { task_id: ms, predecessor_id: tk, lag_days: 0 }
          : { task_id: tk, predecessor_id: ms, lag_days: 0 });
      }
      for (const l of cLinks) {
        const tk = pullToTask.get(l.ticket_id), cn = pullToTask.get(l.constraint_id);
        if (tk && cn) newTaskDeps.push({ task_id: tk, predecessor_id: cn, lag_days: 0 });
      }
      if (newTaskDeps.length) {
        const { error: dpErr } = await supa.from("task_dependencies").insert(newTaskDeps);
        if (dpErr) throw dpErr;
      }
      alert(`Exported ${total} items to the Lookahead.`);
    } catch (e) {
      setError(`Export failed: ${(e as { message?: string }).message ?? String(e)}`);
    }
    setExportBusy(false);
  }

  // ── Promise Now: bulk-promise all planned tickets in the next period ───────
  const promiseNowEnd = addDays(activeDate, 7);
  const promiseNowTargets = tickets.filter(
    t => t.status === "planned" && t.start_date && t.start_date <= promiseNowEnd
  );

  async function promiseNow() {
    if (promiseNowTargets.length === 0) return;
    if (!confirm(`Promise ${promiseNowTargets.length} ticket${promiseNowTargets.length > 1 ? "s" : ""} scheduled through ${promiseNowEnd}? Promised work is pinned and scored in PPC.`)) return;
    for (const t of promiseNowTargets) {
      await patchTicket(t.id, { status: "promised", promised_end: ticketEnd(t) });
    }
  }

  // ── Promise / complete ──────────────────────────────────────────────────────
  async function promiseTicket(t: PullTicket) {
    const end = ticketEnd(t);
    if (!end) return;
    await patchTicket(t.id, { status: "promised", promised_end: end });
  }
  async function unpromiseTicket(t: PullTicket) {
    await patchTicket(t.id, { status: "planned", promised_end: null });
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

      if (m.kind === "constraint") {
        const c = constraints.find(x => x.id === m.id);
        if (!c) return;
        if (!moved) { handleConstraintClick(c); return; }
        if (trayRef.current) {
          const tr = trayRef.current.getBoundingClientRect();
          if (ev.clientX >= tr.left && ev.clientX <= tr.right && ev.clientY >= tr.top && ev.clientY <= tr.bottom) {
            await patchConstraint(c.id, { date: null, lane_id: null, row_index: 0 });
            return;
          }
        }
        if (!boardRef.current) return;
        const p = boardXY(ev);
        const laneY = p.y - HEADER_H;
        const ll = laneLayouts.find(l => laneY >= l.top && laneY < l.top + l.height);
        const date = dateForX(Math.max(0, p.x - dayW / 2));
        if (!ll) { await patchConstraint(c.id, { date, lane_id: null }); return; }
        const row = Math.min(ll.rows - 1, Math.max(0, Math.floor((laneY - ll.top - LANE_PAD) / (ticketH + LANE_PAD))));
        await patchConstraint(c.id, { date, lane_id: ll.lane.id, row_index: row });
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
      if (connectFrom.kind === "constraint") addCLink(connectFrom.id, t.id);        // constraint blocks ticket
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

  function handleConstraintClick(c: PullConstraint) {
    if (connectMode) {
      if (!connectFrom) { setConnectFrom({ kind: "constraint", id: c.id }); return; }
      if (connectFrom.kind === "ticket") addCLink(c.id, connectFrom.id); // constraint blocks that ticket
      setConnectFrom(null);
      return;
    }
    setEditingConstraint(c.id);
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
    for (const l of cLinks) {
      const t = ticketMap.get(l.ticket_id);
      const c = constraints.find(x => x.id === l.constraint_id);
      if (!t?.start_date || !c || c.resolved) continue;
      // blocked ticket starts before the constraint's planned resolution
      if (c.date && t.start_date <= c.date) bad.add(t.id);
    }
    return bad;
  }, [deps, msLinks, cLinks, ticketMap, milestones, constraints]);

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
        <button onClick={() => setShowCForm(v => !v)}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">+ Constraint</button>
        <button onClick={() => { setConnectMode(v => !v); setConnectFrom(null); }}
          className={`rounded border px-3 py-1.5 text-sm ${connectMode ? "border-[#1A3560] bg-[#1A3560] text-white" : "border-zinc-300 text-zinc-700 hover:bg-zinc-50"}`}
          title="Connect mode: click a predecessor ticket, then its successor">
          🔗 Connect
        </button>
        <button onClick={promiseNow} disabled={promiseNowTargets.length === 0}
          className="rounded bg-[#2A6B35] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#235a2c] disabled:opacity-40"
          title={`Promise all planned tickets scheduled through ${promiseNowEnd}`}>
          📌 Promise Now{promiseNowTargets.length > 0 ? ` (${promiseNowTargets.length})` : ""}
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
        <span className="ml-auto flex items-center gap-2">
          <button onClick={importMaster} disabled={importBusy || masterTasks.length === 0}
            className="rounded border border-[#1A3560] px-3 py-1.5 text-sm font-medium text-[#1A3560] hover:bg-blue-50 disabled:opacity-40"
            title={`Import master schedule tasks from ${activeDate} onward into the “Undefined” swimlane`}>
            {importBusy ? "Importing…" : "⬇ Import Master"}
          </button>
          {isAdmin && (
            <button onClick={exportToLookahead} disabled={exportBusy || !lookaheadProjectId}
              className="rounded border border-[#2A6B35] px-3 py-1.5 text-sm font-medium text-[#2A6B35] hover:bg-green-50 disabled:opacity-40"
              title="Replace the 6-Week Lookahead with everything on or before the active line">
              {exportBusy ? "Exporting…" : "⬆ Export to Lookahead"}
            </button>
          )}
        </span>
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
      {showCForm && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <input value={cDesc} onChange={e => setCDesc(e.target.value)} placeholder="Constraint (e.g. RFI #12, submittal, material)" autoFocus
            onKeyDown={e => e.key === "Enter" && addConstraint()}
            className="w-72 rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6]" />
          <label className="flex items-center gap-1 text-xs text-zinc-500">
            need by
            <input type="date" value={cNeedBy} onChange={e => setCNeedBy(e.target.value)}
              className="rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6]" />
          </label>
          <select value={cPriority} onChange={e => setCPriority(e.target.value as PullConstraint["priority"])}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6]">
            <option value="on_track">On Track</option>
            <option value="needs_attention">Needs Attention</option>
            <option value="critical">Critical</option>
          </select>
          <button onClick={addConstraint} className="rounded bg-[#1A3560] px-3 py-1.5 text-sm text-white">Add</button>
          <span className="text-[10px] text-zinc-400">added to the tray — drag it onto the board</span>
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
              responsible={t.responsible_id ? memberMap.get(t.responsible_id) : undefined}
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
        {/* Tray constraints (circles) */}
        {constraints.filter(c => !c.date).map(c => (
          <div key={c.id}
            className="relative flex h-[64px] w-[64px] cursor-grab items-center justify-center"
            style={{ touchAction: "none" }}
            onPointerDown={e => startDrag(e, { kind: "constraint", id: c.id })}
            title={`Constraint: ${c.description}${c.need_by ? ` — need by ${c.need_by}` : ""} (drag onto the board, click to edit)`}>
            <div className="absolute inset-1 rounded-full border-2 bg-zinc-300 shadow"
              style={{ borderColor: PRIORITY_RING[c.priority] }} />
            <span className="relative px-1.5 text-center text-[8px] font-bold leading-tight text-zinc-800">
              ⚠ {c.description.length > 24 ? c.description.slice(0, 24) + "…" : c.description}
            </span>
          </div>
        ))}
      </div>

      {/* ── Sidebar + Board ── */}
      <div className="flex overflow-hidden rounded-lg border border-zinc-300 bg-white" style={{ height: "68vh" }}>
        <IconRail open={panel} onToggle={p => setPanel(cur => (cur === p ? null : p))} />

        {panel === "constraints" && (
          <PanelShell title="Constraints" onClose={() => setPanel(null)}>
            <ConstraintsPanel tickets={tickets} constraints={constraints}
              onOpen={id => setEditing(id)} onOpenConstraint={id => setEditingConstraint(id)} />
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
        {panel === "snapshots" && (
          <PanelShell title="Snapshots" onClose={() => setPanel(null)}>
            <SnapshotsPanel snapshots={snapshots} members={members} isAdmin={isAdmin}
              currentUserId={currentUserId} busy={snapBusy}
              onTake={takeSnapshot} onRestore={restoreSnapshot} onDelete={deleteSnapshot} />
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
              {/* Inactive panel: no date grid — just a label */}
              <div className="flex shrink-0 items-center justify-center" style={{ width: INACTIVE_W, backgroundColor: "#4a4f55" }}>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-white/80">Inactive / Unscheduled</span>
              </div>
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
                <div className="absolute inset-y-0" style={{ left: activeW + LINE_W, width: INACTIVE_W, backgroundColor: "#f4f4f5" }} />
                {/* Weekend shading + day gridlines (active zone) */}
                {activeDayList.map((d, i) => {
                  const dow = parseISODate(d).getDay();
                  return (
                    <div key={d} className="absolute inset-y-0 border-r border-black/5"
                      style={{ left: i * dayW, width: dayW, backgroundColor: dow === 0 || dow === 6 ? "rgba(0,0,0,.06)" : undefined }} />
                  );
                })}

                {/* Inactive panel: plain square cards, no date positioning, no arrows */}
                <div
                  className="absolute inset-y-0 flex flex-wrap content-start gap-1 overflow-y-auto p-1"
                  style={{ left: activeW + LINE_W, width: INACTIVE_W }}>
                  {ll.inactiveTickets.map(t => (
                    <div key={t.id}
                      onPointerDown={e => {
                        if (canEdit(t) && !t.status.startsWith("done_")) {
                          startDrag(e, { kind: "ticket", id: t.id, grabX: ticketH / 2, grabY: ticketH / 2 });
                        } else handleTicketClick(t);
                      }}
                      className={canEdit(t) ? "cursor-grab" : "cursor-pointer"}
                      style={{ touchAction: "none" }}>
                      <TicketCard t={t} role={t.role_id ? roleMap.get(t.role_id) : undefined}
                        location={t.location_id ? locMap.get(t.location_id) : undefined}
                        responsible={t.responsible_id ? memberMap.get(t.responsible_id) : undefined}
                        width={ticketH} height={ticketH} hid={isHid(t)}
                        connectFrom={connectFrom?.kind === "ticket" && connectFrom.id === t.id} compact />
                    </div>
                  ))}
                  {ll.inactiveMilestones.map(m => (
                    <div key={m.id}
                      className="relative flex cursor-grab items-center justify-center"
                      style={{ width: ticketH, height: ticketH, touchAction: "none" }}
                      onPointerDown={e => startDrag(e, { kind: "milestone", id: m.id })}
                      title={`Milestone: ${m.label} (inactive — drag onto the active zone)`}>
                      <div className="absolute inset-1.5 rotate-45 rounded-[3px] border border-zinc-400 bg-zinc-200 shadow" />
                      <span className="relative px-1 text-center text-[8px] font-bold leading-tight text-zinc-800">{m.label}</span>
                    </div>
                  ))}
                  {ll.inactiveConstraints.map(c => (
                    <div key={c.id}
                      className="relative flex cursor-grab items-center justify-center"
                      style={{ width: ticketH, height: ticketH, touchAction: "none" }}
                      onPointerDown={e => startDrag(e, { kind: "constraint", id: c.id })}
                      title={`Constraint: ${c.description} (inactive — drag onto the active zone)`}>
                      <div className="absolute inset-1 rounded-full border-2 bg-zinc-300 shadow"
                        style={{ borderColor: PRIORITY_RING[c.priority] }} />
                      <span className="relative px-1.5 text-center text-[8px] font-bold leading-tight text-zinc-800">
                        ⚠ {c.description}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Lane name pill — sticky and above tickets so it stays visible while scrolling */}
                <div className="sticky left-1 top-1 z-30 w-fit pt-1 pl-1">
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
              if (!pos) return null;
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
                    responsible={t.responsible_id ? memberMap.get(t.responsible_id) : undefined}
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
                  <marker id="pp-arr-amber" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                    <path d="M0,0 L7,3.5 L0,7 z" fill="#f59e0b" />
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
                {cLinks.map(l => {
                  const c = constraints.find(x => x.id === l.constraint_id);
                  const tp = ticketPos.get(l.ticket_id);
                  const t = ticketMap.get(l.ticket_id);
                  const cp = c ? cPos.get(c.id) : undefined;
                  if (!c || !c.date || !cp || !tp || !t) return null;
                  const bad = !c.resolved && !!t.start_date && !!c.date && t.start_date <= c.date;
                  const x1 = cp.cx + msSize / 2 + 2, y1 = cp.cy;
                  const x2 = tp.x, y2 = tp.y + ticketH / 2;
                  const bez = Math.max(16, Math.min(50, (x2 - x1) / 2));
                  const d = `M ${x1} ${y1} C ${x1 + bez} ${y1}, ${x2 - bez} ${y2}, ${x2 - 2} ${y2}`;
                  return (
                    <g key={l.id}>
                      <path d={d} fill="none" stroke="transparent" strokeWidth="10" style={{ pointerEvents: "stroke", cursor: "pointer" }}
                        onClick={() => { if (confirm("Remove this constraint connection?")) removeCLink(l.id); }} />
                      <path d={d} fill="none" stroke={bad ? "#dc2626" : "#f59e0b"} strokeWidth={bad ? 2.2 : 1.8}
                        strokeDasharray="5 3" markerEnd={bad ? "url(#pp-arr-red)" : "url(#pp-arr-amber)"} opacity={c.resolved ? 0.35 : 0.85} />
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
              if (!pos) return null;
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

            {/* ── Constraints (circles) ── */}
            {constraints.map(c => {
              if (!c.date) return null;
              const pos = cPos.get(c.id);
              if (!pos) return null;
              const size = msSize;
              const isFrom = connectFrom?.kind === "constraint" && connectFrom.id === c.id;
              const dragging = drag?.kind === "constraint" && drag.id === c.id && ghost;
              const left = dragging ? ghost!.x - size / 2 : pos.cx - size / 2;
              const top = dragging ? ghost!.y - size / 2 : HEADER_H + pos.cy - size / 2;
              const overdue = !c.resolved && c.need_by && c.need_by < today;
              return (
                <div key={c.id}
                  className={`absolute flex items-center justify-center ${dragging ? "z-40 opacity-80" : "z-20"} ${connectMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}`}
                  style={{ left, top, width: size, height: size, touchAction: "none", opacity: c.resolved ? 0.55 : undefined }}
                  onPointerDown={e => startDrag(e, { kind: "constraint", id: c.id })}
                  title={`Constraint: ${c.description}${c.need_by ? ` — need by ${c.need_by}` : ""}${c.resolved ? " (resolved)" : ""}${connectMode ? " (click to connect)" : ""}`}>
                  <div className="absolute inset-0 rounded-full border-2 bg-zinc-300 shadow-md"
                    style={{
                      borderColor: overdue ? "#dc2626" : PRIORITY_RING[c.priority],
                      outline: isFrom ? "3px solid #1A3560" : overdue ? "2px solid #dc2626" : undefined,
                    }} />
                  <span className="relative px-1.5 text-center font-bold leading-tight text-zinc-800"
                    style={{ fontSize: Math.max(7, Math.round(8 * zoom)) }}>
                    {c.resolved ? "✓ " : "⚠ "}{c.description}
                  </span>
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

      {/* ── Constraint edit modal ── */}
      {editingConstraint && (() => {
        const c = constraints.find(x => x.id === editingConstraint);
        if (!c) return null;
        return (
          <ConstraintModal
            key={c.id}
            constraint={c}
            lanes={lanes}
            members={members}
            onPatch={patch => patchConstraint(c.id, patch)}
            onDelete={() => deleteConstraint(c.id)}
            onClose={() => setEditingConstraint(null)}
          />
        );
      })()}

      {/* ── Edit modal ── */}
      {editingTicket && (
        <TicketModal
          key={editingTicket.id}
          ticket={editingTicket}
          lanes={lanes}
          roles={roles}
          locations={locations}
          members={members}
          connections={[
            ...deps.filter(d => d.ticket_id === editingTicket.id).map(d => ({
              key: `pred:${d.predecessor_id}`,
              label: ticketMap.get(d.predecessor_id)?.description ?? "?",
              kind: "predecessor" as const,
            })),
            ...deps.filter(d => d.predecessor_id === editingTicket.id).map(d => ({
              key: `succ:${d.ticket_id}`,
              label: ticketMap.get(d.ticket_id)?.description ?? "?",
              kind: "successor" as const,
            })),
            ...msLinks.filter(l => l.ticket_id === editingTicket.id).map(l => ({
              key: `ms:${l.id}`,
              label: milestones.find(m => m.id === l.milestone_id)?.label ?? "?",
              kind: "milestone" as const,
            })),
            ...cLinks.filter(l => l.ticket_id === editingTicket.id).map(l => ({
              key: `c:${l.id}`,
              label: constraints.find(c => c.id === l.constraint_id)?.description ?? "?",
              kind: "constraint" as const,
            })),
          ]}
          supportIds={support.filter(s => s.ticket_id === editingTicket.id).map(s => s.user_id)}
          onSetSupport={ids => setTicketSupport(editingTicket.id, ids)}
          editable={canEdit(editingTicket)}
          onPatch={patch => patchTicket(editingTicket.id, patch)}
          onRemoveConnection={key => {
            const [type, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
            if (type === "pred") removeDep(editingTicket.id, id);
            else if (type === "succ") removeDep(id, editingTicket.id);
            else if (type === "ms") removeMsLink(id);
            else if (type === "c") removeCLink(id);
          }}
          onPromise={() => promiseTicket(editingTicket)}
          onUnpromise={() => unpromiseTicket(editingTicket)}
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

// ─── Constraint edit modal ─────────────────────────────────────────────────────
function ConstraintModal({
  constraint, lanes, members, onPatch, onDelete, onClose,
}: {
  constraint: PullConstraint;
  lanes: PullLane[];
  members: Profile[];
  onPatch: (patch: Partial<PullConstraint>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [desc, setDesc] = useState(constraint.description);
  const [needBy, setNeedBy] = useState(constraint.need_by ?? "");
  const [priority, setPriority] = useState(constraint.priority);
  const [respId, setRespId] = useState(constraint.responsible_id ?? "");
  const [date, setDate] = useState(constraint.date ?? "");
  const [laneId, setLaneId] = useState(constraint.lane_id ?? "");
  const [note, setNote] = useState(constraint.note);

  const inputCls = "rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6]";

  function save() {
    onPatch({
      description: desc.trim() || "Untitled constraint",
      need_by: needBy || null,
      priority,
      responsible_id: respId || null,
      date: date || null,
      lane_id: date ? (laneId || null) : null,
      note,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#1A3560]">⚠ Constraint</h2>
          <span className={`text-[11px] font-semibold ${constraint.resolved ? "text-green-600" : "text-amber-600"}`}>
            {constraint.resolved ? "Resolved" : "Open"}
          </span>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">Description</span>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} className={inputCls} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Need resolved by</span>
              <input type="date" value={needBy} onChange={e => setNeedBy(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Priority</span>
              <select value={priority} onChange={e => setPriority(e.target.value as PullConstraint["priority"])} className={inputCls}>
                <option value="on_track">On Track</option>
                <option value="needs_attention">Needs Attention</option>
                <option value="critical">Critical</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Planned resolution date</span>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Swimlane</span>
              <select value={laneId} onChange={e => setLaneId(e.target.value)} className={inputCls}>
                <option value="">— tray / top —</option>
                {lanes.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">Responsible</span>
            <select value={respId} onChange={e => setRespId(e.target.value)} className={inputCls}>
              <option value="">— unassigned —</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">Notes / status updates</span>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className={inputCls} />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!constraint.resolved ? (
            <button onClick={() => { onPatch({ resolved: true }); onClose(); }}
              className="rounded bg-[#2A6B35] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#235a2c]">
              ✓ Mark Resolved
            </button>
          ) : (
            <button onClick={() => { onPatch({ resolved: false }); onClose(); }}
              className="rounded border border-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50">
              Reopen
            </button>
          )}
          <span className="flex-1" />
          <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-600">Delete</button>
          <button onClick={onClose} className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50">Cancel</button>
          <button onClick={save} className="rounded bg-[#1A3560] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#152b4e]">Save</button>
        </div>
      </div>
    </div>
  );
}
