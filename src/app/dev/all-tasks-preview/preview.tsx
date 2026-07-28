"use client";

import AllTasksView, { type AllTask } from "@/components/tasks/AllTasksView";

const P = {
  mercer:    { id: "11111111-1111-4111-8111-111111111111", name: "R. Mercer",    org: "Jacob Bros" },
  whitfield: { id: "22222222-2222-4222-8222-222222222222", name: "S. Whitfield", org: "Jacob Bros" },
  okafor:    { id: "33333333-3333-4333-8333-333333333333", name: "T. Okafor",    org: "Jacob Bros" },
  rasmussen: { id: "44444444-4444-4444-8444-444444444444", name: "M. Rasmussen", org: "Village of Anmore" },
  beaudry:   { id: "55555555-5555-4555-8555-555555555555", name: "L. Beaudry",   org: "ISL" },
  nakamura:  { id: "66666666-6666-4666-8666-666666666666", name: "D. Nakamura",  org: "Jacob Bros" },
};

const directory = Object.fromEntries(Object.values(P).map(p => [p.id, p]));

const base = {
  work_sat: false,
  work_sun: false,
  subcontractor: null as string | null,
  parentTitle: null as string | null,
  is_milestone: false,
  canEdit: true,
};

const tasks: AllTask[] = [
  {
    ...base,
    id: "t1",
    title: "Pour slab-on-grade — Bay 3",
    start_date: "2026-07-28", end_date: "2026-07-30",
    status: "in_progress",
    ownerId: P.mercer.id, ownerRole: "champion",
    counterpartId: P.okafor.id,
    supporterIds: [P.nakamura.id],
    parentTitle: "Shop building",
    daysUntilEnd: 2,
  },
  {
    ...base,
    id: "t2",
    title: "Substantial completion walkthrough",
    start_date: "2026-08-25", end_date: "2026-08-25",
    status: "not_started",
    is_milestone: true,
    ownerId: P.mercer.id, ownerRole: "champion",
    counterpartId: null, supporterIds: [],
    daysUntilEnd: 28,
  },
  {
    ...base,
    id: "t3",
    title: "Underground electrical rough-in",
    start_date: "2026-07-24", end_date: "2026-07-27",
    status: "not_started",
    ownerId: P.whitfield.id, ownerRole: "champion",
    counterpartId: null, supporterIds: [],
    subcontractor: "Fraser Electric",
    daysUntilEnd: -1,
  },
  {
    ...base,
    id: "t4",
    title: "Storm connection — Sunnyside Rd",
    start_date: "2026-07-29", end_date: "2026-08-02",
    status: "in_progress",
    ownerId: P.okafor.id, ownerRole: "champion",
    counterpartId: P.mercer.id,
    supporterIds: [P.nakamura.id, P.beaudry.id, P.whitfield.id, P.rasmussen.id, P.mercer.id],
    daysUntilEnd: 5,
  },
  {
    ...base,
    id: "t5",
    title: "Fuel island permit — Village review",
    start_date: "2026-07-30", end_date: "2026-08-06",
    status: "not_started",
    ownerId: P.rasmussen.id, ownerRole: "champion",
    counterpartId: null, supporterIds: [],
    daysUntilEnd: 9,
    canEdit: false,
  },
  {
    ...base,
    id: "t6",
    title: "Salt shed footing survey",
    start_date: "2026-07-20", end_date: "2026-07-24",
    status: "done",
    ownerId: P.beaudry.id, ownerRole: "champion",
    counterpartId: null, supporterIds: [],
    daysUntilEnd: -4,
  },
  {
    ...base,
    id: "t7",
    title: "Aggregate delivery — pit run for yard base",
    start_date: "2026-08-03", end_date: "2026-08-04",
    status: "not_started",
    ownerId: null, ownerRole: null,
    counterpartId: null, supporterIds: [],
    daysUntilEnd: 7,
    canEdit: false,
  },
];

export default function AllTasksPreview() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-[#1A3560]">All Tasks</h1>
        <p className="text-sm text-slate-500">
          Every task in the 6-Week Lookahead, grouped by who owns it.
        </p>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-amber-600">
          Dev preview — mock data, not wired to Supabase
        </p>
      </div>
      <AllTasksView
        tasks={tasks}
        people={Object.values(P)}
        directory={directory}
        currentUserId={P.mercer.id}
      />
    </div>
  );
}
