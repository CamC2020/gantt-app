"use client";

import PullPlanBoard from "@/components/pullplan/PullPlanBoard";
import type { Profile, PullLane, PullTicket, PullMilestone, PullRole, PullTicketDep, PullLocation, PullMilestoneLink } from "@/lib/supabase/types";
import { addDays, formatISODate } from "@/lib/date";

const today = formatISODate(new Date());
const ME = "u1";

const members: Profile[] = [
  { id: "u1", email: "cam@example.com", full_name: "Cameron Cheney", is_admin: true },
  { id: "u2", email: "joe@example.com", full_name: "Joe Foreman", is_admin: false },
];

const roles: PullRole[] = [
  { id: "r1", name: "Sitework", color: "#3ec66d" },
  { id: "r2", name: "Utilities", color: "#f07f4e" },
  { id: "r3", name: "Electrical", color: "#8f5bd9" },
  { id: "r4", name: "Mechanical", color: "#4a90e2" },
  { id: "r5", name: "Paving", color: "#39c2c9" },
];

const locations: PullLocation[] = [
  { id: "l1", name: "North Yard", color: "#8f5bd9", sort_order: 0 },
  { id: "l2", name: "South Yard", color: "#39c2c9", sort_order: 1 },
  { id: "l3", name: "Access Rd", color: "#1A3560", sort_order: 2 },
];

const lanes: PullLane[] = [
  { id: "s1", name: "Shift 1 (Day)", sort_order: 0 },
  { id: "s2", name: "Shift 2 (Night)", sort_order: 1 },
];

function tk(id: string, lane: string, desc: string, startOffset: number | null, dur: number, role: string, loc: string, row: number, extra: Partial<PullTicket> = {}): PullTicket {
  return {
    id, lane_id: startOffset === null ? null : lane, owner_id: ME, description: desc,
    start_date: startOffset === null ? null : addDays(today, startOffset),
    duration: dur, crew_size: 2 + (id.charCodeAt(1) % 4), status: "planned",
    roadblock: false, roadblock_note: "", promised_end: null, sort_order: 0,
    role_id: role, responsible_id: id.charCodeAt(1) % 2 ? "u2" : "u1",
    location: "", location_id: loc, row_index: row,
    work_sat: false, work_sun: false, ...extra,
  };
}

const tickets: PullTicket[] = [
  // Active zone (past few days)
  tk("t1", "s1", "Clear & Grub North Pad", -9, 3, "r1", "l1", 0, { status: "done_ontime", promised_end: addDays(today, -7) }),
  tk("t2", "s1", "Install Storm Mains", -5, 3, "r2", "l1", 1, { status: "done_late", promised_end: addDays(today, -4) }),
  tk("t3", "s1", "Rough Grade South Yard", -3, 2, "r1", "l2", 0, { status: "in_progress", promised_end: addDays(today, -2) }),
  tk("t4", "s1", "Trench & Duct Bank", -1, 2, "r3", "l3", 2, { status: "promised", promised_end: addDays(today, 0) }),
  // Future zone
  tk("t5", "s1", "Place Granular Base", 3, 5, "r1", "l1", 0),
  tk("t6", "s1", "Hydro Service Pull", 8, 3, "r3", "l1", 1, { roadblock: true, roadblock_note: "Waiting on BC Hydro" }),
  tk("t7", "s1", "Install Watermain", 12, 7, "r2", "l2", 2),
  tk("t8", "s1", "Curb & Gutter", 22, 5, "r5", "l3", 0),
  tk("t9", "s2", "Night Compaction Passes", -4, 2, "r1", "l1", 0, { status: "done_early", promised_end: addDays(today, -2) }),
  tk("t10", "s2", "Street Light Bases", 5, 4, "r3", "l3", 0),
  tk("t11", "s2", "Sanitary Tie-ins", 15, 6, "r2", "l2", 1),
  tk("t12", "s2", "Base Paving Lift 1", 29, 5, "r5", "l3", 0),
  // Tray
  tk("t13", "s1", "Fence Relocation", null, 2, "r1", "l1", 0),
  tk("t14", "s1", "Site Trailer Setup", null, 1, "r4", "l2", 0),
];

const deps: PullTicketDep[] = [
  { ticket_id: "t5", predecessor_id: "t3" },
  { ticket_id: "t7", predecessor_id: "t5" },
  { ticket_id: "t8", predecessor_id: "t7" },
  { ticket_id: "t12", predecessor_id: "t8" },
  { ticket_id: "t6", predecessor_id: "t5" }, // out of sequence: t6 starts before t5 ends
];

const milestones: PullMilestone[] = [
  { id: "m1", label: "Ready for Paving", date: addDays(today, 27), lane_id: "s1", row_index: 0 },
  { id: "m2", label: "Substantial Completion", date: null, lane_id: null, row_index: 0 },
];

const msLinks: PullMilestoneLink[] = [
  { id: "ml1", ticket_id: "t8", milestone_id: "m1", ticket_is_pred: true }, // curb & gutter → milestone (violated → red)
];

export default function PullPlanPreview() {
  return (
    <div className="p-4">
      <PullPlanBoard
        initialLanes={lanes}
        initialTickets={tickets}
        initialMilestones={milestones}
        initialRoles={roles}
        initialDeps={deps}
        initialMsLinks={msLinks}
        initialLocations={locations}
        initialActiveDate={today}
        members={members}
        currentUserId={ME}
        isAdmin={true}
      />
    </div>
  );
}
