import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { addProjectMember } from "@/lib/actions/projects";
import AddMemberForm from "@/components/projects/AddMemberForm";
import RemoveMemberButton from "@/components/projects/RemoveMemberButton";
import DeleteProjectButton from "@/components/projects/DeleteProjectButton";
import MsProjectGantt from "@/components/gantt/MsProjectGantt";
import type { Project, ProjectRole, Profile, Task, TaskDependency, TaskSupport } from "@/lib/supabase/types";

export default async function SubScheduleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name, description, owner_id, is_master, created_at")
    .eq("id", id)
    .maybeSingle()
    .returns<Project | null>();

  if (projectError || !project) notFound();

  const isOwner = project.owner_id === user.id;

  const [{ data: memberRows }, { data: tasks }] = await Promise.all([
    supabase
      .from("project_members")
      .select("role, profiles(id, email, full_name)")
      .eq("project_id", id)
      .returns<{ role: ProjectRole; profiles: Profile | null }[]>(),

    supabase
      .from("tasks")
      .select("id, project_id, title, start_date, end_date, assignee_id, champion_id, status, parent_id, sort_order, created_at, work_sat, work_sun, is_milestone")
      .eq("project_id", id)
      .order("sort_order", { ascending: true })
      .returns<Task[]>(),
  ]);

  const taskIdList = (tasks ?? []).map(t => t.id);

  const [{ data: rawDeps }, { data: rawSupport }] = taskIdList.length > 0
    ? await Promise.all([
        supabase.from("task_dependencies").select("task_id, predecessor_id, lag_days").in("task_id", taskIdList).returns<TaskDependency[]>(),
        supabase.from("task_support").select("task_id, user_id").in("task_id", taskIdList).returns<TaskSupport[]>(),
      ])
    : [{ data: [] }, { data: [] }];

  const members = (memberRows ?? [])
    .map((row) => ({ profile: row.profiles, role: row.role }))
    .filter((row) => row.profile !== null);

  const memberProfiles = members.map((m) => m.profile!);
  const addMemberAction = addProjectMember.bind(null, id);

  return (
    <div className="mx-auto flex w-full max-w-full flex-col gap-8 px-6 py-8">
      <div className="flex flex-col gap-2">
        <Link href="/sub-schedules" className="text-sm text-slate-500 hover:text-slate-800">
          ← All sub-schedules
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#1A3560]">{project.name}</h1>
            {project.description && (
              <p className="mt-1 max-w-2xl text-slate-600">{project.description}</p>
            )}
          </div>
          {isOwner && (
            <div className="flex shrink-0 gap-2">
              <Link
                href={`/sub-schedules/${id}/edit`}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Edit
              </Link>
              <DeleteProjectButton projectId={id} />
            </div>
          )}
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-[#1A3560]">Schedule</h2>
        <MsProjectGantt
          projectId={id}
          initialTasks={tasks ?? []}
          initialDeps={rawDeps ?? []}
          initialSupport={rawSupport ?? []}
          members={memberProfiles}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-[#1A3560]">Team</h2>
        {isOwner && <AddMemberForm action={addMemberAction} />}
        <ul className="flex flex-col gap-2">
          {members.map(({ profile, role }) => (
            <li
              key={profile!.id}
              className="flex items-center justify-between rounded-md border border-zinc-200 bg-white px-4 py-2"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium text-zinc-900">
                  {profile!.full_name || profile!.email}
                </span>
                <span className="text-xs text-zinc-500">{profile!.email}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                  {role}
                </span>
                {isOwner && role !== "owner" && (
                  <RemoveMemberButton projectId={id} userId={profile!.id} />
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
