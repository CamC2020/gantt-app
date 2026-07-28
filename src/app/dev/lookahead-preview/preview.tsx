"use client";

import MsProjectGantt from "@/components/gantt/MsProjectGantt";
import type { Profile, Task, TaskDependency, TaskSupport, PullRole } from "@/lib/supabase/types";
import { addDays, formatISODate } from "@/lib/date";

const today = formatISODate(new Date());
const d = (n: number) => addDays(today, n);

const members: Profile[] = [
  { id: "u1", email: "r.mercer@jacobbros.ca", full_name: "R. Mercer", is_admin: true },
  { id: "u2", email: "t.okafor@jacobbros.ca", full_name: "T. Okafor", is_admin: false },
  { id: "u3", email: "s.whitfield@jacobbros.ca", full_name: "S. Whitfield", is_admin: false },
  { id: "u4", email: "m.rasmussen@anmore.ca", full_name: "M. Rasmussen", is_admin: false },
  { id: "u5", email: "l.beaudry@islengineering.com", full_name: "L. Beaudry", is_admin: false },
  { id: "u6", email: "d.nakamura@jacobbros.ca", full_name: "D. Nakamura", is_admin: false },
];

const roles: PullRole[] = [
  { id: "r1", name: "Concrete", color: "#5b6cb8" },
  { id: "r2", name: "Sitework", color: "#5a7d3d" },
  { id: "r3", name: "Steel", color: "#a85a7a" },
  { id: "r4", name: "Mechanical", color: "#b8683a" },
  { id: "r5", name: "Approval", color: "#c1301a" },
];

const base = {
  project_id: "p1", parent_id: null, sort_order: 0, created_at: today,
  work_sat: false, work_sun: false, is_milestone: false, is_constraint: false,
  subcontractor: null, crew_size: null, assignee_id: null,
};

// Deliberately covers every readiness state so the dots can be checked at a glance.
const tasks: Task[] = [
  { ...base, id: "t1", title: "Pour slab-on-grade — Bay 3", start_date: d(0), end_date: d(2),
    champion_id: "u1", status: "in_progress", role_id: "r1", sort_order: 1 },            // progress
  { ...base, id: "t2", title: "Lane closure permit — Sunnyside", start_date: d(1), end_date: d(1),
    champion_id: "u4", status: "not_started", role_id: "r5", is_constraint: true, sort_order: 2 }, // blocked
  { ...base, id: "t3", title: "Underground electrical rough-in", start_date: d(-6), end_date: d(-1),
    champion_id: "u3", status: "not_started", role_id: "r2", sort_order: 3 },            // late
  { ...base, id: "t4", title: "Trench & backfill — storm", start_date: d(2), end_date: d(8),
    champion_id: "u2", status: "not_started", role_id: "r2", work_sat: true, sort_order: 4 }, // ready
  { ...base, id: "t5", title: "Aggregate delivery — pit run", start_date: d(5), end_date: d(6),
    champion_id: null, status: "not_started", role_id: "r2", sort_order: 5 },            // unowned
  { ...base, id: "t6", title: "Salt shed footing survey", start_date: d(-4), end_date: d(-2),
    champion_id: "u5", status: "done", role_id: "r2", sort_order: 6 },                   // done
  { ...base, id: "t7", title: "Steel erection — roof", start_date: d(9), end_date: d(16),
    champion_id: "u3", status: "not_started", role_id: "r3", sort_order: 7 },            // ready
  { ...base, id: "t8", title: "Fuel island — tank set", start_date: d(12), end_date: d(14),
    champion_id: "u1", status: "not_started", role_id: "r4", sort_order: 8 },            // ready
  { ...base, id: "t9", title: "Dry-in complete", start_date: d(20), end_date: d(20),
    champion_id: "u1", status: "not_started", role_id: null, is_milestone: true, sort_order: 9 }, // na
];

// Kept non-empty on purpose: dropping the Pred./Lag columns is only defensible
// if the arrows still draw.
const deps: TaskDependency[] = [
  { task_id: "t4", predecessor_id: "t1", lag_days: 0 },
  { task_id: "t7", predecessor_id: "t4", lag_days: 1 },
  { task_id: "t8", predecessor_id: "t7", lag_days: 0 },
];

const support: TaskSupport[] = [
  { task_id: "t1", user_id: "u2" },
  { task_id: "t1", user_id: "u6" },
  { task_id: "t4", user_id: "u6" },
  { task_id: "t4", user_id: "u5" },
  { task_id: "t4", user_id: "u1" },
  { task_id: "t4", user_id: "u3" },
];

export default function LookaheadPreview() {
  return (
    <div className="mx-auto flex w-full max-w-full flex-col gap-6 px-6 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-[#1A3560]">6-Week Lookahead</h1>
        <p className="text-sm text-slate-500">{d(0)} through {d(41)}</p>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-amber-600">
          Dev preview — mock data, not wired to Supabase
        </p>
      </div>
      <MsProjectGantt
        projectId="p1"
        initialTasks={tasks}
        initialDeps={deps}
        initialSupport={support}
        members={members}
        roles={roles}
        readOnly
        hideStatHolidays
        printTitle="6-Week Lookahead"
        fixedStart={d(0)}
        fixedEnd={d(41)}
        hideCrewCol
        hideDtcCol
        lookaheadStyle
        championBadge
        hideLegendOnPrint
      />
    </div>
  );
}
