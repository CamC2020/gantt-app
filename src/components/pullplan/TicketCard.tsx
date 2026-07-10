"use client";

import type { Profile, PullTicket, PullLocation, PullRole, PullTicketStatus } from "@/lib/supabase/types";
import { addDays, addWorkingDays, diffInDays, parseISODate } from "@/lib/date";

export const TICKET_H = 78;

export const STATUS_LABEL: Record<PullTicketStatus, string> = {
  planned: "Planned",
  promised: "Promised",
  in_progress: "In Progress",
  done_early: "Done — Early",
  done_ontime: "Done — On Time",
  done_late: "Done — Late",
};

const NO_HOLIDAYS = new Set<string>();

// End date = start + (duration-1) WORKING days; weekends skipped unless the
// ticket has work_sat / work_sun enabled.
export function ticketEnd(t: PullTicket): string | null {
  if (!t.start_date) return null;
  return addWorkingDays(t.start_date, Math.max(0, t.duration - 1), t.work_sat, t.work_sun, NO_HOLIDAYS);
}

export default function TicketCard({
  t, role, location, responsible, width, height, dayW, hid = false, connectFrom = false, compact = false,
  outOfSeq = false, onToggleWeekend,
}: {
  t: PullTicket;
  role: PullRole | undefined;
  location: PullLocation | undefined;
  responsible: Profile | undefined;
  width?: number;
  height?: number;        // zoom-scaled ticket height
  dayW?: number;          // active-zone pixels-per-day, for exact weekend-box alignment
  hid?: boolean;          // filtered out — render grayed "(hid)" style
  connectFrom?: boolean;  // highlighted as the source in connect mode
  compact?: boolean;      // tray rendering
  outOfSeq?: boolean;     // starts before a predecessor finishes — red trim
  onToggleWeekend?: (dow: 0 | 6) => void; // click a weekend day-box to make it a workday
}) {
  const bodyColor = hid ? "#c8cdd3" : role?.color ?? "#9aa2ab";
  const stripColor = hid ? "#a8adb4" : location?.color ?? "#6b7280";
  const end = ticketEnd(t);
  const respName = responsible?.full_name?.split(" ")[0] || responsible?.email.split("@")[0] || "";

  // Calendar days spanned (for the workday boxes strip)
  const spanDays: { date: string; dow: number; working: boolean }[] = [];
  if (t.start_date && end && !compact) {
    const n = diffInDays(t.start_date, end) + 1;
    for (let i = 0; i < n && i < 60; i++) {
      const d = addDays(t.start_date, i);
      const dow = parseISODate(d).getDay();
      const working = dow === 6 ? t.work_sat : dow === 0 ? t.work_sun : true;
      spanDays.push({ date: d, dow, working });
    }
  }
  // Clip the box count to the ticket's own rendered width — a ticket's bar is
  // visually clipped at the active line even though its real duration runs
  // longer, and the box strip must stop there too instead of overflowing into
  // the inactive zone.
  const visibleDays = dayW ? Math.min(spanDays.length, Math.max(0, Math.floor((width ?? 0) / dayW))) : 0;
  const boxDays = spanDays.slice(0, visibleDays);
  const showBoxes = boxDays.length > 1 && (width ?? 0) >= 40 && !!dayW && boxDays.some(d => d.dow === 0 || d.dow === 6);
  const h = height ?? (compact ? 74 : TICKET_H);

  // Text scales with the card's height so it stays readable at any zoom level —
  // floor is high enough to stay legible rather than shrinking to nothing, and
  // the name itself is never clipped/truncated (wraps and can overflow the box
  // instead of being cut off), so it's always visible whether zoomed in or out.
  const descFont = Math.max(10, Math.round(h * 0.2));
  // Kept proportional to h (no high floor) so the strip stays visually thin at
  // small zoom instead of dominating the card once the rest of it shrinks.
  const tagH = Math.max(5, Math.min(18, Math.round(h * 0.12)));
  const tagFont = Math.max(6, Math.min(11, Math.round(tagH * 0.75)));

  return (
    <div
      className="flex h-full select-none flex-col overflow-visible rounded-none"
      style={{
        width: width ?? (compact ? 130 : undefined),
        height: h,
        backgroundColor: bodyColor,
        boxShadow: connectFrom
          ? "0 0 0 3px #1A3560, 0 2px 5px rgba(0,0,0,.3)"
          : outOfSeq
            ? "0 0 0 3px #dc2626, 0 2px 5px rgba(0,0,0,.3)"
            : "0 1px 3px rgba(0,0,0,.35)",
        opacity: hid ? 0.6 : 1,
        position: "relative",
      }}
      title={`${t.description}${respName ? ` — ${respName}` : ""} · ${STATUS_LABEL[t.status]}${location ? ` · ${location.name}` : ""}${t.roadblock ? ` · 🚧 ${t.roadblock_note}` : ""}`}
    >
      {/* Workday boxes strip — positioned with the SAME per-day pixel width as the
          grid (dayW), not stretched evenly, so boxes land exactly over their day
          regardless of the ticket's own rendered width/margins. */}
      {showBoxes && (
        <div className="absolute -top-[7px] left-0" style={{ height: 5, width: boxDays.length * dayW! }}>
          {boxDays.map((d, i) => (
            <div key={d.date}
              className={`absolute ${d.dow === 0 || d.dow === 6 ? "cursor-pointer" : ""}`}
              title={d.dow === 6 ? `Saturday — ${d.working ? "workday (click to remove)" : "not a workday (click to work it)"}`
                : d.dow === 0 ? `Sunday — ${d.working ? "workday (click to remove)" : "not a workday (click to work it)"}`
                : d.date}
              onPointerDown={e => {
                if ((d.dow === 0 || d.dow === 6) && onToggleWeekend) {
                  e.stopPropagation();
                  e.preventDefault();
                  onToggleWeekend(d.dow as 0 | 6);
                }
              }}
              style={{
                left: i * dayW!,
                width: dayW! - 2,
                top: 0, height: 5,
                borderRadius: 1,
                // Boxes only appear over weekend days; weekday slots stay invisible
                backgroundColor: d.dow === 0 || d.dow === 6
                  ? (d.working ? (hid ? "#9aa2ab" : "#16a34a") : "rgba(0,0,0,.28)")
                  : "transparent",
                border: d.dow === 0 || d.dow === 6 ? "1px solid rgba(0,0,0,.3)" : "none",
              }} />
          ))}
        </div>
      )}

      {/* Out-of-sequence badge */}
      {outOfSeq && (
        <span className="absolute -bottom-1.5 -right-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white shadow"
          title="Out of sequence — starts before a predecessor finishes">!</span>
      )}

      {/* Location tag strip */}
      <div className="flex shrink-0 items-center px-1" style={{ backgroundColor: stripColor, height: tagH }}>
        <span className="truncate font-bold leading-none text-white" style={{ fontSize: tagFont }}>
          {hid ? `(hid) ${location?.name ?? ""}` : location?.name ?? ""}
        </span>
      </div>

      {/* Task name only — left-aligned, vertically centered, never clipped */}
      <div className="flex flex-1 items-center overflow-visible px-1.5 text-left font-bold leading-[1.15] text-white"
        style={{ textShadow: "0 1px 1px rgba(0,0,0,.25)", fontSize: descFont }}>
        {t.description}
      </div>
    </div>
  );
}
