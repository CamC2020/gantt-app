// Minimal hand-written types matching supabase/schema.sql.
// If you have the Supabase CLI, you can regenerate richer types with:
//   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts

export type TaskStatus = "not_started" | "in_progress" | "done";
export type ProjectRole = "owner" | "member";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  created_at: string;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: ProjectRole;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  start_date: string;
  end_date: string;
  assignee_id: string | null;
  status: TaskStatus;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string; email: string };
        Update: Partial<Profile>;
      };
      projects: {
        Row: Project;
        Insert: Partial<Project> & { name: string; owner_id: string };
        Update: Partial<Project>;
      };
      project_members: {
        Row: ProjectMember;
        Insert: ProjectMember;
        Update: Partial<ProjectMember>;
      };
      tasks: {
        Row: Task;
        Insert: Partial<Task> & {
          project_id: string;
          title: string;
          start_date: string;
          end_date: string;
        };
        Update: Partial<Task>;
      };
    };
  };
}
