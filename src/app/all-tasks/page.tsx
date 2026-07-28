import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateLookaheadProject } from "@/lib/actions/master";
import AllTasksView from "@/components/tasks/AllTasksView";
import { diffInDays, todayISO } from "@/lib/date";
import { displayName, orgFromEmail } from "@/lib/people";
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
  const isAdmin = (profiles ?? []).find(p => p.id === user.id)?.is_admin ?? false;

  if (allTasks.length === 0) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className="mb-6 flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-[#1A3560]">All Tasks</h1>
          <p className="text-sm text-slate-500">
            Every task in the 6-Week Lookahead, grouped by who owns it.
          </p>
        </div>
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
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

  const parentMap = new Map((parents ?? []).map(p => [p.id, p.title]));

  const people = (profiles ?? []).map(p => ({
    id: p.id,
    name: displayName(p.full_name, p.email),
    org: orgFromEmail(p.email),
  }));
  const peopleById = new Map(people.map(p => [p.id, p]));

  const supportIdsByTask = new Map<string, string[]>();
  for (const s of support ?? []) {
    const list = supportIdsByTask.get(s.task_id) ?? [];
    list.push(s.user_id);
    supportIdsByTask.set(s.task_id, list);
  }

  const today = todayISO();

  const enriched = allTasks.map(t => {
    const supporterIds = supportIdsByTask.get(t.id) ?? [];

    // Each task lands in exactly one person's group so the per-person counts
    // stay honest. Champion outranks assignee because that's who the JV holds
    // accountable; support shows on the card instead of splitting the task.
    const ownerId = t.champion_id ?? t.assignee_id ?? null;

    return {
      id: t.id,
      title: t.title,
      start_date: t.start_date,
      end_date: t.end_date,
      status: t.status,
      is_milestone: t.is_milestone,
      work_sat: t.work_sat,
      work_sun: t.work_sun,
      subcontractor: t.subcontractor,

      ownerId,
      ownerRole: (t.champion_id ? "champion" : t.assignee_id ? "assignee" : null) as
        | "champion" | "assignee" | null,
      // The other named person, when champion and assignee differ.
      counterpartId: t.champion_id && t.assignee_id && t.champion_id !== t.assignee_id
        ? t.assignee_id
        : null,
      supporterIds,

      parentTitle: t.parent_id ? parentMap.get(t.parent_id) ?? null : null,
      daysUntilEnd: diffInDays(today, t.end_date),

      // Mirrors the update_task_status RPC's own check (003_admin.sql) so the UI
      // only offers controls the database will actually accept.
      canEdit:
        isAdmin ||
        t.champion_id === user.id ||
        t.assignee_id === user.id ||
        supporterIds.includes(user.id),
    };
  });

  // Only offer people who actually appear on a task, so the filter never lists
  // a name that returns nothing.
  const involvedIds = new Set<string>();
  for (const t of enriched) {
    if (t.ownerId) involvedIds.add(t.ownerId);
    if (t.counterpartId) involvedIds.add(t.counterpartId);
    t.supporterIds.forEach(id => involvedIds.add(id));
  }
  const involved = people
    .filter(p => involvedIds.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-[#1A3560]">All Tasks</h1>
        <p className="text-sm text-slate-500">
          Every task in the 6-Week Lookahead, grouped by who owns it.
        </p>
      </div>
      <AllTasksView
        tasks={enriched}
        people={involved}
        directory={Object.fromEntries(peopleById)}
        currentUserId={user.id}
      />
    </div>
  );
}
