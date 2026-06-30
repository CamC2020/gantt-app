import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateMasterProject } from "@/lib/actions/master";
import MsProjectGantt from "@/components/gantt/MsProjectGantt";
import type { Profile, Task, TaskDependency, TaskSupport } from "@/lib/supabase/types";
import { addDays, formatISODate } from "@/lib/date";

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

  const todayStr = formatISODate(new Date());
  const sixWeeksStr = addDays(todayStr, 42);

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, project_id, title, start_date, end_date, assignee_id, champion_id, status, parent_id, sort_order, created_at, work_sat, work_sun, is_milestone")
    .eq("project_id", master.id)
    .lte("start_date", sixWeeksStr)
    .gte("end_date", todayStr)
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
    .select("id, email, full_name")
    .returns<Profile[]>();

  return (
    <div className="mx-auto flex w-full max-w-full flex-col gap-6 px-6 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-[#1A3560]">6-Week Lookahead</h1>
        <p className="text-sm text-slate-500">
          Upcoming work from the Master Schedule —{" "}
          <span className="font-medium">{todayStr}</span> through{" "}
          <span className="font-medium">{sixWeeksStr}</span>. Read-only view.
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
        />
      )}

      <p className="text-xs text-zinc-400">
        To add or edit tasks, go to the{" "}
        <a href="/schedule" className="underline hover:text-zinc-600">Master Schedule</a>.
      </p>
    </div>
  );
}
