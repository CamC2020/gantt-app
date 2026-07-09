import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PullMyTasks from "@/components/tasks/PullMyTasks";
import type { PullTicket, PullLane, PullRole, PullLocation } from "@/lib/supabase/types";

export default async function MyTasksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const TICKET_COLS = "id, lane_id, owner_id, description, start_date, duration, crew_size, status, roadblock, roadblock_note, promised_end, sort_order, role_id, responsible_id, location, location_id, row_index, work_sat, work_sun, notes, variance_reason, variance_note, roadblock_need_by, roadblock_priority, source_task_id";

  const [{ data: tickets }, { data: lanes }, { data: roles }, { data: locations }, { data: mySupport }] =
    await Promise.all([
      supabase.from("pull_tickets")
        .select(TICKET_COLS)
        .or(`responsible_id.eq.${user.id},owner_id.eq.${user.id}`)
        .returns<PullTicket[]>(),
      supabase.from("pull_lanes").select("id, name, sort_order").returns<PullLane[]>(),
      supabase.from("pull_roles").select("id, name, color").returns<PullRole[]>(),
      supabase.from("pull_locations").select("id, name, color, sort_order").returns<PullLocation[]>(),
      supabase.from("pull_ticket_support").select("ticket_id, user_id").eq("user_id", user.id),
    ]);

  // Tickets where I'm support (excluding ones I already own / am responsible for)
  const ownIds = new Set((tickets ?? []).map(t => t.id));
  const supportIds = (mySupport ?? []).map(s => s.ticket_id).filter(id => !ownIds.has(id));
  const { data: supportTickets } = supportIds.length > 0
    ? await supabase.from("pull_tickets").select(TICKET_COLS).in("id", supportIds).returns<PullTicket[]>()
    : { data: [] as PullTicket[] };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <div className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-[#1A3560]">My Tasks</h1>
        <p className="text-sm text-slate-500">
          Your tickets from the Pull Plan — everything you own or are responsible for.
          Promise, start, and complete work right from here.
        </p>
      </div>

      {(tickets ?? []).length === 0 && (supportTickets ?? []).length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
          <p className="text-zinc-500">No tickets are currently assigned to you.</p>
          <p className="mt-1 text-sm text-zinc-400">
            Tickets appear here when you create them or are set as Responsible on the{" "}
            <a href="/pullplan" className="underline hover:text-zinc-600">Pull Plan</a>.
          </p>
        </div>
      ) : (
        <PullMyTasks
          initialTickets={tickets ?? []}
          supportTickets={supportTickets ?? []}
          lanes={lanes ?? []}
          roles={roles ?? []}
          locations={locations ?? []}
          currentUserId={user.id}
        />
      )}
    </div>
  );
}
