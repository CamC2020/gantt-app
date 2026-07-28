"use client";

import { useMemo, useOptimistic, useState } from "react";
import type { TaskStatus } from "@/lib/supabase/types";
import { useTaskSync } from "@/lib/useTaskSync";
import { avatarColor, initials } from "@/lib/people";
import { formatShortDate } from "@/lib/date";
import StatusButtons, { STATUS_LABELS, STATUS_STYLES } from "./StatusButtons";

interface Person {
  id: string;
  name: string;
  org: string | null;
}

export interface AllTask {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  status: TaskStatus;
  is_milestone: boolean;
  work_sat: boolean;
  work_sun: boolean;
  subcontractor: string | null;
  ownerId: string | null;
  ownerRole: "champion" | "assignee" | null;
  counterpartId: string | null;
  supporterIds: string[];
  parentTitle: string | null;
  daysUntilEnd: number;
  canEdit: boolean;
}

interface Props {
  tasks: AllTask[];
  people: Person[];
  directory: Record<string, Person>;
  currentUserId: string;
}

const UNASSIGNED = "__unassigned__";

type Urgency = "done" | "late" | "soon" | "near" | "calm";

function urgencyOf(t: AllTask): Urgency {
  if (t.status === "done") return "done";
  if (t.daysUntilEnd < 0) return "late";
  if (t.daysUntilEnd <= 1) return "soon";
  if (t.daysUntilEnd <= 5) return "near";
  return "calm";
}

const DOT: Record<Urgency, string> = {
  done: "bg-green-600",
  late: "bg-red-500",
  soon: "bg-red-500",
  near: "bg-amber-500",
  calm: "bg-zinc-300",
};

function dueLabel(t: AllTask) {
  const d = t.daysUntilEnd;
  const on = formatShortDate(t.end_date);
  if (t.status === "done") return { text: `Closed ${on}`, tone: "text-zinc-400" };
  if (d < 0) return { text: `${Math.abs(d)}d overdue · was ${on}`, tone: "text-red-600 font-semibold" };
  if (d === 0) return { text: "Due today", tone: "text-red-600 font-semibold" };
  if (d === 1) return { text: "Due tomorrow", tone: "text-red-600 font-semibold" };
  if (d <= 5) return { text: `Due in ${d}d · ${on}`, tone: "text-amber-600 font-semibold" };
  return { text: `Due in ${d}d · ${on}`, tone: "text-zinc-400" };
}

function Avatar({ person, size = 22 }: { person: Person; size?: number }) {
  return (
    <span
      title={person.org ? `${person.name} — ${person.org}` : person.name}
      style={{ background: avatarColor(person.id), width: size, height: size }}
      className="inline-grid place-items-center rounded-full text-[9px] font-bold text-white shrink-0"
    >
      {initials(person.name)}
    </span>
  );
}

