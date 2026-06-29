import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateProject } from "@/lib/actions/projects";
import ProjectForm from "@/components/projects/ProjectForm";

export default async function EditProjectPage({
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

  const { data: project, error } = await supabase
    .from("projects")
    .select("id, name, description, owner_id")
    .eq("id", id)
    .maybeSingle();

  if (error || !project) {
    notFound();
  }

  if (project.owner_id !== user.id) {
    redirect(`/projects/${id}`);
  }

  const action = (prevState: { error: string | null }, formData: FormData) =>
    updateProject(id, prevState, formData);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-6 py-10">
      <h1 className="text-2xl font-semibold text-zinc-900">Edit project</h1>
      <ProjectForm
        action={action}
        submitLabel="Save changes"
        defaultValues={{ name: project.name, description: project.description }}
      />
    </div>
  );
}
