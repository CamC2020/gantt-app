"use client";

import type { Profile, PullTicket, PullLocation, PullRole, PullTicketStatus } from "@/lib/supabase/types";
import { addDays, parseISODate } from "@/lib/date";

export const TICKET_H = 78;

export const STATUS_LABEL: Record<PullTicketStatus, string> = {
  planned: "Planned",
  promised: "Promised",
  in_progress: "In Progress",
  done_early: "Done — Early",
  done_ontime: "Done — On Time",
  done_late: "Done — Late",
};

const DONE_PIN: Partial<Record<PullTicketStatus, string>> = {
  done_early: "#16a34a",  // finished early = green pin
  done_ontime: "#2563eb", // on time = blue pin
  done_late: "#dc2626",   // late = red pin
};

export function ticketEnd(t: PullTicket): string | null {
  if (!t.start_date) return null;
  return addDays(t.start_date, Math.max(0, t.duration - 1));
}

function fmtShort(iso: string) {
  return parseISODate(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

export default function TicketCard({
  t, role, location, responsible, width, hid = false, connectFrom = false, compact = false,
}: {
  t: PullTicket;
  role: PullRole | undefined;
  location: PullLocation | undefined;
  responsible: Profile | undefined;
  width?: number;
  hid?: boolean;          // filtered out — render grayed "(hid)" style
  connectFrom?: boolean;  // highlighted as the source in connect mode
  compact?: boolean;      // tray rendering
}) {
  const bodyColor = hid ? "#c8cdd3" : role?.color ?? "#9aa2ab";
  const stripColor = hid ? "#a8adb4" : location?.color ?? "#6b7280";
  const isDone = t.status.startsWith("done_");
  const pin = DONE_PIN[t.status];
  const end = ticketEnd(t);
  const respName = responsible?.full_name?.split(" ")[0] || responsible?.email.split("@")[0] || "";

  return (
    <div
      className="flex h-full select-none flex-col overflow-hidden rounded-[2px]"
      style={{
        width: width ?? (compact ? 130 : undefined),
        height: compact ? 74 : TICKET_H,
        backgroundColor: bodyColor,
        boxShadow: connectFrom
          ? "0 0 0 3px #1A3560, 0 2px 5px rgba(0,0,0,.3)"
          : "0 1px 3px rgba(0,0,0,.35)",
        opacity: hid ? 0.6 : 1,
      }}
      title={`${t.description}${respName ? ` — ${respName}` : ""} · ${STATUS_LABEL[t.status]}${t.roadblock ? ` · 🚧 ${t.roadblock_note}` : ""}`}
    >
      {/* Location tag strip */}
      <div className="flex h-[14px] shrink-0 items-center justify-between px-1" style={{ backgroundColor: stripColor }}>
        <span className="truncate text-[8px] font-bold leading-none text-white">
          {hid ? `(hid) ${location?.name ?? ""}` : location?.name ?? ""}
        </span>
        <span className="flex items-center gap-0.5 leading-none">
          {t.roadblock && <span className="text-[9px]" title={t.roadblock_note || "Roadblock"}>🚧</span>}
          {(t.status === "promised" || t.status === "in_progress") && (
            <span className="inline-block h-2 w-2 rounded-full border border-white bg-zinc-900" title={`Promised: ${t.promised_end ?? ""}`} />
          )}
          {isDone && pin && (
            <span className="inline-block h-2 w-2 rounded-full border border-white" style={{ backgroundColor: pin }}
              title={STATUS_LABEL[t.status]} />
          )}
        </span>
      </div>

      {/* Date line */}
      {t.start_date && !compact && (
        <div className="px-1 pt-px text-[8px] font-semibold leading-tight text-black/60">
          {fmtShort(t.start_date)}{end && end !== t.start_date ? ` – ${fmtShort(end)}` : ""}
        </div>
      )}

      {/* Description */}
      <div className={`flex-1 overflow-hidden px-1 pt-px text-center text-[10px] font-bold leading-[1.15] text-white ${compact ? "line-clamp-3" : ""}`}
        style={{ textShadow: "0 1px 1px rgba(0,0,0,.25)" }}>
        {t.description}
      </div>

      {/* Footer: crew | duration */}
      <div className="flex shrink-0 items-center justify-between px-1 pb-0.5 text-[9px] font-bold text-white/90">
        <span title="Crew size">{t.crew_size != null ? <>👥 {t.crew_size}</> : respName}</span>
        <span title="Duration (days)">🕐 {t.duration}</span>
      </div>
    </div>
  );
}
