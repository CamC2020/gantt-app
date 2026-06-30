import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateMasterProject } from "@/lib/actions/master";
import MsProjectGantt from "@/components/gantt/MsProjectGantt";
import type { Profile, Task, TaskDependency, TaskSupport } from "@/lib/supabase/types";
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

  const master = await getOrCreateMasterProject();
  if (!master) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-red-600">Could not load master schedule.</p>
      </div>
    );
  }

  const todayStr  = formatISODate(new Date());
  const weekStart = getMondayOfWeek(todayStr);       // Monday of current week
  const weekEnd   = addDays(weekStart, 41);           // Sunday 6 weeks later (6×7 − 1)

  // Only tasks that overlap the 6-week window
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, project_id, title, start_date, end_date, assignee_id, champion_id, status, parent_id, sort_order, created_at, work_sat, work_sun, is_milestone, subcontractor, crew_size")
    .eq("project_id", master.id)
    .lte("start_date", weekEnd)
    .gte("end_date", weekStart)
    .order("sort_order", { ascending: true })
    .returns<Task[]>();

  const taskIdList = (tasks ?? []).map(t => t.id);

  const [{ data: rawDeps }, { data: rawSupport }] = taskIdList.length > 0
    ? await Promise.all([
        supabase.from("task_dependencies").select("task_id, predecessor_id, lag_days").in("task_id", taskIdList).returns<TaskDependency[]>(),
        supabase.from("task_support").select("task_id, user_id").in("task_id", taskIdList).returns<TaskSupport[]>(),
      ])
    : [{ data: [] }, { data: [] }];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, full_name, is_admin")
    .returns<Profile[]>();

  return (
    <div className="mx-auto flex w-full max-w-full flex-col gap-6 px-6 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-[#1A3560]">6-Week Lookahead</h1>
        <p className="text-sm text-slate-500">
          <span className="font-medium">{weekStart}</span> through{" "}
          <span className="font-medium">{weekEnd}</span> — read-only view.
        </p>
      </div>

      {(tasks ?? []).length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
          <p className="text-zinc-500">No tasks scheduled in the next 6 weeks.</p>
        </div>
      ) : (
        <MsProjectGantt
          projectId={master.id}
          initialTasks={tasks ?? []}
          initialDeps={rawDeps ?? []}
          initialSupport={rawSupport ?? []}
          members={profiles ?? []}
          readOnly
          hideStatHolidays
          printTitle="6-Week Lookahead"
        />
      )}

      <p className="text-xs text-zinc-400">
        To add or edit tasks, go to the{" "}
        <a href="/schedule" className="underline hover:text-zinc-600">Master Schedule</a>.
      </p>
    </div>
  );
}
