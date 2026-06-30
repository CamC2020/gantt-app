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
  is_master: boolean;
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
  champion_id: string | null;
  status: TaskStatus;
  parent_id: string | null;
  sort_order: number;
  created_at: string;
  work_sat: boolean;
  work_sun: boolean;
  is_milestone: boolean;
}

export interface StatHoliday {
  id: string; date: string; label: string;
}

export interface TaskSupport {
  task_id: string;
  user_id: string;
}

export type ReminderType = "5_day" | "1_day";

export interface TaskNote {
  id: string;
  task_id: string;
  user_id: string;
  content: string;
  updated_at: string;
}

export interface TaskDependency {
  task_id: string;
  predecessor_id: string;
  lag_days: number;
}

export interface Database {
  __InternalSupabase: {
    PostgrestVersion: "13";
  };
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string; email: string };
        Update: Partial<Profile>;
        Relationships: [];
      };
      projects: {
        Row: Project;
        Insert: Partial<Project> & { name: string; owner_id: string };
        Update: Partial<Project>;
        Relationships: [];
      };
      project_members: {
        Row: ProjectMember;
        Insert: ProjectMember;
        Update: Partial<ProjectMember>;
        Relationships: [];
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
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
