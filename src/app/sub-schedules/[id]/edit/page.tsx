import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateProject } from "@/lib/actions/projects";
import ProjectForm from "@/components/projects/ProjectForm";
import type { Project } from "@/lib/supabase/types";

export default async function EditSubSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: project, error } = await supabase
    .from("projects")
    .select("id, name, description, owner_id")
    .eq("id", id)
    .maybeSingle()
    .returns<Pick<Project, "id" | "name" | "description" | "owner_id"> | null>();

  if (error || !project) notFound();
  if (project.owner_id !== user.id) redirect(`/sub-schedules/${id}`);

  const action = updateProject.bind(null, id);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-6 py-10">
      <h1 className="text-2xl font-bold text-[#1A3560]">Edit Sub-Schedule</h1>
      <ProjectForm
        action={action}
        submitLabel="Save changes"
        defaultValues={{ name: project.name, description: project.description }}
      />
    </div>
  );
}
