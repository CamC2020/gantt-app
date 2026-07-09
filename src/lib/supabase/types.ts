// Minimal hand-written types matching supabase/schema.sql.
// If you have the Supabase CLI, you can regenerate richer types with:
//   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts

export type TaskStatus = "not_started" | "in_progress" | "done";
export type ProjectRole = "owner" | "member";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  is_admin: boolean;
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
  subcontractor: string | null;
  crew_size: number | null;
}

export interface MemberHoliday {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  label: string;
}

export interface StatHoliday {
  id: string; date: string; label: string;
}

export interface TaskSupport {
  task_id: string;
  user_id: string;
}

export type PullTicketStatus =
  | "planned" | "promised" | "in_progress"
  | "done_early" | "done_ontime" | "done_late";

export interface PullLane {
  id: string;
  name: string;
  sort_order: number;
}

export interface PullTicket {
  id: string;
  lane_id: string | null;
  owner_id: string;
  description: string;
  start_date: string | null;
  duration: number;
  crew_size: number | null;
  status: PullTicketStatus;
  roadblock: boolean;
  roadblock_note: string;
  promised_end: string | null;
  sort_order: number;
  role_id: string | null;
  responsible_id: string | null;
  location: string;
  location_id: string | null;
  row_index: number;
  work_sat: boolean;
  work_sun: boolean;
}

export interface PullMilestoneLink {
  id: string;
  ticket_id: string;
  milestone_id: string;
  ticket_is_pred: boolean;
}

export interface PullLocation {
  id: string;
  name: string;
  color: string;
  sort_order: number;
}

export interface PullRole {
  id: string;
  name: string;
  color: string;
}

export interface PullTicketDep {
  ticket_id: string;
  predecessor_id: string;
}

export interface PullMilestone {
  id: string;
  label: string;
  date: string | null;   // null = in the tray
  lane_id: string | null;
  row_index: number;
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
