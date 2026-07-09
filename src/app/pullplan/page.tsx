import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  Profile, PullLane, PullTicket, PullMilestone, PullRole, PullTicketDep, PullLocation, PullMilestoneLink, PullSnapshot,
} from "@/lib/supabase/types";
import PullPlanBoard from "@/components/pullplan/PullPlanBoard";

export default async function PullPlanPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { data: lanes }, { data: tickets }, { data: milestones },
    { data: profiles }, { data: roles }, { data: deps },
    { data: locations }, { data: settings }, { data: msLinks }, { data: snapshots },
  ] = await Promise.all([
    supabase.from("pull_lanes")
      .select("id, name, sort_order")
      .order("sort_order", { ascending: true })
      .returns<PullLane[]>(),
    supabase.from("pull_tickets")
      .select("id, lane_id, owner_id, description, start_date, duration, crew_size, status, roadblock, roadblock_note, promised_end, sort_order, role_id, responsible_id, location, location_id, row_index, work_sat, work_sun, notes, variance_reason, variance_note, roadblock_need_by, roadblock_priority")
      .order("sort_order", { ascending: true })
      .returns<PullTicket[]>(),
    supabase.from("pull_milestones")
      .select("id, label, date, lane_id, row_index")
      .order("created_at", { ascending: true })
      .returns<PullMilestone[]>(),
    supabase.from("profiles")
      .select("id, email, full_name, is_admin")
      .order("full_name", { ascending: true })
      .returns<Profile[]>(),
    supabase.from("pull_roles")
      .select("id, name, color")
      .order("name", { ascending: true })
      .returns<PullRole[]>(),
    supabase.from("pull_ticket_deps")
      .select("ticket_id, predecessor_id")
      .returns<PullTicketDep[]>(),
    supabase.from("pull_locations")
      .select("id, name, color, sort_order")
      .order("sort_order", { ascending: true })
      .returns<PullLocation[]>(),
    supabase.from("pull_settings")
      .select("active_date")
      .eq("id", 1)
      .maybeSingle<{ active_date: string }>(),
    supabase.from("pull_milestone_links")
      .select("id, ticket_id, milestone_id, ticket_is_pred")
      .returns<PullMilestoneLink[]>(),
    supabase.from("pull_snapshots")
      .select("id, name, created_by, data, created_at")
      .order("created_at", { ascending: false })
      .returns<PullSnapshot[]>(),
  ]);

  const myProfile = (profiles ?? []).find(p => p.id === user.id);

  return (
    <div className="flex w-full max-w-full flex-col gap-3 px-4 py-6">
      <div className="flex flex-col gap-1 px-2">
        <h1 className="text-2xl font-bold text-[#1A3560]">Pull Plan</h1>
      </div>
      <PullPlanBoard
        initialLanes={lanes ?? []}
        initialTickets={tickets ?? []}
        initialMilestones={milestones ?? []}
        initialRoles={roles ?? []}
        initialDeps={deps ?? []}
        initialMsLinks={msLinks ?? []}
        initialLocations={locations ?? []}
        initialSnapshots={snapshots ?? []}
        initialActiveDate={settings?.active_date ?? null}
        members={profiles ?? []}
        currentUserId={user.id}
        isAdmin={myProfile?.is_admin ?? false}
      />
    </div>
  );
}
