import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Project, ProjectRole } from "@/lib/supabase/types";

export default async function SubSchedulesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships, error } = await supabase
    .from("project_members")
    .select("role, projects(id, name, description, owner_id, is_master, created_at)")
    .eq("user_id", user.id)
    .order("created_at", { referencedTable: "projects", ascending: false })
    .returns<{ role: ProjectRole; projects: Project | null }[]>();

  const schedules = (memberships ?? [])
    .map((m) => ({ project: m.projects, role: m.role }))
    .filter((p) => p.project !== null && !p.project!.is_master);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1A3560]">Sub-Schedules</h1>
          <p className="text-sm text-slate-500 mt-1">
            Private schedules shared with specific team members.
          </p>
        </div>
        <Link
          href="/sub-schedules/new"
          className="rounded-md bg-[#1A3560] px-4 py-2 text-sm font-medium text-white hover:bg-[#152b4e]"
        >
          New sub-schedule
        </Link>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error.message}
        </p>
      )}

      {schedules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
          <p className="text-zinc-500">
            No sub-schedules yet. Create one to share with specific team members.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {schedules.map(({ project, role }) => (
            <li key={project!.id}>
              <Link
                href={`/sub-schedules/${project!.id}`}
                className="flex h-full flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-5 transition-shadow hover:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <h2 className="font-medium text-zinc-900">{project!.name}</h2>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                    {role}
                  </span>
                </div>
                {project!.description && (
                  <p className="line-clamp-2 text-sm text-zinc-500">
                    {project!.description}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
