import ProjectForm from "@/components/projects/ProjectForm";
import { createProject } from "@/lib/actions/projects";

export default function NewProjectPage() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-6 py-10">
      <h1 className="text-2xl font-semibold text-zinc-900">New project</h1>
      <ProjectForm action={createProject} submitLabel="Create project" />
    </div>
  );
}
