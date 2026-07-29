"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { addDays, diffInDays, parseISODate, todayISO, countWorkingDays, addWorkingDays, nextWorkingDay, mondayOf, isoWeek, formatShortDate } from "@/lib/date";
import type { Profile, Task, TaskDependency, TaskSupport, StatHoliday, PullRole } from "@/lib/supabase/types";

// ─── Layout ───────────────────────────────────────────────────────────────────
const BASE_DAY_W = 28;
const ZOOM_MIN = 0.07; // ~2px/day — enough to fit a full year on screen
const ZOOM_MAX = 3;
const ROW_H = 36;
const BAND_H = 26;   // lookahead week-band row

// Dependency link as a smooth S-curve.
//
// Both ends are horizontal — the tangent leaving the predecessor and the one
// arriving at the successor are flat — so the arrowhead still points squarely
// into the bar and the direction of the relationship stays obvious. The curve
// replaces only the right-angle corners the stepped version used.
//
// One cubic handles every case. Where the successor starts left of the
// predecessor's finish, the two control points cross and the curve simply
// bulges out and back — the usual flowchart back-edge — instead of needing a
// separate routed branch with its own corner.
//
// Reach grows with both the horizontal and vertical gap so short hops stay
// tight and long drops across several rows open out, and is clamped so neither
// extreme degenerates.
function curvedLink(x1: number, y1: number, x2: number, y2: number, sameRow: boolean): string {
  if (sameRow || Math.abs(y2 - y1) < 1) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const reach = Math.max(16, Math.min(60, Math.abs(x2 - x1) * 0.5 + Math.abs(y2 - y1) * 0.25));
  return `M ${x1} ${y1} C ${(x1 + reach).toFixed(1)} ${y1}, ${(x2 - reach).toFixed(1)} ${y2}, ${x2} ${y2}`;
}
const HEADER_H = 54; // month row (24px) + day row (28px) + 2px border
const MIN_NAME_W = 160;
const MAX_NAME_W = 460;

// Depth-based row background (opaque — left panel must be solid to mask Gantt bars on scroll).
// Each color is rgba(26,53,96,α) pre-blended onto white.
const LEVEL_BG = ["#eaedf1", "#f2f3f6", "#f9fafb", "#ffffff"];
const MILESTONE_BG = "#fef3e1"; // rgba(245,158,11,0.12) on white
const CONSTRAINT_BG = "#fde8e8"; // light red tint for constraint rows

// ─── Champion colours (stable index per member) ───────────────────────────────
const CHAMP_PALETTE = [
  "#2E6EA6", "#2A6B35", "#D97706", "#B91C1C", "#6B21A8",
  "#0891B2", "#0D9488", "#BE185D", "#4338CA", "#D65D0E",
  "#166534", "#9D174D", "#1E40AF", "#92400E",
];

// ─── Types ────────────────────────────────────────────────────────────────────
type DragMode = "move" | "resize-start" | "resize-end";
interface DragState { taskId: string; mode: DragMode; startX: number; origStart: string; origEnd: string; }
interface EditCell { taskId: string; field: "title" | "pred" | "lag" | "dur" | "start" | "end" | "sub" | "crew"; value: string; }

// ─── Pure helpers ─────────────────────────────────────────────────────────────
function buildChildren(tasks: Task[]) {
  const m = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const k = t.parent_id ?? null;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(t);
  }
  for (const g of m.values()) g.sort((a, b) => a.sort_order - b.sort_order);
  return m;
}

function computeWBS(cm: Map<string | null, Task[]>) {
  const out = new Map<string, string>();
  function walk(pid: string | null, prefix: string) {
    (cm.get(pid) ?? []).forEach((t, i) => {
      const label = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      out.set(t.id, label);
      walk(t.id, label);
    });
  }
  walk(null, "");
  return out;
}

function flatVisible(cm: Map<string | null, Task[]>, expanded: Set<string>) {
  const out: Task[] = [];
  function walk(pid: string | null) {
    for (const t of cm.get(pid) ?? []) {
      out.push(t);
      if (expanded.has(t.id)) walk(t.id);
    }
  }
  walk(null);
  return out;
}

function depth(task: Task, tm: Map<string, Task>) {
  let n = 0, c = task;
  while (c.parent_id) { const p = tm.get(c.parent_id); if (!p) break; n++; c = p; }
  return n;
}

function initials(p: Profile) {
  const name = p.full_name?.trim() || p.email;
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}

// Bubble parent dates up from children (post-order DFS)
function recomputeSummaryDates(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map(t => [t.id, { ...t }]));
  const cm = buildChildren(tasks);
  function walk(pid: string | null) {
    for (const child of cm.get(pid) ?? []) walk(child.id);
    if (pid === null) return;
    const kids = cm.get(pid) ?? [];
    if (!kids.length) return;
    const t = byId.get(pid)!;
    const starts = kids.map(k => byId.get(k.id)!.start_date).sort();
    const ends   = kids.map(k => byId.get(k.id)!.end_date).sort();
    byId.set(pid, { ...t, start_date: starts[0], end_date: ends[ends.length - 1] });
  }
  walk(null);
  return Array.from(byId.values());
}

