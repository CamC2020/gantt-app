import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateLookaheadProject } from "@/lib/actions/master";
import AllTasksView from "@/components/tasks/AllTasksView";
import { diffInDays, todayISO } from "@/lib/date";
import type { Profile, Task, TaskSupport } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function AllTasksPage() {
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

  const [{ data: tasks }, { data: profiles }, { data: support }] = await Promise.all([
    supabase.from("tasks")
      .select(TASK_COLS)
      .eq("project_id", lookahead.id)
      .order("end_date", { ascending: true })
      .returns<Task[]>(),
    supabase.from("profiles")
      .select("id, email, full_name, is_admin")
      .returns<Profile[]>(),
    supabase.from("task_support")
      .select("task_id, user_id")
      .returns<TaskSupport[]>(),
  ]);

  const allTasks = tasks ?? [];

  if (allTasks.length === 0) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <div className="mb-6 flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-[#1A3560]">All Tasks</h1>
          <p className="text-sm text-slate-500">
            Every task in the 6-Week Lookahead, with who&rsquo;s responsible.
          </p>
        </div>
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
          <p className="text-zinc-500">The lookahead is empty.</p>
          <p className="mt-1 text-sm text-zinc-400">
            Use the <span className="font-semibold">Export to Lookahead</span> button on the{" "}
            <a href="/pullplan" className="underline hover:text-zinc-600">Pull Plan</a> to publish the active work here.
          </p>
        </div>
      </div>
    );
  }

  const parentIds = [...new Set(allTasks.map(t => t.parent_id).filter((id): id is string => !!id))];
  const { data: parents } = parentIds.length > 0
    ? await supabase.from("tasks").select("id, title").in("id", parentIds)
    : { data: [] as { id: string; title: string }[] };

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p.full_name || p.email]));
  const parentMap = new Map((parents ?? []).map(p => [p.id, p.title]));

  const supportByTask = new Map<string, string[]>();
  for (const s of support ?? []) {
    const name = profileMap.get(s.user_id);
    if (!name) continue;
    const list = supportByTask.get(s.task_id) ?? [];
    list.push(name);
    supportByTask.set(s.task_id, list);
  }

  const today = todayISO();

  const enriched = allTasks.map(t => ({
    ...t,
    championName: t.champion_id ? profileMap.get(t.champion_id) ?? "Unknown" : null,
    assigneeName: t.assignee_id ? profileMap.get(t.assignee_id) ?? "Unknown" : null,
    supportNames: supportByTask.get(t.id) ?? [],
    parentTitle: t.parent_id ? parentMap.get(t.parent_id) ?? null : null,
    daysUntilEnd: diffInDays(today, t.end_date),
  }));

  const people = (profiles ?? [])
    .map(p => p.full_name || p.email)
    .sort((a, b) => a.localeCompare(b));

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <div className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-[#1A3560]">All Tasks</h1>
        <p className="text-sm text-slate-500">
          Every task in the 6-Week Lookahead, with who&rsquo;s responsible.
        </p>
      </div>
      <AllTasksView tasks={enriched} people={people} />
    </div>
  );
}
