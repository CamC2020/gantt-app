"use client";

import { useMemo, useState } from "react";
import type { Task, TaskStatus } from "@/lib/supabase/types";

interface EnrichedTask extends Task {
  championName: string | null;
  assigneeName: string | null;
  supportNames: string[];
  parentTitle: string | null;
  daysUntilEnd: number;
}

interface Props {
  tasks: EnrichedTask[];
  people: string[];
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  done: "Done",
};

const STATUS_STYLES: Record<TaskStatus, string> = {
  not_started: "bg-zinc-100 text-zinc-600",
  in_progress: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
};

function urgencyStyle(days: number, status: TaskStatus) {
  if (status === "done") return "border-l-4 border-green-300";
  if (days <= 1) return "border-l-4 border-red-400 bg-red-50";
  if (days <= 5) return "border-l-4 border-amber-400 bg-amber-50";
  return "border-l-4 border-zinc-200";
}

function urgencyBadge(days: number, status: TaskStatus) {
  if (status === "done") return null;
  if (days < 0) return <span className="text-xs font-semibold text-red-600">{Math.abs(days)}d overdue</span>;
  if (days === 0) return <span className="text-xs font-semibold text-red-600">Due today</span>;
  if (days === 1) return <span className="text-xs font-semibold text-red-600">Due tomorrow</span>;
  if (days <= 5) return <span className="text-xs font-semibold text-amber-600">Due in {days}d</span>;
  return null;
}

function taskPeople(task: EnrichedTask): string[] {
  return [task.championName, task.assigneeName, ...task.supportNames].filter((n): n is string => !!n);
}

export default function AllTasksView({ tasks, people }: Props) {
  const [personFilter, setPersonFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "done" | "all">("active");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter(t => {
      if (personFilter !== "all" && !taskPeople(t).includes(personFilter)) return false;
      if (statusFilter === "active" && t.status === "done") return false;
      if (statusFilter === "done" && t.status !== "done") return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasks, personFilter, statusFilter, search]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => a.daysUntilEnd - b.daysUntilEnd),
    [filtered]
  );

  function renderTask(task: EnrichedTask) {
    const badge = urgencyBadge(task.daysUntilEnd, task.status);

    return (
      <div key={task.id} className={`rounded-lg bg-white shadow-sm px-4 py-3 ${urgencyStyle(task.daysUntilEnd, task.status)}`}>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-[#1A3560] text-sm leading-snug">{task.title}</span>
              {task.is_milestone && (
                <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-semibold">Milestone</span>
              )}
              {badge}
            </div>
            {task.parentTitle && (
              <p className="text-[11px] text-zinc-400 mt-0.5">Under: {task.parentTitle}</p>
            )}
            <div className="flex flex-wrap gap-3 mt-1 text-[11px] text-zinc-500">
              <span>Start: <span className="font-mono">{task.start_date}</span></span>
              <span>End: <span className="font-mono">{task.end_date}</span></span>
              {!task.is_milestone && <span>{task.daysUntilEnd < 0 ? `${Math.abs(task.daysUntilEnd)}d past` : `${task.daysUntilEnd}d remaining`}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {task.championName && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-purple-100 text-purple-700">
                  Champion: {task.championName}
                </span>
              )}
              {task.assigneeName && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-blue-100 text-blue-700">
                  Assignee: {task.assigneeName}
                </span>
              )}
              {task.supportNames.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-zinc-100 text-zinc-600">
                  Support: {task.supportNames.join(", ")}
                </span>
              )}
              {!task.championName && !task.assigneeName && task.supportNames.length === 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-red-100 text-red-600">
                  Unassigned
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0">
            <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${STATUS_STYLES[task.status]}`}>
              {STATUS_LABELS[task.status]}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-white shadow-sm px-4 py-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-zinc-500">Person</label>
          <select
            value={personFilter}
            onChange={e => setPersonFilter(e.target.value)}
            className="text-sm rounded border border-zinc-200 px-2 py-1 text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <option value="all">Everyone</option>
            {people.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          {(["active", "done", "all"] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-xs px-3 py-1 rounded-full font-medium border transition-colors ${
                statusFilter === s
                  ? "bg-[#1A3560] text-white border-transparent"
                  : "bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400"
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
          className="ml-auto text-sm rounded border border-zinc-200 px-3 py-1.5 text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-400 w-48"
        />

        <span className="text-xs text-zinc-400">{sorted.length} task{sorted.length === 1 ? "" : "s"}</span>
      </div>

      {/* Task list */}
      {sorted.length === 0 ? (
        <p className="text-sm text-zinc-400 italic px-1">No tasks match these filters.</p>
      ) : (
        <div className="space-y-2">{sorted.map(renderTask)}</div>
      )}
    </div>
  );
}