function buildChampionColorMap(members: Profile[]): Map<string, string> {
  const m = new Map<string, string>();
  members.forEach((p, i) => m.set(p.id, CHAMP_PALETTE[i % CHAMP_PALETTE.length]));
  return m;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function MsProjectGantt({
  projectId, initialTasks, initialDeps, initialSupport, members, roles = [], readOnly = false,
  hideStatHolidays = false, printTitle = "Master Schedule",
  fixedStart, fixedEnd,
  hideCrewCol = false, hideDtcCol = false, hideChampionCol = false, hideSupportCol = false,
  championBadge = false, hideLegendOnPrint = false, lookaheadStyle = false,
}: {
  projectId: string;
  initialTasks: Task[];
  initialDeps: TaskDependency[];
  initialSupport: TaskSupport[];
  members: Profile[];
  roles?: PullRole[];   // pull plan roles/trades for the Role/Trade column
  readOnly?: boolean;
  hideStatHolidays?: boolean;
  printTitle?: string;
  fixedStart?: string;  // lock timeline to this start date (ISO)
  fixedEnd?: string;    // lock timeline to this end date (ISO)
  hideCrewCol?: boolean;
  hideDtcCol?: boolean;
  hideChampionCol?: boolean;
  hideSupportCol?: boolean;
  championBadge?: boolean; // show champion initials as a circle badge on the bar instead of a column
  hideLegendOnPrint?: boolean;
  // Lookahead presentation: a readiness dot, one merged "Who" column, week bands,
  // and no WBS/Pred/Lag/Sat/Sun — six-week planning data, not the master programme.
  // Dependency arrows stay: they're what makes dropping Pred/Lag defensible.
  lookaheadStyle?: boolean;
}) {
  const router = useRouter();
  const supa   = useMemo(() => createClient(), []);

  const [tasks,       setTasks]       = useState<Task[]>(initialTasks);
  const tasksRef = useRef<Task[]>(initialTasks); // always-current tasks for onUp closure
  const [deps,        setDeps]        = useState<TaskDependency[]>(initialDeps);
  const [support,     setSupport]     = useState<TaskSupport[]>(initialSupport);
  const [expanded,    setExpanded]    = useState<Set<string>>(() => new Set(initialTasks.map(t => t.id)));
  const [drag,        setDrag]        = useState<DragState | null>(null);
  const [edit,        setEdit]        = useState<EditCell | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [saving,      setSaving]      = useState(false);
  const [holidays,    setHolidays]    = useState<StatHoliday[]>([]);
  const [newHolDate,  setNewHolDate]  = useState("");
  const [newHolLabel, setNewHolLabel] = useState("");
  const [rowDragId,   setRowDragId]   = useState<string | null>(null);
  const [rowOverId,   setRowOverId]   = useState<string | null>(null);
  const [zoom,        setZoom]        = useState(1);

  // Task Name column auto-sizes to fit the longest title on the board.
  const nameColW = useMemo(() => {
    let maxLen = 12;
    for (const t of tasks) if (t.title.length > maxLen) maxLen = t.title.length;
    return Math.max(MIN_NAME_W, Math.min(MAX_NAME_W, maxLen * 6.5 + 40));
  }, [tasks]);

  const COL = useMemo(() => ({
    toggle: 26,
    ready: lookaheadStyle ? 34 : 0,
    wbs: lookaheadStyle ? 0 : 72,
    name: nameColW, dur: 52,
    start: 80, end: 80,
    pred: lookaheadStyle ? 0 : 60,
    lag: lookaheadStyle ? 0 : 44,
    // In lookahead style champion + support collapse into one avatar column.
    champ: lookaheadStyle || hideChampionCol ? 0 : 110,
    supp: lookaheadStyle || hideSupportCol ? 0 : 120,
    who: lookaheadStyle ? 104 : 0,
    // Weekend working is shown on the bar itself instead of two tick columns.
    sat: lookaheadStyle ? 0 : 34,
    sun: lookaheadStyle ? 0 : 34,
    sub: 100,
    crew: hideCrewCol ? 0 : 50,
    dtc: hideDtcCol ? 0 : 46,
    act: 48,
  }), [nameColW, hideChampionCol, hideSupportCol, hideCrewCol, hideDtcCol, lookaheadStyle]);

  const LEFT_W = useMemo(() => Object.values(COL).reduce((a, b) => a + b, 0), [COL]);

  // Readiness — the question a six-week window exists to answer.
  //
  // Deliberately scoped to what the data can actually support. We do NOT know
  // whether materials landed or a permit came back, so nothing here claims that.
  // "Ready" means only: it's owned, dated, and not already late. The legend says
  // so in as many words, because a green dot that overpromises is worse than no
  // dot at all.
  type Ready = "done" | "progress" | "blocked" | "late" | "unowned" | "ready" | "na";

  const READY_META: Record<Ready, { color: string; label: string }> = {
    done:     { color: "#16a34a", label: "Complete" },
    progress: { color: "#2563eb", label: "In progress" },
    blocked:  { color: "#dc2626", label: "Open constraint" },
    late:     { color: "#dc2626", label: "Past its finish date" },
    unowned:  { color: "#d97706", label: "Nobody assigned" },
    ready:    { color: "#16a34a", label: "Owned, dated, not late" },
    na:       { color: "#cbd5e1", label: "Milestone / summary" },
  };

  const readinessOf = useCallback((t: Task, hasKids: boolean): Ready => {
    if (t.is_constraint) return "blocked";
    if (t.is_milestone || hasKids) return "na";
    if (t.status === "done") return "done";
    if (t.end_date < todayISO()) return "late";
    if (t.status === "in_progress") return "progress";
    if (!t.champion_id && !t.assignee_id) return "unowned";
    return "ready";
  }, []);

  const [leftW,       setLeftW]       = useState(LEFT_W);
  const resizingRef = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(LEFT_W);
  const MIN_LEFT_W = 180;

  // In fixed-range mode, auto-fit day width so the full period exactly fills the
  // grid container — measured with a ResizeObserver (window.innerWidth over-counts
  // page padding and isn't reactive), so the chart never scrolls horizontally.
  const fixedDays = fixedStart && fixedEnd ? diffInDays(fixedStart, fixedEnd) + 1 : null;
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  const [containerW, setContainerW] = useState(0);
  useEffect(() => {
    const el = scrollBoxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth));
    ro.observe(el);
    setContainerW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const DAY_W = fixedDays
    ? Math.max(2, Math.floor(((containerW || 900) - leftW - 2) / fixedDays))
    : Math.max(2, Math.round(BASE_DAY_W * zoom));

  useEffect(() => { supa.auth.getSession(); }, [supa]);

  // Fetch stat holidays on mount (graceful if table not yet created)
  useEffect(() => {
    supa.from("stat_holidays").select("id, date, label").order("date")
      .then(({ data, error }) => { if (!error && data) setHolidays(data as StatHoliday[]); });
  }, [supa]);

  // Keep ref in sync so onUp always sees the latest tasks
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  // Sync from server after mutations (router.refresh). Skip while a drag or an
  // inline cell edit is in progress so an unrelated refresh doesn't clobber it.
  useEffect(() => {
    if (!drag && !edit) {
      setTasks(initialTasks);
      setDeps(initialDeps);
      setSupport(initialSupport);
      tasksRef.current = initialTasks;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTasks, initialDeps, initialSupport]);

  // ── Derived ───────────────────────────────────────────────────────────────────
  const taskMap      = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const cm           = useMemo(() => buildChildren(tasks), [tasks]);
  const wbsMap       = useMemo(() => computeWBS(cm), [cm]);
  const wbsToTask    = useMemo(() => { const m = new Map<string, Task>(); wbsMap.forEach((w, id) => { const t = taskMap.get(id); if (t) m.set(w, t); }); return m; }, [wbsMap, taskMap]);
  const flat         = useMemo(() => flatVisible(cm, expanded), [cm, expanded]);

  // Lookahead rows read in date order so the week bands mean something — the
  // exported lookahead is a flat list, so no hierarchy is being flattened here.
  const rowsFlat = useMemo(() => {
    if (!lookaheadStyle) return flat;
    return [...flat].sort((a, b) =>
      a.start_date.localeCompare(b.start_date) ||
      a.end_date.localeCompare(b.end_date) ||
      a.title.localeCompare(b.title));
  }, [flat, lookaheadStyle]);

  // Which task each week band should be drawn above, plus that week's tallies.
  const bandBefore = useMemo(() => {
    const m = new Map<string, { week: number; monday: string; total: number; constraints: number }>();
    if (!lookaheadStyle) return m;

    const tally = new Map<string, { total: number; constraints: number }>();
    for (const t of rowsFlat) {
      const monday = mondayOf(t.start_date);
      const e = tally.get(monday) ?? { total: 0, constraints: 0 };
      e.total++;
      if (t.is_constraint) e.constraints++;
      tally.set(monday, e);
    }

    let last = "";
    for (const t of rowsFlat) {
      const monday = mondayOf(t.start_date);
      if (monday !== last) {
        last = monday;
        m.set(t.id, { week: isoWeek(monday), monday, ...tally.get(monday)! });
      }
    }
    return m;
  }, [rowsFlat, lookaheadStyle]);

  // Pixel top of every rendered row. Dependency arrows are absolutely positioned
  // over the chart, so once week bands push rows down they can no longer assume
  // `index * ROW_H` — that would land every arrow a band-height too high.
  const rowGeom = useMemo(() => {
    const tops = new Map<string, number>();
    let y = 0;
    for (const t of rowsFlat) {
      if (bandBefore.has(t.id)) y += BAND_H;
      tops.set(t.id, y);
      y += ROW_H;
    }
    return { tops, height: y };
  }, [rowsFlat, bandBefore]);
  const memberMap    = useMemo(() => new Map(members.map(p => [p.id, p])), [members]);
  const champColorMap = useMemo(() => buildChampionColorMap(members), [members]);
  const holidaySet   = useMemo(() => new Set(holidays.map(h => h.date)), [holidays]);

  const successorsOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const d of deps) { if (!m.has(d.predecessor_id)) m.set(d.predecessor_id, []); m.get(d.predecessor_id)!.push(d.task_id); }
    return m;
  }, [deps]);

  const predsOf = useMemo(() => {
    const m = new Map<string, TaskDependency[]>();
    for (const d of deps) { if (!m.has(d.task_id)) m.set(d.task_id, []); m.get(d.task_id)!.push(d); }
    return m;
  }, [deps]);

  const supportOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of support) { if (!m.has(s.task_id)) m.set(s.task_id, []); m.get(s.task_id)!.push(s.user_id); }
    return m;
  }, [support]);

  // ── Timeline ──────────────────────────────────────────────────────────────────
  const { rangeStart, totalDays } = useMemo(() => {
    // Fixed range locks the chart to exactly the given window (e.g. 6-week lookahead)
    if (fixedStart && fixedEnd) {
      return { rangeStart: fixedStart, totalDays: diffInDays(fixedStart, fixedEnd) + 1 };
    }
    const today = todayISO();
    if (!tasks.length) return { rangeStart: addDays(today, -14), totalDays: 90 };
    let min = tasks[0].start_date, max = tasks[0].end_date;
    for (const t of tasks) { if (t.start_date < min) min = t.start_date; if (t.end_date > max) max = t.end_date; }
    return { rangeStart: addDays(min, -14), totalDays: Math.max(diffInDays(addDays(min, -14), addDays(max, 21)) + 1, 90) };
  }, [tasks, fixedStart, fixedEnd]);

  const days = useMemo(() => {
    const today = todayISO(), out = [];
    for (let i = 0; i < totalDays; i++) {
      const date = addDays(rangeStart, i), d = parseISODate(date);
      out.push({
        date, label: String(d.getDate()),
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
        isToday: date === today,
        isMonthStart: d.getDate() === 1,
      });
    }
    return out;
  }, [rangeStart, totalDays]);

  // Show week labels instead of individual day numbers once columns get too narrow to read,
  // and drop to month-only labels (no second row) once weeks would be unreadable too.
  const showWeeks = DAY_W < 16 && DAY_W >= 4;
  const showMonthsOnly = DAY_W < 4;

  const monthLabels = useMemo(() => {
    const out: { offset: number; count: number; label: string }[] = []; let last = "";
    days.forEach((d, i) => {
      const dt = parseISODate(d.date), k = `${dt.getFullYear()}-${dt.getMonth()}`;
      if (k !== last) { last = k; out.push({ offset: i, count: 1, label: dt.toLocaleDateString(undefined, { month: "short", year: "numeric" }) }); }
      else out[out.length - 1].count++;
    });
    return out;
  }, [days]);

  const weekLabels = useMemo(() => {
    const out: { offset: number; count: number; label: string }[] = []; let last = "";
    days.forEach((d, i) => {
      const dt = parseISODate(d.date);
      const dow = dt.getDay();
      const monday = addDays(d.date, dow === 0 ? -6 : 1 - dow);
      if (monday !== last) {
        last = monday;
        out.push({ offset: i, count: 1, label: parseISODate(monday).toLocaleDateString(undefined, { month: "short", day: "numeric" }) });
      } else out[out.length - 1].count++;
    });
    return out;
  }, [days]);

  // Week bands across the top of the chart. A six-week lookahead is discussed
  // in week numbers — "what's in 32?" — so those replace the month strip.
  const weekBands = useMemo(() => {
    const out: { offset: number; count: number; week: number; monday: string }[] = [];
    let last = "";
    days.forEach((d, i) => {
      const monday = mondayOf(d.date);
      if (monday !== last) {
        last = monday;
        out.push({ offset: i, count: 1, week: isoWeek(monday), monday });
      } else out[out.length - 1].count++;
    });
    return out;
  }, [days]);

  const chartW = totalDays * DAY_W;
  const dayOff = (d: string) => diffInDays(rangeStart, d);

  // ── Cascade (push successors forward on date change) ─────────────────────────
  function cascade(taskId: string, m: Map<string, Task>, visited = new Set<string>()) {
    if (visited.has(taskId)) return m;
    visited.add(taskId);
    for (const succId of successorsOf.get(taskId) ?? []) {
      const succ = m.get(succId); if (!succ) continue;
      // Required start = day after the LATEST-finishing predecessor (respects multiple preds)
      const allPreds = predsOf.get(succId) ?? [];
      const rawReqStart = allPreds.reduce((latest, dep) => {
        const pred = m.get(dep.predecessor_id); if (!pred) return latest;
        const r = addDays(pred.end_date, 1 + dep.lag_days);
        return r > latest ? r : latest;
      }, "");
      if (!rawReqStart) continue;
      // Milestones snap off weekends too (using their own Sat/Sun flags, default false).
      const reqStart = nextWorkingDay(rawReqStart, succ.work_sat ?? false, succ.work_sun ?? false, holidaySet);
      if (succ.start_date === reqStart) continue;
      const dur = diffInDays(succ.start_date, succ.end_date);
      m.set(succId, { ...succ, start_date: reqStart, end_date: addDays(reqStart, dur) });
      cascade(succId, m, visited);
    }
    return m;
  }

  // ── Drag ─────────────────────────────────────────────────────────────────────
  function onDown(e: React.PointerEvent, task: Task, mode: DragMode) {
    if (readOnly || saving) return;
    e.preventDefault(); e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ taskId: task.id, mode, startX: e.clientX, origStart: task.start_date, origEnd: task.end_date });
  }

  function onMove(e: React.PointerEvent) {
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.startX) / DAY_W);
    if (!delta) return;
    setTasks(prev => prev.map(t => {
      if (t.id !== drag.taskId) return t;
      if (drag.mode === "move") return { ...t, start_date: addDays(drag.origStart, delta), end_date: addDays(drag.origEnd, delta) };
      if (drag.mode === "resize-start") { const ns = addDays(drag.origStart, delta); return ns >= t.end_date ? t : { ...t, start_date: ns }; }
      const ne = addDays(drag.origEnd, delta); return ne <= t.start_date ? t : { ...t, end_date: ne };
    }));
  }

  async function onUp() {
    if (!drag) return;
    const d = drag; setDrag(null);

    // Read from ref — avoids stale closure from onMove batching
    const current = tasksRef.current;
    const task = current.find(t => t.id === d.taskId); if (!task) return;
    if (task.start_date === d.origStart && task.end_date === d.origEnd) return;

    const m = new Map(current.map(t => [t.id, t]));
    cascade(d.taskId, m);
    const next = recomputeSummaryDates(Array.from(m.values()));
    setTasks(next);
    tasksRef.current = next;

    // Compare against initialTasks (server state) — taskMap reflects moved positions already
    const serverMap = new Map(initialTasks.map(t => [t.id, t]));
    const changed = next.filter(t => {
      const o = serverMap.get(t.id);
      return o && (o.start_date !== t.start_date || o.end_date !== t.end_date);
    });
    if (!changed.length) return;

    setSaving(true);
    try {
      await supa.auth.getSession();
      const results = await Promise.all(
        changed.map(t => supa.from("tasks").update({ start_date: t.start_date, end_date: t.end_date }).eq("id", t.id))
      );
      const failed = results.find(r => r.error);
      if (failed) throw new Error(failed.error!.message);
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save dates.");
      setTasks(initialTasks);
      tasksRef.current = initialTasks;
    }
    finally { setSaving(false); }
  }

  // ── Task mutations ────────────────────────────────────────────────────────────
  async function addTask(parentId: string | null = null) {
    await supa.auth.getSession();
    const today = todayISO();
    const sibs = tasks.filter(t => (t.parent_id ?? null) === parentId);
    const maxOrd = sibs.reduce((mx, t) => Math.max(mx, t.sort_order), -1);
    const { data, error: err } = await supa.from("tasks")
      .insert({
        project_id: projectId, title: "New Task",
        start_date: today, end_date: addDays(today, 4),
        status: "not_started", parent_id: parentId, sort_order: maxOrd + 1,
      })
      .select("id, project_id, title, start_date, end_date, assignee_id, champion_id, status, parent_id, sort_order, created_at, work_sat, work_sun, is_milestone")
      .single();
    if (err) { setError(err.message); return; }
    if (data) {
      const newTask = data as Task;
      const next = recomputeSummaryDates([...tasks, newTask]);
      setTasks(next);
      if (parentId) setExpanded(prev => new Set([...prev, parentId]));
      setEdit({ taskId: newTask.id, field: "title", value: "New Task" });
    }
  }

  async function deleteTask(taskId: string) {
    if (!confirm("Delete this task and all its subtasks?")) return;
    await supa.auth.getSession();
    const { error: err } = await supa.from("tasks").delete().eq("id", taskId);
    if (err) { setError(err.message); return; }
    const rm = new Set<string>();
    const collect = (id: string) => { rm.add(id); tasks.forEach(t => { if (t.parent_id === id) collect(t.id); }); };
    collect(taskId);
    const next = recomputeSummaryDates(tasks.filter(t => !rm.has(t.id)));
    setTasks(next);
    setDeps(prev => prev.filter(d => !rm.has(d.task_id) && !rm.has(d.predecessor_id)));
    setSupport(prev => prev.filter(s => !rm.has(s.task_id)));
    const changed = next.filter(t => { const o = taskMap.get(t.id); return o && (o.start_date !== t.start_date || o.end_date !== t.end_date); });
    if (changed.length) await Promise.all(changed.map(t => supa.from("tasks").update({ start_date: t.start_date, end_date: t.end_date }).eq("id", t.id)));
  }

  async function saveTitle(taskId: string, title: string) {
    const v = title.trim(); if (!v) return;
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, title: v } : t));
    await supa.auth.getSession();
    await supa.from("tasks").update({ title: v }).eq("id", taskId);
  }

  async function savePredecessors(taskId: string, input: string) {
    const task = taskMap.get(taskId); if (!task) return;
    const predIds = input.split(",").map(s => s.trim()).filter(Boolean)
      .map(w => wbsToTask.get(w)?.id).filter((id): id is string => !!id && id !== taskId);
    await supa.auth.getSession();
    await supa.from("task_dependencies").delete().eq("task_id", taskId);
    const newDeps = predIds.map(pred_id => ({ task_id: taskId, predecessor_id: pred_id, lag_days: 0 }));
    if (newDeps.length) await supa.from("task_dependencies").insert(newDeps);
    setDeps(prev => [...prev.filter(d => d.task_id !== taskId), ...newDeps]);

    // Move the task to start right after its new predecessors finish, preserving its duration.
    if (predIds.length) {
      const reqStart = predIds.reduce((latest, pid) => {
        const pred = taskMap.get(pid); if (!pred) return latest;
        return pred.end_date > latest ? pred.end_date : latest;
      }, "");
      const rawStart = addDays(reqStart, 1);
      const start = nextWorkingDay(rawStart, task.work_sat ?? false, task.work_sun ?? false, holidaySet);
      if (start !== task.start_date) {
        const hasKidsTask = (cm.get(taskId) ?? []).length > 0;
        if (hasKidsTask) {
          // Summary tasks' own dates are derived from children — shift the whole subtree instead.
          await shiftSubtree(taskId, diffInDays(task.start_date, start));
        } else {
          const ws = task.work_sat ?? false, wsu = task.work_sun ?? false;
          const wDur = task.is_milestone ? 0 : countWorkingDays(task.start_date, task.end_date, ws, wsu, holidaySet);
          const newEnd = task.is_milestone ? start : (wDur <= 1 ? start : addWorkingDays(start, wDur - 1, ws, wsu, holidaySet));
          await applyDateChange(taskId, { start_date: start, end_date: newEnd });
        }
        return;
      }
    }
    router.refresh();
  }

  async function saveLag(taskId: string, input: string) {
    const lag = parseInt(input.trim(), 10);
    if (isNaN(lag)) return;
    const task = taskMap.get(taskId); if (!task) return;
    const predDeps = deps.filter(d => d.task_id === taskId);
    if (!predDeps.length) return;

    // Update local deps with new lag
    setDeps(prev => prev.map(d => d.task_id === taskId ? { ...d, lag_days: lag } : d));

    // Compute new required start from updated lag
    const rawReqStart = predDeps.reduce((latest, dep) => {
      const pred = taskMap.get(dep.predecessor_id); if (!pred) return latest;
      const r = addDays(pred.end_date, 1 + lag);
      return r > latest ? r : latest;
    }, "");
    const reqStart = rawReqStart
      ? nextWorkingDay(rawReqStart, task.work_sat ?? false, task.work_sun ?? false, holidaySet)
      : rawReqStart;

    if (reqStart && reqStart !== task.start_date) {
      const ws = task.work_sat ?? false, wsu = task.work_sun ?? false;
      const wDur = task.is_milestone ? 0 : countWorkingDays(task.start_date, task.end_date, ws, wsu, holidaySet);
      const newEnd = task.is_milestone ? reqStart : (wDur <= 1 ? reqStart : addWorkingDays(reqStart, wDur - 1, ws, wsu, holidaySet));
      await applyDateChange(taskId, { start_date: reqStart, end_date: newEnd });
    }

    await supa.auth.getSession();
    await Promise.all(predDeps.map(d =>
      supa.from("task_dependencies").update({ lag_days: lag }).eq("task_id", taskId).eq("predecessor_id", d.predecessor_id)
    ));
    router.refresh();
  }

  function collectLeaves(id: string): string[] {
    const kids = cm.get(id) ?? [];
    if (!kids.length) return [id];
    return kids.flatMap(k => collectLeaves(k.id));
  }

  // Shift every leaf descendant of a summary task by deltaDays, cascade their successors, recompute parents.
  async function shiftSubtree(taskId: string, deltaDays: number) {
    if (!deltaDays) { router.refresh(); return; }
    const leaves = collectLeaves(taskId);
    const m = new Map(tasksRef.current.map(t => [t.id, t]));
    const visited = new Set<string>();
    for (const leafId of leaves) {
      const leaf = m.get(leafId); if (!leaf) continue;
      m.set(leafId, { ...leaf, start_date: addDays(leaf.start_date, deltaDays), end_date: addDays(leaf.end_date, deltaDays) });
      cascade(leafId, m, visited);
    }
    const next = recomputeSummaryDates(Array.from(m.values()));
    setTasks(next);
    tasksRef.current = next;
    const serverMap = new Map(initialTasks.map(t => [t.id, t]));
    const changed = next.filter(t => {
      const o = serverMap.get(t.id);
      return o && (o.start_date !== t.start_date || o.end_date !== t.end_date);
    });
    if (!changed.length) { router.refresh(); return; }
    await supa.auth.getSession();
    const results = await Promise.all(
      changed.map(t => supa.from("tasks").update({ start_date: t.start_date, end_date: t.end_date }).eq("id", t.id))
    );
    const failed = results.find(r => r.error);
    if (failed) { setError(failed.error!.message); return; }
    router.refresh();
  }

  // Apply a date change to one task, cascade to all successors, recompute summary parents, persist everything.
  async function applyDateChange(taskId: string, patch: Partial<Task>) {
    const task = taskMap.get(taskId); if (!task) return;
    const m = new Map(tasksRef.current.map(t => [t.id, t]));
    m.set(taskId, { ...task, ...patch });
    cascade(taskId, m);
    const next = recomputeSummaryDates(Array.from(m.values()));
    setTasks(next);
    tasksRef.current = next;
    const serverMap = new Map(initialTasks.map(t => [t.id, t]));
    const changed = next.filter(t => {
      const o = serverMap.get(t.id);
      return o && (o.start_date !== t.start_date || o.end_date !== t.end_date);
    });
    if (!changed.length) return;
    await supa.auth.getSession();
    const results = await Promise.all(
      changed.map(t => supa.from("tasks").update({ start_date: t.start_date, end_date: t.end_date }).eq("id", t.id))
    );
    const failed = results.find(r => r.error);
    if (failed) { setError(failed.error!.message); return; }
    router.refresh();
  }

  async function saveDuration(taskId: string, input: string) {
    const task = taskMap.get(taskId); if (!task) return;
    const n = parseInt(input.trim(), 10);
    if (isNaN(n) || n < 0) return;
    const isMilestone = n === 0;
    const ws = task.work_sat ?? false, wsu = task.work_sun ?? false;
    const start = nextWorkingDay(task.start_date, ws, wsu, holidaySet);
    const newEnd = isMilestone ? start : addWorkingDays(start, n - 1, ws, wsu, holidaySet);
    // Save is_milestone flag first, then cascade dates
    await supa.auth.getSession();
    await supa.from("tasks").update({ is_milestone: isMilestone }).eq("id", taskId);
    await applyDateChange(taskId, { start_date: start, end_date: newEnd, is_milestone: isMilestone });
  }

  async function saveStartDate(taskId: string, newStartInput: string) {
    const task = taskMap.get(taskId); if (!task || !newStartInput) return;
    const ws = task.work_sat ?? false, wsu = task.work_sun ?? false;
    const newStart = nextWorkingDay(newStartInput, ws, wsu, holidaySet);
    const wDur = task.is_milestone ? 0 : Math.max(1, countWorkingDays(task.start_date, task.end_date, ws, wsu, holidaySet));
    const newEnd = task.is_milestone ? newStart : addWorkingDays(newStart, wDur - 1, ws, wsu, holidaySet);
    await applyDateChange(taskId, { start_date: newStart, end_date: newEnd });
  }

  async function saveEndDate(taskId: string, newEnd: string) {
    const task = taskMap.get(taskId); if (!task || !newEnd) return;
    if (newEnd < task.start_date) return;
    await applyDateChange(taskId, { end_date: newEnd });
  }

  async function saveRole(taskId: string, roleId: string) {
    const rid = roleId || null;
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, role_id: rid } : t));
    tasksRef.current = tasksRef.current.map(t => t.id === taskId ? { ...t, role_id: rid } : t);
    await supa.auth.getSession();
    const { error: err } = await supa.from("tasks").update({ role_id: rid }).eq("id", taskId);
    if (err) setError(err.message);
  }

  async function saveSubcontractor(taskId: string, value: string) {
    const sub = value.trim() || null;
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, subcontractor: sub } : t));
    await supa.auth.getSession();
    await supa.from("tasks").update({ subcontractor: sub }).eq("id", taskId);
  }

  async function saveCrew(taskId: string, value: string) {
    const crew = value.trim() ? parseInt(value.trim(), 10) : null;
    if (value.trim() && isNaN(crew!)) return;
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, crew_size: crew } : t));
    await supa.auth.getSession();
    await supa.from("tasks").update({ crew_size: crew }).eq("id", taskId);
  }

  async function saveChampion(taskId: string, championId: string | null) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, champion_id: championId } : t));
    await supa.auth.getSession();
    await supa.from("tasks").update({ champion_id: championId }).eq("id", taskId);
  }

  async function addSupport(taskId: string, userId: string) {
    if ((supportOf.get(taskId) ?? []).includes(userId)) return;
    await supa.auth.getSession();
    const { error: err } = await supa.from("task_support").insert({ task_id: taskId, user_id: userId });
    if (err) { setError(err.message); return; }
    setSupport(prev => [...prev, { task_id: taskId, user_id: userId }]);
  }

  async function removeSupport(taskId: string, userId: string) {
    await supa.auth.getSession();
    await supa.from("task_support").delete().eq("task_id", taskId).eq("user_id", userId);
    setSupport(prev => prev.filter(s => !(s.task_id === taskId && s.user_id === userId)));
  }

  async function saveWorkDay(taskId: string, field: "work_sat" | "work_sun", value: boolean) {
    const task = taskMap.get(taskId); if (!task) return;
    const oldSat = task.work_sat ?? false, oldSun = task.work_sun ?? false;
    const newSat = field === "work_sat" ? value : oldSat;
    const newSun = field === "work_sun" ? value : oldSun;

    // Snap the start forward if it no longer falls on a working day under the new
    // flags (applies to milestones too — they still shouldn't sit on a weekend).
    const newStart = nextWorkingDay(task.start_date, newSat, newSun, holidaySet);
    let newEnd = newStart;
    if (!task.is_milestone) {
      // Preserve the working-day count across the flag change.
      const oldDur = Math.max(1, countWorkingDays(task.start_date, task.end_date, oldSat, oldSun, holidaySet));
      newEnd = addWorkingDays(newStart, oldDur - 1, newSat, newSun, holidaySet);
    }

    const m = new Map(tasksRef.current.map(t => [t.id, t]));
    m.set(taskId, { ...task, work_sat: newSat, work_sun: newSun, start_date: newStart, end_date: newEnd });
    cascade(taskId, m);
    const next = recomputeSummaryDates(Array.from(m.values()));
    setTasks(next);
    tasksRef.current = next;

    await supa.auth.getSession();
    await supa.from("tasks").update({ work_sat: newSat, work_sun: newSun, start_date: newStart, end_date: newEnd }).eq("id", taskId);

    const serverMap = new Map(initialTasks.map(t => [t.id, t]));
    const changed = next.filter(t => {
      if (t.id === taskId) return false;
      const o = serverMap.get(t.id);
      return o && (o.start_date !== t.start_date || o.end_date !== t.end_date);
    });
    if (changed.length) {
      await Promise.all(changed.map(t => supa.from("tasks").update({ start_date: t.start_date, end_date: t.end_date }).eq("id", t.id)));
    }
    router.refresh();
  }

  async function indentTask(taskId: string) {
    const task = taskMap.get(taskId); if (!task) return;
    const sibs = cm.get(task.parent_id ?? null) ?? [];
    const idx = sibs.findIndex(t => t.id === taskId); if (idx <= 0) return;
    const np = sibs[idx - 1], ord = (cm.get(np.id) ?? []).length;
    await supa.auth.getSession();
    await supa.from("tasks").update({ parent_id: np.id, sort_order: ord }).eq("id", taskId);
    const next = recomputeSummaryDates(tasks.map(t => t.id === taskId ? { ...t, parent_id: np.id, sort_order: ord } : t));
    setTasks(next);
    setExpanded(prev => new Set([...prev, np.id]));
  }

  async function outdentTask(taskId: string) {
    const task = taskMap.get(taskId); if (!task || !task.parent_id) return;
    const par = taskMap.get(task.parent_id); if (!par) return;
    const idx = (cm.get(par.parent_id ?? null) ?? []).findIndex(t => t.id === par.id);
    await supa.auth.getSession();
    await supa.from("tasks").update({ parent_id: par.parent_id ?? null, sort_order: idx + 0.5 }).eq("id", taskId);
    const next = recomputeSummaryDates(tasks.map(t => t.id === taskId ? { ...t, parent_id: par.parent_id ?? null, sort_order: idx + 0.5 } : t));
    setTasks(next);
  }

  // Reorder taskId to sit just before/after targetId among its siblings (same parent).
  async function reorderRow(taskId: string, targetId: string) {
    if (taskId === targetId) return;
    const task = taskMap.get(taskId); const target = taskMap.get(targetId);
    if (!task || !target) return;
    // Drop onto a summary task = insert as first child of that summary.
    // This is easy to trigger by accident (a slight trackpad jitter while
    // grabbing the drag handle), so confirm before nesting under a new parent.
    const targetHasKids = (cm.get(targetId) ?? []).length > 0;
    if (targetHasKids && task.parent_id !== targetId) {
      if (!confirm(`Make "${task.title}" a sub-task of "${target.title}"?`)) return;
    }
    const newParentId = targetHasKids ? targetId : (target.parent_id ?? null);
    const insertBeforeId = targetHasKids ? null : targetId; // null = prepend

    // Build new sibling list: take current siblings of new parent (minus taskId), splice in task
    const newSibs = (cm.get(newParentId) ?? []).filter(t => t.id !== taskId);
    const insertIdx = insertBeforeId ? newSibs.findIndex(t => t.id === insertBeforeId) : 0;
    newSibs.splice(insertIdx === -1 ? newSibs.length : insertIdx, 0, task);

    const sibUpdates = newSibs.map((t, i) => ({ id: t.id, sort_order: i }));

    // If moving to a different parent, also renumber old siblings
    const oldParentId = task.parent_id ?? null;
    const oldSibUpdates = oldParentId !== newParentId
      ? (cm.get(oldParentId) ?? []).filter(t => t.id !== taskId).map((t, i) => ({ id: t.id, sort_order: i }))
      : [];

    // Optimistic update
    const allUpdates = [...sibUpdates, ...oldSibUpdates];
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) return { ...t, parent_id: newParentId, sort_order: insertIdx === -1 ? newSibs.length - 1 : insertIdx };
      const u = allUpdates.find(u => u.id === t.id);
      return u ? { ...t, sort_order: u.sort_order } : t;
    }));

    await supa.auth.getSession();
    const dbOps = [
      ...allUpdates.map(u => supa.from("tasks").update({ sort_order: u.sort_order }).eq("id", u.id)),
      ...(oldParentId !== newParentId
        ? [supa.from("tasks").update({ parent_id: newParentId, sort_order: insertIdx === -1 ? newSibs.length - 1 : insertIdx }).eq("id", taskId)]
        : []),
    ];
    await Promise.all(dbOps);
    router.refresh();
  }

  // ── Stat holiday mutations ────────────────────────────────────────────────────
  async function addHoliday() {
    if (!newHolDate || !newHolLabel.trim()) return;
    await supa.auth.getSession();
    const { data, error: err } = await supa.from("stat_holidays")
      .insert({ date: newHolDate, label: newHolLabel.trim() })
      .select("id, date, label").single();
    if (err) { setError(err.message); return; }
    if (data) setHolidays(prev => [...prev, data as StatHoliday].sort((a, b) => a.date.localeCompare(b.date)));
    setNewHolDate(""); setNewHolLabel("");
  }

  async function deleteHoliday(id: string) {
    await supa.auth.getSession();
    await supa.from("stat_holidays").delete().eq("id", id);
    setHolidays(prev => prev.filter(h => h.id !== id));
  }

  // ── Print / PDF export ───────────────────────────────────────────────────────
  function printGantt() {
    function flatAll(m: Map<string | null, Task[]>): Task[] {
      const out: Task[] = [];
      function walk(pid: string | null) { for (const t of m.get(pid) ?? []) { out.push(t); walk(t.id); } }
      walk(null);
      return out;
    }

    // With a locked window (the 6-week lookahead), the printout covers exactly
    // that window: tasks entirely outside it are dropped, and bars that spill
    // over either edge get clipped at the boundary further below.
    const all = fixedStart && fixedEnd
      ? flatAll(cm).filter(t => t.start_date <= fixedEnd && t.end_date >= fixedStart)
      : flatAll(cm);
    if (!all.length) return;

    // The printed row order has to match the screen exactly, week bands and all,
    // or the A3 stops being the same document you just reviewed. Bands occupy a
    // full row height so the chart SVG stays aligned by simple index maths.
    type PItem =
      | { kind: "band"; week: number; monday: string; total: number; constraints: number }
      | { kind: "task"; task: Task };

    const pOrdered = lookaheadStyle
      ? [...all].sort((a, b) =>
          a.start_date.localeCompare(b.start_date) ||
          a.end_date.localeCompare(b.end_date) ||
          a.title.localeCompare(b.title))
      : all;

    const pItems: PItem[] = [];
    if (lookaheadStyle) {
      const tally = new Map<string, { total: number; constraints: number }>();
      for (const t of pOrdered) {
        const mon = mondayOf(t.start_date);
        const e = tally.get(mon) ?? { total: 0, constraints: 0 };
        e.total++;
        if (t.is_constraint) e.constraints++;
        tally.set(mon, e);
      }
      let lastMon = "";
      for (const t of pOrdered) {
        const mon = mondayOf(t.start_date);
        if (mon !== lastMon) {
          lastMon = mon;
          pItems.push({ kind: "band", week: isoWeek(mon), monday: mon, ...tally.get(mon)! });
        }
        pItems.push({ kind: "task", task: t });
      }
    } else {
      for (const t of pOrdered) pItems.push({ kind: "task", task: t });
    }

    const pIdx = new Map<string, number>();
    pItems.forEach((it, i) => { if (it.kind === "task") pIdx.set(it.task.id, i); });
    const pRows = pItems.length;

    // Date range: the locked window if set, else tight around the tasks.
    const pStart = fixedStart ?? all.reduce((s, t) => t.start_date < s ? t.start_date : s, all[0].start_date);
    const pEnd   = fixedEnd   ?? all.reduce((s, t) => t.end_date   > s ? t.end_date   : s, all[0].end_date);
    const pDays  = diffInDays(pStart, pEnd) + 1;

    // Print table columns mirror the on-screen table (minus the actions column).
    // The printed column set mirrors the screen exactly — a lookahead someone
    // reviews on screen and the A3 they hand the Village should be the same
    // document. Dependency arrows carry what Pred./Lag used to say.
    const kidIds = new Set(tasks.filter(t => t.parent_id).map(t => t.parent_id as string));
    const pCols: { label: string; w: number; center?: boolean; cell: (t: Task) => string }[] = [
      ...(lookaheadStyle ? [{
        label: "", w: 16, center: true, cell: (t: Task) => {
          const m = READY_META[readinessOf(t, kidIds.has(t.id))];
          return `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${m.color}"></span>`;
        },
      }] : []),
      ...(!lookaheadStyle ? [{ label: "#", w: 38, cell: (t: Task) => `<span style="font-family:monospace">${wbsMap.get(t.id) ?? ""}</span>` }] : []),
      { label: lookaheadStyle ? "Activity" : "Task Name", w: lookaheadStyle ? 230 : 200, cell: t => t.title },
      { label: "Days", w: 32, center: true, cell: () => "" }, // filled per-row below (needs computed duration)
      { label: "Start", w: 64, center: true, cell: t => `<span style="font-family:monospace">${t.start_date}</span>` },
      { label: "Finish", w: 64, center: true, cell: t => `<span style="font-family:monospace">${t.end_date}</span>` },
      ...(!lookaheadStyle ? [
        { label: "Pred.", w: 46, center: true, cell: (t: Task) => (predsOf.get(t.id) ?? []).map(d => wbsMap.get(d.predecessor_id)).filter(Boolean).join(", ") },
        { label: "Lag", w: 28, center: true, cell: (t: Task) => { const ds = predsOf.get(t.id) ?? []; return ds.length && ds[0].lag_days ? String(ds[0].lag_days) : ""; } },
      ] : []),
      // On paper the avatars can't be hovered, so "Who" prints as names —
      // champion first, support after.
      ...(lookaheadStyle ? [{
        label: "Who", w: 128, cell: (t: Task) => {
          const champ = t.champion_id ? memberMap.get(t.champion_id) : undefined;
          const supps = (supportOf.get(t.id) ?? []).map(id => memberMap.get(id)).filter((p): p is Profile => !!p);
          // Full names, not first-word — "T. Okafor".split(" ")[0] is just "T.",
          // which is what the old Support column printed. Capped instead so the
          // column can't run away on a task with five supporters.
          const nameOf = (p: Profile) => p.full_name || p.email.split("@")[0];
          const shown = supps.slice(0, 2).map(nameOf);
          const extra = supps.length - shown.length;
          const parts = [
            ...(champ ? [`<b>${nameOf(champ)}</b>`] : []),
            ...shown,
            ...(extra > 0 ? [`+${extra}`] : []),
          ];
          return parts.length ? parts.join(", ") : `<span style="color:#d97706">Unassigned</span>`;
        },
      }] : []),
      ...(!lookaheadStyle && !hideChampionCol ? [{ label: "Champion", w: 82, cell: (t: Task) => { const p = t.champion_id ? memberMap.get(t.champion_id) : undefined; return p ? (p.full_name || p.email.split("@")[0]) : ""; } }] : []),
      ...(!lookaheadStyle && !hideSupportCol ? [{ label: "Support", w: 92, cell: (t: Task) => (supportOf.get(t.id) ?? []).map(id => { const p = memberMap.get(id); return p ? (p.full_name || p.email).split(" ")[0] : ""; }).filter(Boolean).join(", ") }] : []),
      ...(!lookaheadStyle ? [
        { label: "Sat", w: 24, center: true, cell: (t: Task) => (t.work_sat ? "✓" : "") },
        { label: "Sun", w: 24, center: true, cell: (t: Task) => (t.work_sun ? "✓" : "") },
      ] : []),
      { label: lookaheadStyle ? "Trade" : "Role/Trade", w: 74, cell: t => (t.role_id ? (roles.find(r => r.id === t.role_id)?.name ?? "") : "") },
      ...(!hideCrewCol ? [{ label: "Crew", w: 30, center: true, cell: (t: Task) => (t.crew_size != null ? String(t.crew_size) : "") }] : []),
      ...(!hideDtcCol ? [{ label: "DTC", w: 30, center: true, cell: (t: Task) => { if (t.is_milestone || t.is_constraint) return ""; const today = todayISO(); return t.end_date >= today ? String(countWorkingDays(today, t.end_date, t.work_sat ?? false, t.work_sun ?? false, holidaySet)) : "0"; } }] : []),
    ];
    const tableW = pCols.reduce((a, c) => a + c.w + 8, 0); // +8 ≈ cell padding

    // In fixed-range mode (the 6-week lookahead), the chart always stretches to
    // fill the full print width — the on-screen zoom doesn't constrain it, since
    // the on-screen day width is itself sized for the browser viewport, which is
    // usually much narrower than an A3 landscape page. Other (non-fixed) charts
    // keep mirroring the on-screen zoom, only capped so they still fit the page.
    const AVAIL_W = Math.max(320, 1520 - tableW);
    const D = fixedStart && fixedEnd
      ? Math.max(2, Math.floor(AVAIL_W / pDays))
      : Math.max(2, Math.min(DAY_W, Math.floor(AVAIL_W / pDays)));
    // Header height: 24px month row + day/week row (20px) when shown, else just month row (24px).
    const pShowDays  = D >= 16;
    const pShowWeeks = D >= 4 && D < 16;
    const HEAD = pShowDays || pShowWeeks ? 44 : 24;

    // Row height shrinks to fit the sheet instead of being hard-coded at 20.
    // A3 landscape is ~1123px tall at 96dpi and the @page bottom margin takes
    // 8mm; everything except the rows is fixed chrome, so the rows get what's
    // left. Previously R was fixed and `.content` clipped the overflow, so a
    // long lookahead silently lost its last activities off the bottom of a
    // sheet being handed to the Village.
    const PAGE_H   = 1123 - 30;                       // sheet minus bottom margin
    const CHROME_H = 64 + 44 + 16                     // banner + fixed footer + padding
      + (hideLegendOnPrint ? 0 : 26)                  // legend strip
      + (lookaheadStyle ? 26 : 0);                    // readiness key strip
    const AVAIL_H  = Math.max(160, PAGE_H - CHROME_H - HEAD);
    const R = Math.max(11, Math.min(20, Math.floor(AVAIL_H / Math.max(1, pRows))));

    // Month segments
    const months: { offset: number; count: number; label: string }[] = [];
    let lastM = "";
    for (let i = 0; i < pDays; i++) {
      const d = addDays(pStart, i), dt = parseISODate(d);
      const k = `${dt.getFullYear()}-${dt.getMonth()}`;
      if (k !== lastM) { lastM = k; months.push({ offset: i, count: 1, label: dt.toLocaleDateString(undefined, { month: "short", year: "numeric" }) }); }
      else months[months.length - 1].count++;
    }

    // Week segments (for week-label mode)
    const weeks: { offset: number; count: number; label: string }[] = [];
    if (pShowWeeks) {
      let lastW = "";
      for (let i = 0; i < pDays; i++) {
        const d = addDays(pStart, i), dt = parseISODate(d);
        const dow = dt.getDay();
        const monday = addDays(d, dow === 0 ? -6 : 1 - dow);
        if (monday !== lastW) {
          lastW = monday;
          weeks.push({ offset: i, count: 1, label: parseISODate(monday).toLocaleDateString(undefined, { month: "short", day: "numeric" }) });
        } else weeks[weeks.length - 1].count++;
      }
    }

    // Weekend shading rects
    let bgSVG = "";
    for (let i = 0; i < pDays; i++) {
      const dow = parseISODate(addDays(pStart, i)).getDay();
      if (dow === 0 || dow === 6) bgSVG += `<rect x="${i * D}" y="0" width="${D}" height="${pRows * R}" fill="rgba(0,0,0,0.04)"/>`;
    }

    // Month border lines on grid
    months.forEach(m => {
      bgSVG += `<line x1="${m.offset * D}" y1="0" x2="${m.offset * D}" y2="${pRows * R}" stroke="#cbd5e1" stroke-width="1.5"/>`;
    });

    // Today line
    const todayOff = diffInDays(pStart, todayISO());
    if (todayOff >= 0 && todayOff <= pDays) bgSVG += `<line x1="${todayOff * D}" y1="0" x2="${todayOff * D}" y2="${pRows * R}" stroke="#f87171" stroke-width="1" stroke-dasharray="3,2"/>`;

    // Bars
    let barsSVG = "";
    pItems.forEach((item, idx) => {
      if (item.kind !== "task") return;   // band rows draw no bar
      const task = item.task;
      const hasKids = (cm.get(task.id) ?? []).length > 0;
      const isCon = task.is_constraint ?? false;
      const isMile = (task.is_milestone ?? false) && !isCon;
      // Clip bars at the window edges so nothing extends past the printed range.
      const barStart = task.start_date < pStart ? pStart : task.start_date;
      const barEnd = task.end_date > pEnd ? pEnd : task.end_date;
      const off = diffInDays(pStart, barStart);
      const calW = Math.max((diffInDays(barStart, barEnd) + 1) * D, 3);
      const color = hasKids ? "#1A3560" : (task.role_id ? (roles.find(r => r.id === task.role_id)?.color ?? "#94A3B8") : "#94A3B8");
      const cy = idx * R + R / 2;

      if (isCon) {
        const cx = off * D + D / 2, s = 6;
        barsSVG += `<circle cx="${cx}" cy="${cy}" r="${s}" fill="#ef4444" stroke="#b91c1c" stroke-width="1"/>`;
      } else if (isMile) {
        const cx = off * D + D / 2, s = 6;
        barsSVG += `<rect x="${cx - s}" y="${cy - s}" width="${s * 2}" height="${s * 2}" fill="#F59E0B" stroke="#D97706" stroke-width="1" transform="rotate(45,${cx},${cy})"/>`;
      } else if (hasKids) {
        barsSVG += `<rect x="${off * D}" y="${cy - 4}" width="${calW}" height="5" fill="${color}"/>`;
        barsSVG += `<polygon points="${off * D},${cy - 4} ${off * D},${cy + 4} ${off * D + 5},${cy}" fill="${color}"/>`;
        barsSVG += `<polygon points="${off * D + calW},${cy - 4} ${off * D + calW},${cy + 4} ${off * D + calW - 5},${cy}" fill="${color}"/>`;
      } else {
        barsSVG += `<rect x="${off * D}" y="${cy - 8}" width="${calW}" height="13" fill="${color}" rx="2"/>`;
        if (championBadge && task.champion_id) {
          const bx = off * D + calW, by = cy;
          const p = memberMap.get(task.champion_id);
          barsSVG += `<circle cx="${bx}" cy="${by}" r="6" fill="${champColorMap.get(task.champion_id) ?? "#1A3560"}" stroke="white" stroke-width="1.5"/>`;
          if (p) barsSVG += `<text x="${bx}" y="${by + 2.5}" font-size="6" font-weight="700" fill="white" text-anchor="middle">${initials(p)}</text>`;
        }
      }
    });

    // Horizontal row lines
    for (let i = 1; i < pRows; i++) barsSVG += `<line x1="0" y1="${i * R}" x2="${pDays * D}" y2="${i * R}" stroke="#f1f5f9" stroke-width="0.5"/>`;

    // Dependency arrows
    // Indices come from pItems so arrows still land on their rows once week
    // bands are interleaved.
    let arrowsSVG = `<defs><marker id="ph" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L5,3 L0,6 Z" fill="#94a3b8"/></marker></defs>`;
    for (const dep of deps) {
      const predIdx = pIdx.get(dep.predecessor_id);
      const succIdx = pIdx.get(dep.task_id);
      if (predIdx === undefined || succIdx === undefined) continue;
      const predItem = pItems[predIdx], succItem = pItems[succIdx];
      if (predItem.kind !== "task" || succItem.kind !== "task") continue;
      const predTask = predItem.task, succTask = succItem.task;
      const x1 = (diffInDays(pStart, predTask.end_date) + 1) * D;
      const x2 = diffInDays(pStart, succTask.start_date) * D;
      const y1 = predIdx * R + R / 2;
      const y2 = succIdx * R + R / 2;
      // Same helper as the screen, so the printed links curve identically.
      const d = curvedLink(x1, y1, x2, y2, Math.abs(y1 - y2) < 2);
      arrowsSVG += `<path d="${d}" fill="none" stroke="#94a3b8" stroke-width="1.2" marker-end="url(#ph)"/>`;
    }

    // Table rows
    let tableRows = "";
    pItems.forEach((item) => {
      if (item.kind === "band") {
        tableRows += `<tr style="height:${R}px;background:#eef2f7">
          <td colspan="${pCols.length}" style="padding:0 6px;border-bottom:1px solid #cbd5e1">
            <span style="font-family:monospace;font-size:8.5px;font-weight:700;letter-spacing:0.11em;color:#1A3560">WEEK ${item.week}</span>
            <span style="font-family:monospace;font-size:8.5px;color:#64748b;margin-left:7px">${formatShortDate(item.monday)} – ${formatShortDate(addDays(item.monday, 6))}</span>
            <span style="font-family:monospace;font-size:8.5px;color:#94a3b8;margin-left:7px">${item.total} ${item.total === 1 ? "activity" : "activities"}${item.constraints > 0 ? ` · <span style="color:#dc2626;font-weight:700">${item.constraints} constraint${item.constraints === 1 ? "" : "s"}</span>` : ""}</span>
          </td>
        </tr>`;
        return;
      }
      const task = item.task;
      const wbs = wbsMap.get(task.id) ?? "";
      const lvl = depth(task, taskMap);
      const hasKids = (cm.get(task.id) ?? []).length > 0;
      const isCon = task.is_constraint ?? false;
      const isMile = (task.is_milestone ?? false) && !isCon;
      const ws = task.work_sat ?? false, wsu = task.work_sun ?? false;
      const wDur = isMile || isCon ? 0 : countWorkingDays(task.start_date, task.end_date, ws, wsu, holidaySet);
      const bg = isCon ? "#fde8e8" : isMile ? "#fef3e1" : LEVEL_BG[Math.min(lvl, LEVEL_BG.length - 1)];
      const durLabel = isCon ? "C" : isMile ? "M" : `${wDur}d`;
      const durColor = isCon ? "#dc2626" : "#374151";
      const cells = pCols.map(c => {
        if (c.label === "Days") {
          return `<td style="padding:0 4px;font-size:9px;text-align:center;color:${durColor};font-weight:${isCon ? 700 : 400}">${durLabel}</td>`;
        }
        if (c.label === "Task Name" || c.label === "Activity") {
          return `<td style="padding:0 4px;padding-left:${6 + lvl * 10}px;font-size:10px;font-weight:${hasKids ? 600 : 400};overflow:hidden;max-width:${c.w}px;white-space:nowrap">${task.title}</td>`;
        }
        if (c.label === "#") {
          return `<td style="padding:0 4px;font-size:9px;color:#6b7280;font-family:monospace">${wbs}</td>`;
        }
        return `<td style="padding:0 4px;font-size:9px;${c.center ? "text-align:center;" : ""}color:#374151;overflow:hidden;max-width:${c.w}px;white-space:nowrap">${c.cell(task)}</td>`;
      }).join("");
      tableRows += `<tr style="height:${R}px;background:${bg}">${cells}</tr>`;
    });

    // Month header for chart — two rows when showing days or weeks
    const MONTH_H = pShowDays || pShowWeeks ? 22 : HEAD;
    const SUB_H   = HEAD - MONTH_H;
    const monthHeader = months.map(m =>
      `<div style="position:absolute;left:${m.offset * D}px;width:${m.count * D}px;top:0;height:${MONTH_H}px;border-left:2px solid #cbd5e1;box-sizing:border-box;display:flex;align-items:center;justify-content:center;overflow:hidden">
        <span style="font-size:9px;font-weight:600;color:#1A3560">${m.label}</span>
      </div>`
    ).join("");

    // Sub-header: day numbers or week labels
    let subHeader = "";
    if (pShowDays) {
      for (let i = 0; i < pDays; i++) {
        const d = addDays(pStart, i), dt = parseISODate(d);
        const isWe = dt.getDay() === 0 || dt.getDay() === 6;
        subHeader += `<div style="position:absolute;left:${i * D}px;width:${D}px;top:${MONTH_H}px;height:${SUB_H}px;border-left:1px solid #e5e7eb;box-sizing:border-box;display:flex;align-items:center;justify-content:center;overflow:hidden;background:${isWe ? "rgba(0,0,0,0.04)" : "transparent"}">
          <span style="font-size:7px;color:${isWe ? "#9ca3af" : "#374151"}">${dt.getDate()}</span>
        </div>`;
      }
    } else if (pShowWeeks) {
      subHeader = weeks.map(w =>
        `<div style="position:absolute;left:${w.offset * D}px;width:${w.count * D}px;top:${MONTH_H}px;height:${SUB_H}px;border-left:1px solid #e5e7eb;box-sizing:border-box;display:flex;align-items:center;justify-content:center;overflow:hidden">
          <span style="font-size:7px;color:#374151">${w.label}</span>
        </div>`
      ).join("");
    }

    const chartW = pDays * D;
    // pRows, not all.length — the chart has to reserve a row for every week band
    // too, or it ends up shorter than the table beside it and the bars drift.
    const chartH = pRows * R;

    // Legend items
    const legendItems: string[] = [];
    roles.forEach(r => {
      legendItems.push(`<div style="display:flex;align-items:center;gap:4px">
        <div style="width:12px;height:12px;border-radius:2px;background:${r.color} !important;flex-shrink:0"></div>
        <span style="font-size:9px;color:#374151">${r.name}</span>
      </div>`);
    });
    legendItems.push(`<div style="display:flex;align-items:center;gap:4px">
      <div style="width:12px;height:12px;border-radius:2px;background:#94A3B8 !important;flex-shrink:0"></div>
      <span style="font-size:9px;color:#374151">No Role/Trade</span>
    </div>`);
    legendItems.push(`<div style="display:flex;align-items:center;gap:4px">
      <div style="width:12px;height:12px;border-radius:2px;background:#1A3560 !important;flex-shrink:0"></div>
      <span style="font-size:9px;color:#374151">Summary</span>
    </div>`);
    legendItems.push(`<div style="display:flex;align-items:center;gap:4px">
      <div style="width:10px;height:10px;background:#F59E0B !important;border:1px solid #D97706;transform:rotate(45deg);flex-shrink:0;margin:1px 2px"></div>
      <span style="font-size:9px;color:#374151">Milestone</span>
    </div>`);
    legendItems.push(`<div style="display:flex;align-items:center;gap:4px">
      <div style="width:10px;height:10px;border-radius:50%;background:#ef4444 !important;border:1px solid #b91c1c;flex-shrink:0;margin:1px 2px"></div>
      <span style="font-size:9px;color:#374151">Constraint</span>
    </div>`);
    if (championBadge) {
      legendItems.push(`<div style="display:flex;align-items:center;gap:4px">
        <div style="width:10px;height:10px;border-radius:50%;background:#1A3560 !important;border:1px solid white;flex-shrink:0;margin:1px 2px"></div>
        <span style="font-size:9px;color:#374151">Champion (initials)</span>
      </div>`);
    }
    if (holidaySet.size > 0) {
      legendItems.push(`<div style="display:flex;align-items:center;gap:4px">
        <div style="width:12px;height:12px;background:#fee2e2 !important;border:1px solid #fecaca;flex-shrink:0"></div>
        <span style="font-size:9px;color:#374151">Statutory Holiday</span>
      </div>`);
    }
    const legendHTML = legendItems.join(`<span style="color:#d1d5db;margin:0 4px">·</span>`);

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const printDate = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

    const html = `<!DOCTYPE html>
<html><head>
<title>Anmore Operations Yard — ${printTitle}</title>
<style>
  @page {
    size: A3 landscape;
    margin: 0 0 8mm 0;
    @bottom-right {
      content: "Page " counter(page) " of " counter(pages);
      font-family: system-ui, sans-serif;
      font-size: 8pt;
      color: #6b7280;
      padding-right: 8mm;
    }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: system-ui, -apple-system, sans-serif; background: white; display: flex; flex-direction: column; min-height: 100vh; }
  table { border-collapse: collapse; }
  td { border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
  .page-header { background: #1A3560 !important; padding: 10px 16px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .page-footer {
    position: fixed;
    bottom: 0; left: 0; right: 0;
    border-top: 1px solid #e2e8f0;
    padding: 6px 16px;
    display: flex; align-items: center; gap: 16px;
    background: #fff !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* visible, not hidden: R is sized to fit, but if a schedule is long enough to
     beat the minimum row height it must spill onto a second sheet rather than
     have its last rows quietly disappear. */
  .content { flex: 1; padding: 8px; padding-bottom: 60px; overflow: visible; }
  tr { break-inside: avoid; page-break-inside: avoid; }
</style>
</head><body>

<!-- ── HEADER ── -->
<div class="page-header" style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center">
  <div style="display:flex;align-items:center;gap:10px">
    <img src="${origin}/logo-jv.png" style="width:44px;height:44px;object-fit:contain" />
    <span style="font-size:13px;font-weight:700;color:white;letter-spacing:0.02em">Anmore Operations Yard</span>
  </div>
  <div style="text-align:center">
    <span style="font-size:17px;font-weight:800;color:white;letter-spacing:0.06em;text-transform:uppercase">${printTitle}</span>
  </div>
  <div style="text-align:right;color:#bfdbfe;font-size:10px;font-weight:500"><span style="color:#93c5fd">Date:</span> ${printDate}</div>
</div>

<!-- ── SCHEDULE GRID ── -->
<div class="content">
  <div style="display:flex;border:1px solid #cbd5e1;border-radius:4px;min-height:100%">
    <!-- Left: task table -->
    <div style="flex-shrink:0;border-right:2px solid #1A3560">
      <table>
        <thead>
          <tr style="height:${HEAD}px;background:#1A3560;color:white">
            ${pCols.map(c => `<td style="padding:0 4px;font-size:9px;width:${c.w}px;${c.center ? "text-align:center;" : ""}">${c.label}</td>`).join("")}
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <!-- Right: Gantt chart -->
    <div style="position:relative;overflow:hidden;flex:1">
      <div style="position:relative;height:${HEAD}px;background:#f8fafc;border-bottom:2px solid #1A3560">${monthHeader}${subHeader}</div>
      <svg width="${chartW}" height="${chartH}" style="display:block">${bgSVG}${barsSVG}${arrowsSVG}</svg>
    </div>
  </div>
</div>

${hideLegendOnPrint ? "" : `<!-- ── LEGEND ── -->
<div style="padding:5px 10px;display:flex;align-items:center;flex-wrap:wrap;gap:6px;border-top:1px solid #e2e8f0;background:#f8fafc">
  <span style="font-size:8px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin-right:4px">Legend</span>
  ${legendHTML}
</div>`}

${!lookaheadStyle ? "" : `<!-- ── READINESS KEY ──
     Prints even when hideLegendOnPrint is set: the dots are the point of the
     redesign and an unexplained colour on a handout is worse than no colour. -->
<div style="padding:4px 10px;display:flex;align-items:center;flex-wrap:wrap;gap:9px;border-top:1px solid #e2e8f0;background:#f8fafc">
  <span style="font-size:8px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em">Readiness</span>
  ${(["ready", "progress", "unowned", "late", "blocked", "done", "na"] as const).map(k => {
    const m = READY_META[k];
    return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:7.5px;color:#475569">
      <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${m.color}"></span>${m.label}</span>`;
  }).join("")}
  <span style="font-size:7px;color:#9ca3af;font-style:italic;margin-left:auto">“Ready” means owned, dated and not overdue — it does not confirm materials or approvals.</span>
</div>`}

<!-- ── FOOTER ── -->
<div class="page-footer">
  <div style="display:flex;align-items:center;gap:12px;flex-shrink:0">
    <img src="${origin}/logo-jb.png"     style="height:26px;object-fit:contain;opacity:0.9" />
    <span style="color:#d1d5db;font-size:14px">·</span>
    <img src="${origin}/logo-anmore.png" style="height:26px;object-fit:contain;opacity:0.9" />
    <span style="color:#d1d5db;font-size:14px">·</span>
    <img src="${origin}/logo-isl.webp"   style="height:26px;object-fit:contain;opacity:0.9" />
  </div>
  <span style="font-size:9px;color:#6b7280;flex-shrink:0">Anmore Operations Yard — Jacob Bros Construction, Village of Anmore &amp; ISL Engineering</span>
  <span style="flex:1"></span>
  <span style="font-size:8px;color:#9ca3af;text-align:right;max-width:280px;line-height:1.4;font-style:italic">Note: This schedule was prepared with the information at the time of print and is subject to revision as warranted.</span>
</div>

<script>window.onload=function(){window.print();}<\/script>
</body></html>`;

    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3 select-none">
      {error && (
        <div className="flex items-center gap-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-700">✕</button>
        </div>
      )}
      {saving && <p className="text-xs text-zinc-400 animate-pulse">Saving…</p>}

      {/* ── SUMMARY TILES ──
          The at-a-glance layer before the detail. Counts only leaf activities;
          summary rows and milestones aren't work anyone can be ready for. */}
      {lookaheadStyle && (() => {
        const parentIds = new Set(tasks.filter(t => t.parent_id).map(t => t.parent_id as string));
        const leaves = tasks.filter(t => !parentIds.has(t.id) && !t.is_milestone);
        const by = (r: Ready) => leaves.filter(t => readinessOf(t, false) === r).length;
        const tiles: { v: number; label: string; accent: string; tone: string }[] = [
          { v: leaves.length, label: "Activities", accent: "border-t-[#2E6EA6]", tone: "text-[#1A3560]" },
          { v: by("ready") + by("progress"), label: "Ready to run", accent: "border-t-green-600", tone: "text-green-700" },
          { v: by("unowned"), label: "Nobody assigned", accent: "border-t-amber-500", tone: "text-amber-600" },
          { v: by("blocked") + by("late"), label: "Blocked or late", accent: "border-t-red-600", tone: "text-red-600" },
        ];
        return (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map(t => (
              <div key={t.label} className={`rounded-lg border-t-2 bg-white px-3 py-2 shadow-sm ${t.accent}`}>
                <div className={`text-xl font-bold leading-none tabular-nums ${t.tone}`}>{t.v}</div>
                <div className="mt-1 text-[10px] uppercase tracking-wider text-zinc-400">{t.label}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── MAIN GRID ── */}
      <div
        ref={scrollBoxRef}
        className={`relative ${fixedDays ? "overflow-x-hidden" : "overflow-x-auto"} overflow-y-auto rounded-xl bg-white ${
          // Fluent-style: depth carries the hierarchy, not a hard outline.
          lookaheadStyle ? "shadow-sm ring-1 ring-zinc-200" : "border border-zinc-300"
        }`}
        style={{ maxHeight: "70vh" }}
        onPointerMove={e => {
          if (resizingRef.current) {
            const delta = e.clientX - resizeStartX.current;
            setLeftW(Math.max(MIN_LEFT_W, resizeStartW.current + delta));
          } else {
            onMove(e);
          }
        }}
        onPointerUp={e => {
          if (resizingRef.current) {
            resizingRef.current = false;
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
          } else {
            onUp();
          }
        }}
      >
        <div className="relative" style={{ width: leftW + chartW }}>

          {/* ── HEADER ── */}
          <div className="sticky top-0 z-20 flex border-b-2 border-zinc-300">
            <div className="sticky left-0 z-30 flex shrink-0 border-r-2 border-zinc-300 bg-[#1A3560] overflow-hidden" style={{ width: leftW }}>
              <div style={{ width: COL.toggle }} />
              {lookaheadStyle && <H w={COL.ready} center title="Readiness — see legend">●</H>}
              {!lookaheadStyle && <H w={COL.wbs}>#</H>}
              <H w={COL.name}>{lookaheadStyle ? "Activity" : "Task Name"}</H>
              <H w={COL.dur} center>Days</H>
              <H w={COL.start} center>Start</H>
              <H w={COL.end} center>Finish</H>
              {!lookaheadStyle && <H w={COL.pred} center>Pred.</H>}
              {!lookaheadStyle && <H w={COL.lag} center title="Lag days (negative = overlap)">Lag</H>}
              {lookaheadStyle && <H w={COL.who} title="Champion, then support">Who</H>}
              {!lookaheadStyle && !hideChampionCol && <H w={COL.champ}>Champion</H>}
              {!lookaheadStyle && !hideSupportCol && <H w={COL.supp}>Support</H>}
              {!lookaheadStyle && <H w={COL.sat} center title="Saturday is a working day">Sat</H>}
              {!lookaheadStyle && <H w={COL.sun} center title="Sunday is a working day">Sun</H>}
              <H w={COL.sub}>{lookaheadStyle ? "Trade" : "Role/Trade"}</H>
              {!hideCrewCol && <H w={COL.crew} center>Crew</H>}
              {!hideDtcCol && <H w={COL.dtc} center title="Working days remaining to end date">DTC</H>}
              <H w={COL.act} center />
            </div>
            {/* ── DRAG HANDLE ── (sticky so it stays put on horizontal scroll — only moves when dragged) */}
            <div
              className="sticky z-40 shrink-0 cursor-col-resize bg-zinc-400 hover:bg-[#2E6EA6] active:bg-[#2E6EA6] transition-colors self-stretch"
              style={{ width: 8, left: leftW, marginRight: -8 }}
              title="Drag to resize"
              onPointerDown={e => {
                resizingRef.current = true;
                resizeStartX.current = e.clientX;
                resizeStartW.current = leftW;
                e.currentTarget.setPointerCapture(e.pointerId);
                e.preventDefault();
              }}
              onPointerMove={e => {
                if (!resizingRef.current) return;
                const delta = e.clientX - resizeStartX.current;
                setLeftW(Math.max(MIN_LEFT_W, resizeStartW.current + delta));
              }}
              onPointerUp={e => {
                if (!resizingRef.current) return;
                resizingRef.current = false;
                e.currentTarget.releasePointerCapture(e.pointerId);
              }}
            />
            <div className="flex flex-col bg-zinc-50 shrink-0" style={{ width: chartW }}>
              <div className="relative h-6 border-b border-zinc-200">
                {(lookaheadStyle ? weekBands : monthLabels).map(b => {
                  const isWeek = "week" in b;
                  return (
                    <div key={isWeek ? b.monday : `${b.offset}${(b as { label: string }).label}`}
                      className="absolute top-0 h-6 flex items-center justify-center gap-1.5 border-l-2 border-zinc-300 overflow-hidden"
                      style={{ left: b.offset * DAY_W, width: b.count * DAY_W }}>
                      {isWeek ? (
                        <>
                          <span className="px-1 font-mono text-[10px] font-bold tracking-wider text-[#1A3560]">
                            WK {b.week}
                          </span>
                          {b.count > 4 && (
                            <span className="font-mono text-[9px] text-zinc-400">{formatShortDate(b.monday)}</span>
                          )}
                        </>
                      ) : (
                        <span className="truncate px-1 text-[11px] font-semibold text-[#1A3560]">
                          {(b as { label: string }).label}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex">
                {showMonthsOnly ? (
                  days.map(d => (
                    <div key={d.date} style={{ width: DAY_W }}
                      className={`shrink-0 h-3 ${d.isMonthStart ? "border-l-2 border-zinc-300" : ""} ${holidaySet.has(d.date) ? "bg-red-100" : d.isWeekend ? "bg-zinc-100" : ""}`} />
                  ))
                ) : showWeeks ? (
                  weekLabels.map(w => (
                    <div key={`${w.offset}${w.label}`} style={{ width: w.count * DAY_W }}
                      className="flex shrink-0 h-7 items-center justify-center border-r border-zinc-200 text-[10px] font-medium text-zinc-500 truncate px-0.5">
                      {w.label}
                    </div>
                  ))
                ) : (
                  days.map(d => (
                    <div key={d.date} style={{ width: DAY_W }}
                      className={`flex shrink-0 h-7 items-center justify-center text-[10px] font-medium
                        ${d.isMonthStart ? "border-l-2 border-zinc-300" : "border-r border-zinc-100"}
                        ${holidaySet.has(d.date) ? "bg-red-100 text-red-500" : d.isToday ? "bg-blue-100 text-blue-700" : d.isWeekend ? "bg-zinc-100 text-zinc-400" : "text-zinc-500"}`}>
                      {d.label}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* ── ROWS ── */}
          {!rowsFlat.length ? (
            <div className="flex items-center justify-center py-16 text-sm text-zinc-400">
              No tasks yet — click <strong className="mx-1">+ Add Task</strong> below.
            </div>
          ) : rowsFlat.map(task => {
            const wbs      = wbsMap.get(task.id) ?? "";
            const lvl      = depth(task, taskMap);
            const hasKids  = !!(cm.get(task.id) ?? []).length;
            const isOpen   = expanded.has(task.id);
            const isCon    = task.is_constraint ?? false;
            const isMile   = (task.is_milestone ?? false) && !isCon;
            const workSat  = task.work_sat ?? false;
            const workSun  = task.work_sun ?? false;
            const wDur     = isMile || isCon ? 0 : countWorkingDays(task.start_date, task.end_date, workSat, workSun, holidaySet);
            const taskDeps  = predsOf.get(task.id) ?? [];
            const predLbl  = taskDeps.map(d => wbsMap.get(d.predecessor_id)).filter(Boolean).join(", ");
            const lagVal   = taskDeps.length ? taskDeps[0].lag_days : 0;
            // In fixed-range mode, clip bars at the window edges (a bar poking
            // past the right edge would otherwise widen the scroll area and
            // re-introduce horizontal scrolling).
            const rawLeft  = dayOff(task.start_date) * DAY_W;
            const calDur   = diffInDays(task.start_date, task.end_date) + 1;
            const rawBarW  = Math.max(calDur * DAY_W, 6);
            const left     = fixedDays ? Math.max(0, rawLeft) : rawLeft;
            const barW     = fixedDays
              ? Math.min(chartW, rawLeft + rawBarW) - left
              : rawBarW;
            const inWindow = !fixedDays || barW > 0;
            const isET     = edit?.taskId === task.id && edit.field === "title";
            const isEP     = edit?.taskId === task.id && edit.field === "pred";
            const isEL     = edit?.taskId === task.id && edit.field === "lag";
            const isED     = edit?.taskId === task.id && edit.field === "dur";
            const isES     = edit?.taskId === task.id && edit.field === "start";
            const isEE     = edit?.taskId === task.id && edit.field === "end";
            const isECrew  = edit?.taskId === task.id && edit.field === "crew";
            const today    = todayISO();
            const dtc      = isMile ? null : (task.end_date >= today ? countWorkingDays(today, task.end_date, workSat, workSun, holidaySet) : 0);
            const champProfile = task.champion_id ? memberMap.get(task.champion_id) : undefined;
            const suppIds  = supportOf.get(task.id) ?? [];
            const roleColor = task.role_id ? (roles.find(r => r.id === task.role_id)?.color ?? "#94A3B8") : "#94A3B8";
            const barColor = hasKids ? "#1A3560" : roleColor;
            const availableForSupport = members.filter(m => m.id !== task.champion_id && !suppIds.includes(m.id));
            const rowBg    = isCon ? CONSTRAINT_BG : isMile ? MILESTONE_BG : LEVEL_BG[Math.min(lvl, LEVEL_BG.length - 1)];

            const band = bandBefore.get(task.id);

            return (
              <Fragment key={task.id}>

              {/* ── WEEK BAND ──
                  Groups the six-week window the way the meeting runs. The left
                  half is sticky so the week number stays put while the chart
                  scrolls under it. */}
              {band && (
                <div className="flex border-y border-zinc-200 bg-[#eef2f7]" style={{ height: 26 }}>
                  <div
                    className="sticky left-0 z-20 flex shrink-0 items-center gap-2.5 border-r border-zinc-200 bg-[#eef2f7] px-3"
                    style={{ width: leftW }}>
                    <span className="font-mono text-[10px] font-bold tracking-[0.12em] text-[#1A3560]">
                      WEEK {band.week}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-500">
                      {formatShortDate(band.monday)} – {formatShortDate(addDays(band.monday, 6))}
                    </span>
                    <span className="ml-auto truncate font-mono text-[10px] text-zinc-400">
                      {band.total} {band.total === 1 ? "activity" : "activities"}
                      {band.constraints > 0 && (
                        <span className="font-bold text-red-600"> · {band.constraints} constraint{band.constraints === 1 ? "" : "s"}</span>
                      )}
                    </span>
                  </div>
                  <div className="shrink-0 bg-[#eef2f7]" style={{ width: chartW }} />
                </div>
              )}

              <div
                className={`group flex border-b border-zinc-100 ${rowOverId === task.id ? "border-t-2 border-t-[#2E6EA6]" : ""} ${rowDragId === task.id ? "opacity-40" : ""}`}
                style={{ height: ROW_H }}
                onDragOver={e => { if (!readOnly && rowDragId) { e.preventDefault(); setRowOverId(task.id); } }}
                onDrop={e => { e.preventDefault(); if (rowDragId) { reorderRow(rowDragId, task.id); setRowDragId(null); setRowOverId(null); } }}>

                {/* ── LEFT PANEL ── */}
                <div
                  className="sticky left-0 z-20 flex shrink-0 items-center border-r border-zinc-200 overflow-hidden"
                  style={{ width: leftW, backgroundColor: rowBg }}>

                  {/* Toggle / drag grip */}
                  <div
                    className="flex shrink-0 items-center justify-center gap-0.5 text-zinc-400 hover:text-zinc-700"
                    style={{ width: COL.toggle }}>
                    {!readOnly && (
                      <span
                        draggable
                        className="cursor-grab active:cursor-grabbing text-zinc-300 hover:text-zinc-600 opacity-0 group-hover:opacity-100 text-[13px] leading-none"
                        title="Drag to reorder"
                        onDragStart={e => { e.dataTransfer.effectAllowed = "move"; setRowDragId(task.id); }}
                        onDragEnd={() => { setRowDragId(null); setRowOverId(null); }}>
                        ⠿
                      </span>
                    )}
                    {hasKids && (
                      <span className="cursor-pointer text-[11px]" onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(task.id) ? n.delete(task.id) : n.add(task.id); return n; })}>
                        {isOpen ? "▾" : "▸"}
                      </span>
                    )}
                  </div>

                  {/* Readiness */}
                  {lookaheadStyle && (() => {
                    const r = readinessOf(task, hasKids);
                    const m = READY_META[r];
                    return (
                      <div className="shrink-0 flex items-center justify-center" style={{ width: COL.ready }}>
                        <span
                          className="block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: m.color }}
                          title={m.label}
                        />
                      </div>
                    );
                  })()}

                  {/* WBS */}
                  {!lookaheadStyle && (
                    <div className="shrink-0 text-[11px] text-zinc-400 font-mono px-1 overflow-hidden truncate" style={{ width: COL.wbs }}>{wbs}</div>
                  )}

                  {/* Name */}
                  <div className="shrink-0 flex items-center overflow-hidden pr-1" style={{ width: COL.name, paddingLeft: 8 + lvl * 14 }}>
                    {isET ? (
                      <input autoFocus className="w-full rounded border border-[#2E6EA6] px-1 text-xs outline-none"
                        value={edit.value}
                        onChange={e => setEdit({ ...edit, value: e.target.value })}
                        onBlur={() => { saveTitle(task.id, edit.value); setEdit(null); }}
                        onKeyDown={e => { if (e.key === "Enter") { saveTitle(task.id, edit.value); setEdit(null); } if (e.key === "Escape") setEdit(null); }} />
                    ) : (
                      <span
                        className={`truncate text-xs cursor-text ${hasKids ? "font-semibold text-zinc-800" : "text-zinc-700"}`}
                        onDoubleClick={() => !readOnly && setEdit({ taskId: task.id, field: "title", value: task.title })}
                        title={task.title}>
                        {task.title}
                      </span>
                    )}
                  </div>

                  {/* Duration */}
                  <div className="shrink-0 flex items-center justify-center" style={{ width: COL.dur }}>
                    {isED ? (
                      <input autoFocus type="number" min="0"
                        className="w-full rounded border border-[#2E6EA6] px-1 text-xs outline-none text-center"
                        value={edit.value}
                        onChange={e => setEdit({ ...edit, value: e.target.value })}
                        onBlur={() => { saveDuration(task.id, edit.value); setEdit(null); }}
                        onKeyDown={e => { if (e.key === "Enter") { saveDuration(task.id, edit.value); setEdit(null); } if (e.key === "Escape") setEdit(null); }} />
                    ) : (
                      <span
                        className={`text-[11px] cursor-text px-1 ${isCon ? "text-red-600 font-semibold" : isMile ? "text-amber-600 font-semibold" : "text-zinc-500"}`}
                        onDoubleClick={() => !readOnly && !hasKids && setEdit({ taskId: task.id, field: "dur", value: String(wDur) })}
                        title={isCon ? "Constraint" : hasKids ? "Summary — auto-computed from sub-tasks" : "Double-click to edit working days"}>
                        {isCon ? "C" : isMile ? "M" : `${wDur}d`}
                      </span>
                    )}
                  </div>

                  {/* Start */}
                  <div className="shrink-0 flex items-center justify-center" style={{ width: COL.start }}>
                    {isES ? (
                      <input autoFocus type="date"
                        className="w-full rounded border border-[#2E6EA6] px-1 text-[10px] outline-none"
                        value={edit.value}
                        onChange={e => setEdit({ ...edit, value: e.target.value })}
                        onBlur={() => { saveStartDate(task.id, edit.value); setEdit(null); }}
                        onKeyDown={e => { if (e.key === "Enter") { saveStartDate(task.id, edit.value); setEdit(null); } if (e.key === "Escape") setEdit(null); }} />
                    ) : (
                      <span
                        className="text-[11px] text-zinc-500 tabular-nums cursor-text hover:text-[#2E6EA6]"
                        onDoubleClick={() => !readOnly && !hasKids && setEdit({ taskId: task.id, field: "start", value: task.start_date })}
                        title={hasKids ? "Auto-computed from sub-tasks" : "Double-click to edit start date"}>
                        {task.start_date}
                      </span>
                    )}
                  </div>

                  {/* End */}
                  <div className="shrink-0 flex items-center justify-center" style={{ width: COL.end }}>
                    {isEE ? (
                      <input autoFocus type="date"
                        className="w-full rounded border border-[#2E6EA6] px-1 text-[10px] outline-none"
                        value={edit.value}
                        onChange={e => setEdit({ ...edit, value: e.target.value })}
                        onBlur={() => { saveEndDate(task.id, edit.value); setEdit(null); }}
                        onKeyDown={e => { if (e.key === "Enter") { saveEndDate(task.id, edit.value); setEdit(null); } if (e.key === "Escape") setEdit(null); }} />
                    ) : (
                      <span
                        className="text-[11px] text-zinc-500 tabular-nums cursor-text hover:text-[#2E6EA6]"
                        onDoubleClick={() => !readOnly && !hasKids && setEdit({ taskId: task.id, field: "end", value: task.end_date })}
                        title={hasKids ? "Auto-computed from sub-tasks" : "Double-click to edit end date"}>
                        {task.end_date}
                      </span>
                    )}
                  </div>

                  {/* Who — champion first, then support. Replaces the two text
                      columns in lookahead style; names live in the tooltip. */}
                  {lookaheadStyle && (() => {
                    const champ = task.champion_id ? memberMap.get(task.champion_id) : undefined;
                    const supps = suppIds.map(id => memberMap.get(id)).filter((p): p is Profile => !!p);
                    const shown = [...(champ ? [champ] : []), ...supps];
                    const names = [
                      ...(champ ? [`${champ.full_name || champ.email} (champion)`] : []),
                      ...supps.map(p => p.full_name || p.email),
                    ];
                    return (
                      <div
                        className="shrink-0 flex items-center px-1.5"
                        style={{ width: COL.who }}
                        title={names.length ? names.join("\n") : "Nobody assigned"}>
                        {shown.length === 0 ? (
                          <span className="text-[11px] text-amber-600">Unassigned</span>
                        ) : (
                          <span className="flex items-center">
                            {shown.slice(0, 3).map((p, i) => (
                              <span
                                key={p.id}
                                className="grid h-[19px] w-[19px] place-items-center rounded-full border-[1.5px] border-white text-[8px] font-bold text-white"
                                style={{
                                  backgroundColor: champColorMap.get(p.id) ?? "#94A3B8",
                                  marginLeft: i === 0 ? 0 : -5,
                                }}>
                                {initials(p)}
                              </span>
                            ))}
                            {shown.length > 3 && (
                              <span className="ml-1.5 font-mono text-[9px] text-zinc-400">+{shown.length - 3}</span>
                            )}
                          </span>
                        )}
                      </div>
                    );
                  })()}

                  {/* Predecessors */}
                  {!lookaheadStyle && (
                  <div className="shrink-0 flex items-center justify-center" style={{ width: COL.pred }}>
                    {isEP ? (
                      <input autoFocus className="w-full rounded border border-[#2E6EA6] px-1 text-xs outline-none"
                        value={edit.value} placeholder="e.g. 1, 2.1"
                        onChange={e => setEdit({ ...edit, value: e.target.value })}
                        onBlur={() => { savePredecessors(task.id, edit.value); setEdit(null); }}
                        onKeyDown={e => { if (e.key === "Enter") { savePredecessors(task.id, edit.value); setEdit(null); } if (e.key === "Escape") setEdit(null); }} />
                    ) : (
                      <span
                        className="text-[11px] text-zinc-500 cursor-text px-1 w-full text-center"
                        onDoubleClick={() => !readOnly && setEdit({ taskId: task.id, field: "pred", value: predLbl })}
                        title="Double-click to set predecessors">
                        {predLbl || <span className="text-zinc-300">—</span>}
                      </span>
                    )}
                  </div>
                  )}

                  {/* Lag */}
                  {!lookaheadStyle && (
                  <div className="shrink-0 flex items-center justify-center" style={{ width: COL.lag }}>
                    {isEL ? (
                      <input autoFocus type="number"
                        className="w-full rounded border border-[#2E6EA6] px-1 text-xs outline-none text-center"
                        value={edit.value}
                        onChange={e => setEdit({ ...edit, value: e.target.value })}
                        onBlur={() => { saveLag(task.id, edit.value); setEdit(null); }}
                        onKeyDown={e => { if (e.key === "Enter") { saveLag(task.id, edit.value); setEdit(null); } if (e.key === "Escape") setEdit(null); }} />
                    ) : (
                      <span
                        className={`text-[11px] cursor-text px-1 w-full text-center ${taskDeps.length ? (lagVal !== 0 ? "text-amber-600 font-medium" : "text-zinc-400") : "text-zinc-200"}`}
                        onDoubleClick={() => !readOnly && taskDeps.length > 0 && setEdit({ taskId: task.id, field: "lag", value: String(lagVal) })}
                        title={taskDeps.length ? "Double-click to edit lag days (negative = overlap)" : "Set a predecessor first"}>
                        {taskDeps.length ? (lagVal === 0 ? "0" : `${lagVal > 0 ? "+" : ""}${lagVal}`) : "—"}
                      </span>
                    )}
                  </div>
                  )}

                  {/* Champion — hidden for summary tasks */}
                  {!lookaheadStyle && !hideChampionCol && (
                  <div className="shrink-0 flex items-center px-1" style={{ width: COL.champ }}>
                    {hasKids ? (
                      <span className="text-[11px] text-zinc-300">—</span>
                    ) : readOnly ? (
                      <span className="text-[11px] text-zinc-600 truncate">
                        {champProfile ? (champProfile.full_name || champProfile.email) : <span className="text-zinc-300">—</span>}
                      </span>
                    ) : (
                      <MemberSearch
                        members={members}
                        placeholder="Type to assign…"
                        currentName={champProfile ? (champProfile.full_name || champProfile.email) : ""}
                        onSelect={m => saveChampion(task.id, m.id)}
                        onClear={() => saveChampion(task.id, null)}
                      />
                    )}
                  </div>
                  )}

                  {/* Support — hidden for summary tasks */}
                  {!lookaheadStyle && !hideSupportCol && (
                  <div className="shrink-0 flex items-center gap-1 px-1 overflow-hidden" style={{ width: COL.supp }}>
                    {!hasKids && suppIds.slice(0, 3).map(uid => {
                      const p = memberMap.get(uid);
                      const color = champColorMap.get(uid) ?? "#94A3B8";
                      return p ? (
                        <button key={uid}
                          className="flex items-center justify-center rounded-full text-white text-[9px] font-bold shrink-0 hover:opacity-70 transition-opacity"
                          style={{ width: 20, height: 20, backgroundColor: color }}
                          title={`${p.full_name || p.email} — click to remove`}
                          onMouseDown={e => { e.preventDefault(); !readOnly && removeSupport(task.id, uid); }}>
                          {initials(p)}
                        </button>
                      ) : null;
                    })}
                    {!hasKids && suppIds.length > 3 && <span className="text-[10px] text-zinc-400 shrink-0">+{suppIds.length - 3}</span>}
                    {!hasKids && !readOnly && availableForSupport.length > 0 && (
                      <div className="flex-1 min-w-0">
                        <MemberSearch
                          members={availableForSupport}
                          placeholder="+ Add…"
                          onSelect={m => { addSupport(task.id, m.id); }}
                        />
                      </div>
                    )}
                    {hasKids && <span className="text-[11px] text-zinc-300">—</span>}
                  </div>
                  )}

                  {/* Sat / Sun checkboxes — replaced by weekend shading on the bar
                      in lookahead style, so both collapse together. */}
                  {!lookaheadStyle && (<>
                  <div className="shrink-0 flex items-center justify-center" style={{ width: COL.sat }}>
                    <input type="checkbox"
                      checked={workSat}
                      disabled={readOnly || hasKids}
                      onChange={e => saveWorkDay(task.id, "work_sat", e.target.checked)}
                      className="cursor-pointer accent-[#2A6B35]"
                      title="Saturday counts as a working day for this task" />
                  </div>

                  {/* Sun checkbox */}
                  <div className="shrink-0 flex items-center justify-center" style={{ width: COL.sun }}>
                    <input type="checkbox"
                      checked={workSun}
                      disabled={readOnly || hasKids}
                      onChange={e => saveWorkDay(task.id, "work_sun", e.target.checked)}
                      className="cursor-pointer accent-[#2A6B35]"
                      title="Sunday counts as a working day for this task" />
                  </div>
                  </>)}

                  {/* Role/Trade (from the Pull Plan roles list) */}
                  <div className="shrink-0 flex items-center px-1 overflow-hidden" style={{ width: COL.sub }}>
                    {hasKids ? <span className="text-[11px] text-zinc-300">—</span> : readOnly ? (
                      (() => {
                        const r = roles.find(x => x.id === task.role_id);
                        return r ? (
                          <span className="flex items-center gap-1 text-[11px] text-zinc-600 truncate">
                            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: r.color }} />
                            {r.name}
                          </span>
                        ) : <span className="text-[11px] text-zinc-300">—</span>;
                      })()
                    ) : (
                      <select
                        className="w-full rounded border border-transparent bg-transparent px-0.5 py-0.5 text-[11px] text-zinc-600 outline-none hover:border-zinc-300 focus:border-[#2E6EA6]"
                        value={task.role_id ?? ""}
                        onChange={e => saveRole(task.id, e.target.value)}>
                        <option value="">—</option>
                        {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    )}
                  </div>

                  {/* Crew */}
                  {!hideCrewCol && (
                  <div className="shrink-0 flex items-center justify-center px-1" style={{ width: COL.crew }}>
                    {hasKids ? <span className="text-[11px] text-zinc-300">—</span> : isECrew ? (
                      <input autoFocus type="number" min="0" className="w-full rounded border border-[#2E6EA6] px-1 py-0.5 text-[11px] outline-none text-center" value={edit!.value}
                        onChange={e => setEdit(prev => prev ? { ...prev, value: e.target.value } : prev)}
                        onBlur={() => { saveCrew(task.id, edit!.value); setEdit(null); }}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") { if (e.key === "Enter") saveCrew(task.id, edit!.value); setEdit(null); } }} />
                    ) : (
                      <span className={`text-[11px] ${readOnly ? "text-zinc-600" : "cursor-pointer hover:text-[#2E6EA6]"}`}
                        onClick={() => !readOnly && !hasKids && setEdit({ taskId: task.id, field: "crew", value: task.crew_size?.toString() ?? "" })}>
                        {task.crew_size ?? <span className="text-zinc-300">—</span>}
                      </span>
                    )}
                  </div>
                  )}

                  {/* Days to Completion */}
                  {!hideDtcCol && (
                  <div className="shrink-0 flex items-center justify-center px-1" style={{ width: COL.dtc }}>
                    {dtc === null ? <span className="text-[11px] text-zinc-300">—</span>
                      : dtc === 0 ? <span className="text-[11px] text-red-500 font-semibold">0</span>
                      : dtc <= 5 ? <span className="text-[11px] text-amber-600 font-semibold">{dtc}</span>
                      : <span className="text-[11px] text-zinc-600">{dtc}</span>}
                  </div>
                  )}

                  {/* Actions */}
                  <div className="shrink-0 flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity" style={{ width: COL.act }}>
                    {!readOnly && (
                      <>
                        {lvl > 0 && <button onClick={() => outdentTask(task.id)} className="text-zinc-400 hover:text-zinc-700 text-[13px] px-1 py-0.5" title="Outdent (promote to the parent level)">←</button>}
                        <button onClick={() => indentTask(task.id)} className="text-zinc-400 hover:text-zinc-700 text-[13px] px-1 py-0.5" title="Indent (make a child of the task above)">→</button>
                        <button onClick={() => deleteTask(task.id)} className="text-red-400 hover:text-red-600 text-[13px] px-1 py-0.5" title="Delete">✕</button>
                      </>
                    )}
                  </div>
                </div>

                {/* ── GANTT BARS ── */}
                <div className="relative shrink-0" style={{ width: chartW }}>
                  {/* Background columns */}
                  <div className="absolute inset-0 flex pointer-events-none">
                    {days.map(d => (
                      <div key={d.date} style={{ width: DAY_W, height: ROW_H }}
                        className={[
                          d.isMonthStart ? "border-l-2 border-zinc-200" : "",
                          holidaySet.has(d.date) ? "bg-red-50" :
                          d.isWeekend ? "bg-zinc-50" :
                          d.isToday ? "bg-blue-50/30" : "",
                        ].join(" ")} />
                    ))}
                  </div>

                  {/* Today line */}
                  {(() => { const off = dayOff(todayISO()); return off >= 0 && off <= totalDays ? (
                    <div className="absolute top-0 bottom-0 w-px bg-red-400/50 pointer-events-none z-0" style={{ left: off * DAY_W }} />
                  ) : null; })()}

                  {/* Constraint circle */}
                  {isCon && inWindow && (
                    <div
                      className="absolute pointer-events-none z-0 rounded-full"
                      style={{
                        left: left + DAY_W / 2 - 9,
                        top: ROW_H / 2 - 9,
                        width: 18, height: 18,
                        backgroundColor: "#ef4444",
                        border: "2px solid #b91c1c",
                      }}
                    />
                  )}

                  {/* Milestone diamond */}
                  {isMile && inWindow && (
                    <div
                      className="absolute pointer-events-none z-0"
                      style={{
                        left: left + DAY_W / 2 - 9,
                        top: ROW_H / 2 - 9,
                        width: 18, height: 18,
                        transform: "rotate(45deg)",
                        backgroundColor: "#F59E0B",
                        border: "2px solid #D97706",
                      }}
                    />
                  )}

                  {/* Regular / summary bar */}
                  {!isMile && !isCon && inWindow && (
                    <div
                      className={`group/bar absolute top-1/2 -translate-y-1/2 flex items-center overflow-hidden shadow-sm
                        ${hasKids ? "" : "rounded"}
                        ${readOnly || hasKids ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
                      style={{ left, width: barW, height: hasKids ? 10 : 22, backgroundColor: barColor }}
                      onPointerDown={e => !hasKids && onDown(e, task, "move")}
                      title={`${task.title} · ${task.start_date} → ${task.end_date} · ${wDur}d working${champProfile ? ` · Champion: ${champProfile.full_name || champProfile.email}` : ""}`}
                    >
                      {!readOnly && !hasKids && (
                        <>
                          <div className="absolute left-0 top-0 h-full w-2 bg-black/20 opacity-0 group-hover/bar:opacity-100 cursor-ew-resize" onPointerDown={e => onDown(e, task, "resize-start")} />
                          <div className="absolute right-0 top-0 h-full w-2 bg-black/20 opacity-0 group-hover/bar:opacity-100 cursor-ew-resize" onPointerDown={e => onDown(e, task, "resize-end")} />
                        </>
                      )}
                      {!hasKids && barW > 40 && <span className="px-2 text-[10px] text-white/90 truncate">{task.title}</span>}
                    </div>
                  )}

                  {/* Champion initials badge (Lookahead) */}
                  {championBadge && !hasKids && !isMile && !isCon && inWindow && champProfile && (
                    <div
                      className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center rounded-full border-2 border-white text-[8px] font-bold text-white shadow z-10"
                      style={{ left: left + barW - 9, width: 18, height: 18, backgroundColor: champColorMap.get(task.champion_id!) ?? "#1A3560" }}
                      title={`Champion: ${champProfile.full_name || champProfile.email}`}>
                      {initials(champProfile)}
                    </div>
                  )}

                  {/* Summary end caps */}
                  {hasKids && !isMile && inWindow && (
                    <>
                      <div className="absolute top-1/2 -translate-y-1/2 w-2 h-3" style={{ left, backgroundColor: "#1A3560", clipPath: "polygon(0 0,100% 0,0 100%)" }} />
                      <div className="absolute top-1/2 -translate-y-1/2 w-2 h-3" style={{ left: left + barW - 8, backgroundColor: "#1A3560", clipPath: "polygon(100% 0,0 0,100% 100%)" }} />
                    </>
                  )}
                </div>
              </div>
              </Fragment>
            );
          })}

          {/* ── DEPENDENCY ARROWS ── */}
          {rowsFlat.length > 0 && (() => {
            // Index and Y both come from the rendered order (rowsFlat), not the
            // hierarchy order — in lookahead style the two differ.
            const rowIndex = new Map(rowsFlat.map((t, i) => [t.id, i]));
            const yOf = (id: string) => (rowGeom.tops.get(id) ?? 0) + ROW_H / 2;
            const arrows: { key: string; d: string }[] = [];
            for (const dep of deps) {
              const predRow = rowIndex.get(dep.predecessor_id);
              const succRow = rowIndex.get(dep.task_id);
              if (predRow === undefined || succRow === undefined) continue;
              const pred = taskMap.get(dep.predecessor_id);
              const succ = taskMap.get(dep.task_id);
              if (!pred || !succ) continue;
              const predIsMile = (pred.is_milestone ?? false) || (pred.is_constraint ?? false);
              const succIsMile = (succ.is_milestone ?? false) || (succ.is_constraint ?? false);
              const x1 = predIsMile ? dayOff(pred.end_date) * DAY_W + DAY_W / 2 : dayOff(pred.end_date) * DAY_W + DAY_W;
              const y1 = yOf(dep.predecessor_id);
              const x2 = succIsMile ? dayOff(succ.start_date) * DAY_W + DAY_W / 2 - 10 : dayOff(succ.start_date) * DAY_W;
              const y2 = yOf(dep.task_id);

              // Rounded S-curve rather than a stepped polyline. Leaves the
              // predecessor horizontally and arrives at the successor
              // horizontally, so the arrowhead still reads as "this feeds that"
              // — the curve only replaces the hard corners in between.
              const d = curvedLink(x1, y1, x2, y2, succRow === predRow);
              arrows.push({ key: `${dep.task_id}-${dep.predecessor_id}`, d });
            }
            return (
              <svg
                className="absolute pointer-events-none z-0"
                style={{ left: leftW, top: HEADER_H, width: chartW, height: rowGeom.height }}
              >
                <defs>
                  <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 Z" fill="#94A3B8" />
                  </marker>
                </defs>
                {arrows.map(a => (
                  <path key={a.key} d={a.d} fill="none" stroke="#94A3B8" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
                ))}
              </svg>
            );
          })()}
        </div>
      </div>

      {/* ── READINESS KEY ──
          Spelled out rather than left to colour intuition, and explicit that
          "ready" is not a materials/approvals confirmation. */}
      {lookaheadStyle && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg bg-white px-3 py-2 text-[11px] text-zinc-500 shadow-sm">
          {(["ready", "progress", "unowned", "late", "blocked", "done", "na"] as const).map(k => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: READY_META[k].color }} />
              {READY_META[k].label}
            </span>
          ))}
          <span className="ml-auto text-[10px] italic text-zinc-400">
            “Ready” = owned, dated, not overdue. It does not confirm materials or approvals.
          </span>
        </div>
      )}

      {/* ── TOOLBAR ── */}
      <div className="flex items-center gap-3 flex-wrap">
        {!readOnly && (
          <button onClick={() => addTask(null)} className="rounded-md bg-[#1A3560] px-4 py-2 text-sm font-medium text-white hover:bg-[#152b4e]">
            + Add Task
          </button>
        )}
        <button
          onClick={printGantt}
          className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
          🖨 Print / PDF
        </button>
        {!fixedStart && (
          <div className="flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-1 py-1">
            <button
              onClick={() => setZoom(z => Math.max(ZOOM_MIN, +(z * 0.8).toFixed(3)))}
              disabled={zoom <= ZOOM_MIN}
              className="w-6 h-6 flex items-center justify-center text-sm font-bold text-zinc-600 hover:bg-zinc-100 rounded disabled:opacity-30"
              title="Zoom out">
              −
            </button>
            <span className="w-12 text-center text-[11px] text-zinc-500 tabular-nums">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom(z => Math.min(ZOOM_MAX, +(z / 0.8).toFixed(3)))}
              disabled={zoom >= ZOOM_MAX}
              className="w-6 h-6 flex items-center justify-center text-sm font-bold text-zinc-600 hover:bg-zinc-100 rounded disabled:opacity-30"
              title="Zoom in">
              +
            </button>
            {zoom !== 1 && (
              <button onClick={() => setZoom(1)} className="ml-1 text-[10px] text-zinc-400 hover:text-zinc-700 px-1" title="Reset zoom">
                Reset
              </button>
            )}
          </div>
        )}
        {!readOnly && (
          <p className="text-xs text-zinc-400">
            Double-click Name, Start, Finish, Days, or Pred. to edit · Drag bar to move or resize · Sat/Sun = weekend working days
          </p>
        )}
      </div>

      {/* ── LEGEND ── */}
      <div className="flex items-center gap-x-5 gap-y-1.5 flex-wrap py-1 border-t border-zinc-100 pt-2">
        <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Legend</span>
        {roles.map(r => (
          <div key={r.id} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: r.color }} />
            <span className="text-[11px] text-zinc-600">{r.name}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-slate-400 shrink-0" />
          <span className="text-[11px] text-zinc-600">No Role/Trade</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-[#1A3560] shrink-0" />
          <span className="text-[11px] text-zinc-600">Summary</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 shrink-0 rotate-45 bg-amber-400 border border-amber-500" />
          <span className="text-[11px] text-zinc-600">Milestone</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 shrink-0 rounded-full bg-red-500 border border-red-700" />
          <span className="text-[11px] text-zinc-600">Constraint</span>
        </div>
        {championBadge && (
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 shrink-0 rounded-full bg-[#1A3560] border border-white" />
            <span className="text-[11px] text-zinc-600">Champion (initials)</span>
          </div>
        )}
        {holidaySet.size > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 shrink-0 bg-red-100 border border-red-200" />
            <span className="text-[11px] text-zinc-600">Stat Holiday</span>
          </div>
        )}
      </div>

      {/* ── STAT HOLIDAYS PANEL ── */}
      {!hideStatHolidays && <div className="rounded-lg border border-zinc-200 bg-white p-4 mt-1">
        <h3 className="text-sm font-semibold text-[#1A3560] mb-1">Statutory Holidays</h3>
        <p className="text-xs text-zinc-400 mb-3">Non-working days for all tasks — shown in red on the chart.</p>
        <div className="flex flex-col gap-1">
          {holidays.length === 0 && <p className="text-xs text-zinc-400 italic py-1">No statutory holidays defined.</p>}
          {holidays.map(h => (
            <div key={h.id} className="flex items-center gap-3 py-1 border-b border-zinc-50 last:border-0">
              <span className="text-xs font-mono text-zinc-500 w-24 shrink-0">{h.date}</span>
              <span className="text-xs text-zinc-700 flex-1">{h.label}</span>
              {!readOnly && (
                <button onClick={() => deleteHoliday(h.id)} className="text-red-400 hover:text-red-600 text-[11px] shrink-0">Remove</button>
              )}
            </div>
          ))}
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2 mt-3">
            <input
              type="date"
              value={newHolDate}
              onChange={e => setNewHolDate(e.target.value)}
              className="rounded border border-zinc-300 px-2 py-1 text-xs outline-none focus:border-[#2E6EA6]"
            />
            <input
              type="text"
              value={newHolLabel}
              onChange={e => setNewHolLabel(e.target.value)}
              placeholder="Holiday name (e.g. Canada Day)"
              className="flex-1 rounded border border-zinc-300 px-2 py-1 text-xs outline-none focus:border-[#2E6EA6]"
              onKeyDown={e => { if (e.key === "Enter") addHoliday(); }}
            />
            <button
              onClick={addHoliday}
              disabled={!newHolDate || !newHolLabel.trim()}
              className="rounded bg-[#1A3560] px-3 py-1 text-xs font-medium text-white hover:bg-[#152b4e] disabled:opacity-40"
            >
              Add
            </button>
          </div>
        )}
      </div>}
    </div>
  );
}

function H({ w, center, children, title }: { w: number; center?: boolean; children?: React.ReactNode; title?: string }) {
  return (
    <div
      className={`shrink-0 flex items-center px-1 text-[11px] font-semibold text-white border-r border-white/10 ${center ? "justify-center" : ""}`}
      style={{ width: w }}
      title={title}
    >
      {children}
    </div>
  );
}

// ─── Typeahead member search ──────────────────────────────────────────────────
// Portal-based so the dropdown escapes overflow:auto scroll containers.
function MemberSearch({
  members, placeholder, onSelect, onClear, currentName,
}: {
  members: Profile[];
  placeholder: string;
  onSelect: (p: Profile) => void;
  onClear?: () => void;
  currentName?: string;
}) {
  const [query,  setQuery]  = useState(currentName ?? "");
  const [open,   setOpen]   = useState(false);
  const [pos,    setPos]    = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!open) setQuery(currentName ?? ""); }, [currentName, open]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return members.filter(m => !q || m.full_name?.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
  }, [members, query]);

  function openDropdown() {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 180) });
    setOpen(true);
  }

  const dropdown = open && filtered.length > 0 && typeof document !== "undefined"
    ? createPortal(
        <div
          className="z-[9999] max-h-48 overflow-y-auto rounded border border-zinc-200 bg-white shadow-xl"
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
        >
          {filtered.map(m => (
            <button key={m.id}
              className="w-full text-left px-3 py-2 text-xs text-zinc-700 hover:bg-blue-50 hover:text-[#1A3560]"
              onMouseDown={e => { e.preventDefault(); onSelect(m); setQuery(m.full_name || m.email); setOpen(false); }}
            >
              <span className="font-medium">{m.full_name || m.email}</span>
              {m.full_name && <span className="ml-2 text-zinc-400 text-[10px]">{m.email}</span>}
            </button>
          ))}
        </div>,
        document.body
      )
    : null;

  return (
    <div className="flex items-center gap-0.5 w-full min-w-0">
      <input
        ref={inputRef}
        className="flex-1 min-w-0 text-[11px] text-zinc-700 bg-transparent border-0 outline-none placeholder-zinc-300"
        value={query}
        placeholder={placeholder}
        onChange={e => { setQuery(e.target.value); openDropdown(); }}
        onFocus={openDropdown}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      />
      {onClear && currentName && (
        <button
          className="shrink-0 text-zinc-300 hover:text-red-400 text-[10px]"
          onMouseDown={e => { e.preventDefault(); onClear(); setQuery(""); }}
          title="Remove"
        >✕</button>
      )}
      {dropdown}
    </div>
  );
}