export default function AllTasksView({ tasks: serverTasks, people, directory, currentUserId }: Props) {
  useTaskSync();

  // Server data is the source of truth. useOptimistic layers the in-flight flip
  // on top and drops it once fresh props arrive — so a change made on My Tasks
  // (or by a teammate) always wins over a local guess.
  const [tasks, setOptimisticStatus] = useOptimistic(
    serverTasks,
    (current, patch: { id: string; status: TaskStatus }) =>
      current.map(t => (t.id === patch.id ? { ...t, status: patch.status } : t))
  );

  const [personFilter, setPersonFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "done" | "all">("active");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter(t => {
      if (personFilter === "mine") {
        const involved =
          t.ownerId === currentUserId ||
          t.counterpartId === currentUserId ||
          t.supporterIds.includes(currentUserId);
        if (!involved) return false;
      } else if (personFilter !== "all") {
        const involved =
          t.ownerId === personFilter ||
          t.counterpartId === personFilter ||
          t.supporterIds.includes(personFilter);
        if (!involved) return false;
      }
      if (statusFilter === "active" && t.status === "done") return false;
      if (statusFilter === "done" && t.status !== "done") return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasks, personFilter, statusFilter, search, currentUserId]);

  const groups = useMemo(() => {
    const byOwner = new Map<string, AllTask[]>();
    for (const t of filtered) {
      const key = t.ownerId ?? UNASSIGNED;
      const list = byOwner.get(key) ?? [];
      list.push(t);
      byOwner.set(key, list);
    }

    const built = [...byOwner.entries()].map(([key, list]) => {
      const sorted = [...list].sort((a, b) => {
        // Done sinks; otherwise soonest deadline first.
        if ((a.status === "done") !== (b.status === "done")) return a.status === "done" ? 1 : -1;
        return a.daysUntilEnd - b.daysUntilEnd;
      });
      const active = sorted.filter(t => t.status !== "done");
      return {
        key,
        person: key === UNASSIGNED ? null : directory[key] ?? null,
        tasks: sorted,
        activeCount: active.length,
        lateCount: active.filter(t => t.daysUntilEnd < 0).length,
      };
    });

    // Whoever is most on the hook floats up; unassigned work sinks to the
    // bottom, where it reads as the loose end it is.
    return built.sort((a, b) => {
      if ((a.key === UNASSIGNED) !== (b.key === UNASSIGNED)) return a.key === UNASSIGNED ? 1 : -1;
      if (b.lateCount !== a.lateCount) return b.lateCount - a.lateCount;
      if (b.activeCount !== a.activeCount) return b.activeCount - a.activeCount;
      return (a.person?.name ?? "").localeCompare(b.person?.name ?? "");
    });
  }, [filtered, directory]);

  function renderCard(task: AllTask) {
    const urgency = urgencyOf(task);
    const due = dueLabel(task);
    const counterpart = task.counterpartId ? directory[task.counterpartId] : null;
    const supporters = task.supporterIds.map(id => directory[id]).filter(Boolean);

    return (
      <article
        key={task.id}
        className={`flex flex-col gap-2.5 rounded-xl bg-white p-4 shadow-sm transition-shadow hover:shadow-md ${
          task.status === "done" ? "opacity-70" : ""
        }`}
      >
        <div className="flex items-start gap-2.5">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[urgency]}`} />
          <h4 className="flex-1 text-[13.5px] font-semibold leading-snug text-[#1A3560]">
            {task.title}
          </h4>
          {task.is_milestone && (
            <span className="shrink-0 rounded border border-amber-500 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-amber-600">
              Milestone
            </span>
          )}
        </div>

        {task.parentTitle && (
          <p className="-mt-1 text-[11px] text-zinc-400">Under: {task.parentTitle}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-zinc-500">
          <span className={`font-mono tabular-nums ${due.tone}`}>{due.text}</span>
          <span className="font-mono tabular-nums text-zinc-400">
            {formatShortDate(task.start_date)} → {formatShortDate(task.end_date)}
          </span>
        </div>

        {(counterpart || task.subcontractor) && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
            {counterpart && (
              <span className="inline-flex items-center gap-1.5">
                <Avatar person={counterpart} size={18} />
                {counterpart.name}
                <span className="text-zinc-400">· assignee</span>
              </span>
            )}
            {task.subcontractor && (
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">
                {task.subcontractor}
              </span>
            )}
          </div>
        )}

        {/* Footer: status on the left, support stacked into the bottom-right
            corner per SK-01 — mt-auto pins it to the card's base so the corner
            stays put however tall the card grows. */}
        <div className="mt-auto flex items-end justify-between gap-3 border-t border-zinc-100 pt-2.5">
          {task.canEdit ? (
            <StatusButtons
              taskId={task.id}
              status={task.status}
              canEdit
              onOptimistic={s => setOptimisticStatus({ id: task.id, status: s })}
            />
          ) : (
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${STATUS_STYLES[task.status]}`}>
                {STATUS_LABELS[task.status]}
              </span>
              <span className="text-[11px] italic text-zinc-400">View only</span>
            </div>
          )}

          {supporters.length > 0 && (
            <div
              className="flex shrink-0 flex-col items-end gap-1"
              title={`Support: ${supporters.map(p => p.name).join(", ")}`}
            >
              <span className="text-[9.5px] uppercase tracking-wide text-zinc-400">Support</span>
              <span className="flex -space-x-1.5">
                {supporters.slice(0, 4).map(p => (
                  <span key={p.id} className="rounded-full ring-2 ring-white">
                    <Avatar person={p} size={20} />
                  </span>
                ))}
                {supporters.length > 4 && (
                  <span className="inline-grid h-5 w-5 place-items-center rounded-full bg-zinc-200 text-[9px] font-bold text-zinc-600 ring-2 ring-white">
                    +{supporters.length - 4}
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      </article>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-sm">
        <select
          value={personFilter}
          onChange={e => setPersonFilter(e.target.value)}
          className="rounded border border-zinc-200 px-2 py-1.5 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="all">Everyone</option>
          <option value="mine">Just me</option>
          {people.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}{p.org ? ` — ${p.org}` : ""}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          {(["active", "done", "all"] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === s
                  ? "border-transparent bg-[#1A3560] text-white"
                  : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-400"
              }`}
            >
              {s === "active" ? "Active" : s === "done" ? "Done" : "All"}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Search tasks…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="ml-auto w-48 rounded border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />

        <span className="font-mono text-xs tabular-nums text-zinc-400">
          {filtered.length} task{filtered.length === 1 ? "" : "s"} · {groups.length} {groups.length === 1 ? "person" : "people"}
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="px-1 text-sm italic text-zinc-400">No tasks match these filters.</p>
      ) : (
        groups.map(group => (
          <section key={group.key} className="flex flex-col gap-2.5">
            <header className="flex items-center gap-2.5 rounded-lg bg-[#1A3560] px-3 py-2 text-white">
              {group.person ? (
                <Avatar person={group.person} />
              ) : (
                <span className="inline-grid h-[22px] w-[22px] place-items-center rounded-full bg-red-500 text-[11px] font-bold">
                  !
                </span>
              )}
              <span className="text-[13px] font-semibold">
                {group.person?.name ?? "Unassigned"}
              </span>
              {group.person?.org && (
                <span className="text-[11px] text-blue-200">{group.person.org}</span>
              )}
              <span className="ml-auto font-mono text-[10.5px] uppercase tracking-wider text-blue-200">
                {group.activeCount} active
                {group.lateCount > 0 && (
                  <span className="font-bold text-red-300"> · {group.lateCount} late</span>
                )}
              </span>
            </header>

            {/* Cards stretch to a common row height so every footer — and so
                every support cluster — lines up along the same baseline. */}
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {group.tasks.map(renderCard)}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
