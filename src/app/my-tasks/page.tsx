import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateMasterProject } from "@/lib/actions/master";
import MyTasksView from "@/components/tasks/MyTasksView";
import type { Task, TaskNote, TaskSupport } from "@/lib/supabase/types";

function diffDays(from: string, to: string): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  return Math.round((b - a) / 86400000);
}

export default async function MyTasksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const master = await getOrCreateMasterProject();
  if (!master) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-red-600">Could not load master schedule.</p>
      </div>
    );
  }

  const today = new Date().toISOString().split("T")[0];

  // Fetch ALL tasks in project so we can resolve parent titles
  const { data: allTasks } = await supabase
    .from("tasks")
    .select("id, project_id, title, start_date, end_date, assignee_id, champion_id, status, parent_id, sort_order, created_at, work_sat, work_sun, is_milestone")
    .eq("project_id", master.id)
    .returns<Task[]>();

  const taskMap = new Map((allTasks ?? []).map(t => [t.id, t]));

  // Find tasks where user is champion or assignee
  const directTasks = (allTasks ?? []).filter(
    t => t.champion_id === user.id || t.assignee_id === user.id
  );

  // Find tasks where user is in task_support
  const { data: supportRows } = await supabase
    .from("task_support")
    .select("task_id, user_id")
    .eq("user_id", user.id)
    .returns<TaskSupport[]>();

  const supportTaskIds = new Set((supportRows ?? []).map(r => r.task_id));

  const supportTasks = (allTasks ?? []).filter(
    t => supportTaskIds.has(t.id) && !directTasks.find(d => d.id === t.id)
  );

  // Collect all task IDs we care about
  const myTaskIds = [
    ...directTasks.map(t => t.id),
    ...supportTasks.map(t => t.id),
  ];

  // Fetch notes for these tasks
  const { data: notes } = myTaskIds.length > 0
    ? await supabase
        .from("task_notes")
        .select("id, task_id, user_id, content, updated_at")
        .eq("user_id", user.id)
        .in("task_id", myTaskIds)
        .returns<TaskNote[]>()
    : { data: [] };

  const noteMap = new Map((notes ?? []).map(n => [n.task_id, n.content]));

  function enrich(task: Task, role: "champion" | "assignee" | "support") {
    const parent = task.parent_id ? taskMap.get(task.parent_id) : null;
    return {
      ...task,
      role,
      note: noteMap.get(task.id) ?? "",
      parentTitle: parent?.title ?? null,
      daysUntilEnd: diffDays(today, task.end_date),
    };
  }

  const enriched = [
    ...directTasks.map(t =>
      enrich(t, t.champion_id === user.id ? "champion" : "assignee")
    ),
    ...supportTasks.map(t => enrich(t, "support")),
  ];

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <div className="flex flex-col gap-1 mb-6">
        <h1 className="text-2xl font-bold text-[#1A3560]">My Tasks</h1>
        <p className="text-sm text-slate-500">
          Tasks from the Master Schedule assigned to or supported by you. Status and notes are personal and do not affect the master schedule.
        </p>
      </div>

      {enriched.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
          <p className="text-zinc-500">No tasks are currently assigned to you.</p>
          <p className="text-sm text-zinc-400 mt-1">
            Tasks appear here when you are set as Champion, Assignee, or Supporting on the{" "}
            <a href="/schedule" className="underline hover:text-zinc-600">Master Schedule</a>.
          </p>
        </div>
      ) : (
        <MyTasksView tasks={enriched} userId={user.id} />
      )}
    </div>
  );
}
