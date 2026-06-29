import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { addProjectMember } from "@/lib/actions/projects";
import AddMemberForm from "@/components/projects/AddMemberForm";
import RemoveMemberButton from "@/components/projects/RemoveMemberButton";
import DeleteProjectButton from "@/components/projects/DeleteProjectButton";
import NewTaskPanel from "@/components/tasks/NewTaskPanel";
import TaskListItem from "@/components/tasks/TaskListItem";
import GanttChart from "@/components/gantt/GanttChart";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name, description, owner_id, created_at")
    .eq("id", id)
    .maybeSingle();

  if (projectError || !project) {
    notFound();
  }

  const isOwner = project.owner_id === user.id;

  const { data: memberRows } = await supabase
    .from("project_members")
    .select("role, profiles(id, email, full_name)")
    .eq("project_id", id);

  const members = (memberRows ?? [])
    .map((row) => ({ profile: row.profiles, role: row.role }))
    .filter((row) => row.profile !== null);

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, project_id, title, start_date, end_date, assignee_id, status, created_at")
    .eq("project_id", id)
    .order("start_date", { ascending: true });

  const memberProfiles = members.map((m) => m.profile!);
  const addMemberAction = (
    prevState: { error: string | null },
    formData: FormData
  ) => addProjectMember(id, prevState, formData);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-2">
        <Link href="/projects" className="text-sm text-zinc-500 hover:text-zinc-800">
          ← All projects
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900">{project.name}</h1>
            {project.description && (
              <p className="mt-1 max-w-2xl text-zinc-600">{project.description}</p>
            )}
          </div>
          {isOwner && (
            <div className="flex shrink-0 gap-2">
              <Link
                href={`/projects/${id}/edit`}
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
        <h2 className="text-lg font-semibold text-zinc-900">Timeline</h2>
        <GanttChart projectId={id} initialTasks={tasks ?? []} members={memberProfiles} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">Tasks</h2>
        </div>
        <NewTaskPanel projectId={id} members={memberProfiles} />
        <div className="flex flex-col gap-2">
          {(tasks ?? []).map((task) => (
            <TaskListItem
              key={task.id}
              task={task}
              projectId={id}
              members={memberProfiles}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900">Team</h2>
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
