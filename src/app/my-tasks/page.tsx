import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateLookaheadProject } from "@/lib/actions/master";
import MyTasksView from "@/components/tasks/MyTasksView";
import { diffInDays, todayISO } from "@/lib/date";
import type { Task, TaskNote, TaskSupport } from "@/lib/supabase/types";

export default async function MyTasksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const lookahead = await getOrCreateLookaheadProject();
  if (!lookahead) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <p className="text-red-600">Could not load the Lookahead schedule.</p>
      </div>
    );
  }

  const TASK_COLS = "id, project_id, title, start_date, end_date, assignee_id, champion_id, status, parent_id, sort_order, created_at, work_sat, work_sun, is_milestone, subcontractor, crew_size, role_id, is_constraint";

  const [{ data: mine }, { data: mySupport }] = await Promise.all([
    supabase.from("tasks")
      .select(TASK_COLS)
      .eq("project_id", lookahead.id)
      .or(`assignee_id.eq.${user.id},champion_id.eq.${user.id}`)
      .returns<Task[]>(),
    supabase.from("task_support")
      .select("task_id, user_id")
      .eq("user_id", user.id)
      .returns<TaskSupport[]>(),
  ]);

  const ownIds = new Set((mine ?? []).map(t => t.id));
  const supportTaskIds = (mySupport ?? []).map(s => s.task_id).filter(id => !ownIds.has(id));
  const { data: supportTasks } = supportTaskIds.length > 0
    ? await supabase.from("tasks").select(TASK_COLS).in("id", supportTaskIds).returns<Task[]>()
    : { data: [] as Task[] };

  const allTasks = [...(mine ?? []), ...(supportTasks ?? [])];

  if (allTasks.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="mb-6 flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-[#1A3560]">My Tasks</h1>
          <p className="text-sm text-slate-500">
            Your tasks from the 6-Week Lookahead — start and complete work right from here.
          </p>
        </div>
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
          <p className="text-zinc-500">No tasks are currently assigned to you.</p>
          <p className="mt-1 text-sm text-zinc-400">
            Tasks appear here once they're exported to the{" "}
            <a href="/lookahead" className="underline hover:text-zinc-600">Lookahead</a>{" "}
            and you're set as champion, assignee, or support.
          </p>
        </div>
      </div>
    );
  }

  const taskIds = allTasks.map(t => t.id);
  const parentIds = [...new Set(allTasks.map(t => t.parent_id).filter((id): id is string => !!id))];

  const [{ data: notes }, { data: parents }] = await Promise.all([
    supabase.from("task_notes")
      .select("id, task_id, user_id, content, updated_at")
      .in("task_id", taskIds)
      .eq("user_id", user.id)
      .returns<TaskNote[]>(),
    parentIds.length > 0
      ? supabase.from("tasks").select("id, title").in("id", parentIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
  ]);

  const noteMap = new Map((notes ?? []).map(n => [n.task_id, n.content]));
  const parentMap = new Map((parents ?? []).map(p => [p.id, p.title]));
  const today = todayISO();

  const enrich = (t: Task, role: "champion" | "assignee" | "support") => ({
    ...t,
    note: noteMap.get(t.id) ?? "",
    role,
    parentTitle: t.parent_id ? parentMap.get(t.parent_id) ?? null : null,
    daysUntilEnd: diffInDays(today, t.end_date),
  });

  const enriched = [
    ...(mine ?? []).map(t => enrich(t, t.champion_id === user.id ? "champion" : "assignee")),
    ...(supportTasks ?? []).map(t => enrich(t, "support")),
  ];

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <div className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-[#1A3560]">My Tasks</h1>
        <p className="text-sm text-slate-500">
          Your tasks from the 6-Week Lookahead — start and complete work right from here.
        </p>
      </div>
      <MyTasksView tasks={enriched} userId={user.id} />
    </div>
  );
}
