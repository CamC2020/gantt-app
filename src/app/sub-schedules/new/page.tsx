import ProjectForm from "@/components/projects/ProjectForm";
import { createProject } from "@/lib/actions/projects";

export default function NewSubSchedulePage() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-bold text-[#1A3560]">New Sub-Schedule</h1>
        <p className="text-sm text-slate-500 mt-1">
          Create a private schedule and invite specific team members.
        </p>
      </div>
      <ProjectForm action={createProject} submitLabel="Create sub-schedule" />
    </div>
  );
}
