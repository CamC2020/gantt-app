import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateLookaheadProject } from "@/lib/actions/master";
import MsProjectGantt from "@/components/gantt/MsProjectGantt";
import type { Profile, Task, TaskDependency, TaskSupport, PullRole } from "@/lib/supabase/types";
import { formatISODate, parseISODate, addDays } from "@/lib/date";

function getMondayOfWeek(dateStr: string): string {
  const d = parseISODate(dateStr);
  const dow = d.getDay(); // 0 = Sun, 1 = Mon …
  const daysToMonday = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + daysToMonday);
  return formatISODate(d);
}

export default async function LookaheadPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const lookahead = await getOrCreateLookaheadProject();
  if (!lookahead) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-red-600">Could not load the lookahead schedule.</p>
      </div>
    );
  }

  const todayStr  = formatISODate(new Date());
  const weekStart = getMondayOfWeek(todayStr);       // Monday of current week
  const weekEnd   = addDays(weekStart, 41);           // 6 weeks

  const [{ data: tasks }, { data: profiles }, { data: roles }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, project_id, title, start_date, end_date, assignee_id, champion_id, status, parent_id, sort_order, created_at, work_sat, work_sun, is_milestone, subcontractor, crew_size, role_id, is_constraint")
      .eq("project_id", lookahead.id)
      .order("sort_order", { ascending: true })
      .returns<Task[]>(),
    supabase
      .from("profiles")
      .select("id, email, full_name, is_admin")
      .returns<Profile[]>(),
    supabase
      .from("pull_roles")
      .select("id, name, color")
      .order("name", { ascending: true })
      .returns<PullRole[]>(),
  ]);

  const taskIdList = (tasks ?? []).map(t => t.id);
  const [{ data: rawDeps }, { data: rawSupport }] = taskIdList.length > 0
    ? await Promise.all([
        supabase.from("task_dependencies")
          .select("task_id, predecessor_id, lag_days")
          .in("task_id", taskIdList)
          .returns<TaskDependency[]>(),
        supabase.from("task_support")
          .select("task_id, user_id")
          .in("task_id", taskIdList)
          .returns<TaskSupport[]>(),
      ])
    : [{ data: [] as TaskDependency[] }, { data: [] as TaskSupport[] }];

  return (
    <div className="mx-auto flex w-full max-w-full flex-col gap-6 px-6 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-[#1A3560]">6-Week Lookahead</h1>
        <p className="text-sm text-slate-500">
          <span className="font-medium">{weekStart}</span> through{" "}
          <span className="font-medium">{weekEnd}</span> — populated by “Export to Lookahead” on the Pull Plan.
        </p>
      </div>

      {(tasks ?? []).length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
          <p className="text-zinc-500">The lookahead is empty.</p>
          <p className="mt-1 text-sm text-zinc-400">
            Use the <span className="font-semibold">Export to Lookahead</span> button on the{" "}
            <a href="/pullplan" className="underline hover:text-zinc-600">Pull Plan</a> to publish the active work here.
          </p>
        </div>
      ) : (
        <MsProjectGantt
          projectId={lookahead.id}
          initialTasks={tasks ?? []}
          initialDeps={rawDeps ?? []}
          initialSupport={rawSupport ?? []}
          members={profiles ?? []}
          roles={roles ?? []}
          readOnly
          hideStatHolidays
          printTitle="6-Week Lookahead"
          fixedStart={weekStart}
          fixedEnd={weekEnd}
          hideCrewCol
          hideDtcCol
          lookaheadStyle
          championBadge
          hideLegendOnPrint
        />
      )}
    </div>
  );
}
