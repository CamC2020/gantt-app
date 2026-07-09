import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, PullLane, PullTicket, PullMilestone, PullRole, PullTicketDep } from "@/lib/supabase/types";
import PullPlanBoard from "@/components/pullplan/PullPlanBoard";

export default async function PullPlanPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { data: lanes }, { data: tickets }, { data: milestones },
    { data: profiles }, { data: roles }, { data: deps }, { data: settings },
  ] = await Promise.all([
    supabase.from("pull_lanes")
      .select("id, name, sort_order")
      .order("sort_order", { ascending: true })
      .returns<PullLane[]>(),
    supabase.from("pull_tickets")
      .select("id, lane_id, owner_id, description, start_date, duration, crew_size, status, roadblock, roadblock_note, promised_end, sort_order, role_id, responsible_id, location")
      .order("sort_order", { ascending: true })
      .returns<PullTicket[]>(),
    supabase.from("pull_milestones")
      .select("id, label, date")
      .order("date", { ascending: true })
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
    supabase.from("pull_settings")
      .select("active_date")
      .eq("id", 1)
      .maybeSingle<{ active_date: string }>(),
  ]);

  const myProfile = (profiles ?? []).find(p => p.id === user.id);

  return (
    <div className="mx-auto flex w-full max-w-full flex-col gap-4 px-6 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-[#1A3560]">Pull Plan</h1>
        <p className="text-sm text-slate-500">
          Collaborative pull planning board — add tickets, connect predecessors, promise your work, and mark it complete.
        </p>
      </div>
      <PullPlanBoard
        initialLanes={lanes ?? []}
        initialTickets={tickets ?? []}
        initialMilestones={milestones ?? []}
        initialRoles={roles ?? []}
        initialDeps={deps ?? []}
        initialActiveDate={settings?.active_date ?? null}
        members={profiles ?? []}
        currentUserId={user.id}
        isAdmin={myProfile?.is_admin ?? false}
      />
    </div>
  );
}
