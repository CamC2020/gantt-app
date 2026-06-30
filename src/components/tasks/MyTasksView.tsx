"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Task, TaskNote, TaskStatus } from "@/lib/supabase/types";

interface EnrichedTask extends Task {
  note: string;
  role: "champion" | "assignee" | "support";
  parentTitle: string | null;
  daysUntilEnd: number;
}

interface Props {
  tasks: EnrichedTask[];
  userId: string;
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
  if (days < 0) return "border-l-4 border-red-400 bg-red-50";
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

export default function MyTasksView({ tasks: initialTasks, userId }: Props) {
  const [tasks, setTasks] = useState(initialTasks);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [noteValues, setNoteValues] = useState<Record<string, string>>(
    Object.fromEntries(initialTasks.map(t => [t.id, t.note]))
  );
  const [savingNote, setSavingNote] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const supa = createClient();

  async function updateStatus(taskId: string, status: TaskStatus) {
    setSavingStatus(taskId);
    await supa.from("tasks").update({ status }).eq("id", taskId);
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status } : t));
    setSavingStatus(null);
  }

  async function saveNote(taskId: string) {
    setSavingNote(taskId);
    const content = noteValues[taskId] ?? "";
    await supa.from("task_notes").upsert(
      { task_id: taskId, user_id: userId, content, updated_at: new Date().toISOString() },
      { onConflict: "task_id,user_id" }
    );
    setSavingNote(null);
  }

  const active = tasks.filter(t => t.status !== "done").sort((a, b) => a.daysUntilEnd - b.daysUntilEnd);
  const done = tasks.filter(t => t.status === "done");

  function renderTask(task: EnrichedTask) {
    const expanded = expandedId === task.id;
    const badge = urgencyBadge(task.daysUntilEnd, task.status);

    return (
      <div key={task.id} className={`rounded-lg bg-white shadow-sm ${urgencyStyle(task.daysUntilEnd, task.status)}`}>
        {/* Header row */}
        <button
          className="w-full text-left px-4 py-3 flex items-start gap-3"
          onClick={() => setExpandedId(expanded ? null : task.id)}
        >
          <span className="mt-0.5 text-zinc-400 text-xs w-4 shrink-0">{expanded ? "▼" : "▶"}</span>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-[#1A3560] text-sm leading-snug">{task.title}</span>
              {task.is_milestone && (
                <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-semibold">Milestone</span>
              )}
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                task.role === "champion" ? "bg-purple-100 text-purple-700" :
                task.role === "assignee" ? "bg-blue-100 text-blue-700" :
                "bg-zinc-100 text-zinc-600"
              }`}>
                {task.role === "champion" ? "Champion" : task.role === "assignee" ? "Assignee" : "Supporting"}
              </span>
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
          </div>
          <div className="shrink-0">
            <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${STATUS_STYLES[task.status]}`}>
              {STATUS_LABELS[task.status]}
            </span>
          </div>
        </button>

        {/* Expanded detail panel */}
        {expanded && (
          <div className="px-4 pb-4 border-t border-zinc-100 pt-3 space-y-4">
            {/* Status selector */}
            <div className="flex items-center gap-3">
              <label className="text-xs font-semibold text-zinc-500 w-14 shrink-0">Status</label>
              <div className="flex gap-2">
                {(["not_started", "in_progress", "done"] as TaskStatus[]).map(s => (
                  <button
                    key={s}
                    disabled={savingStatus === task.id}
                    onClick={() => startTransition(() => { updateStatus(task.id, s); })}
                    className={`text-xs px-3 py-1 rounded-full font-medium border transition-colors ${
                      task.status === s
                        ? `${STATUS_STYLES[s]} border-transparent ring-2 ring-offset-1 ring-blue-400`
                        : "bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400"
                    }`}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
              {savingStatus === task.id && <span className="text-xs text-zinc-400">Saving…</span>}
            </div>

            {/* Notes */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-zinc-500">My Notes</label>
              <textarea
                rows={4}
                className="w-full rounded border border-zinc-200 px-3 py-2 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
                placeholder="Add notes, blockers, or updates…"
                value={noteValues[task.id] ?? ""}
                onChange={e => setNoteValues(prev => ({ ...prev, [task.id]: e.target.value }))}
              />
              <div className="flex justify-end">
                <button
                  onClick={() => saveNote(task.id)}
                  disabled={savingNote === task.id}
                  className="text-xs px-3 py-1.5 rounded bg-[#1A3560] text-white hover:bg-[#14294a] disabled:opacity-50 transition-colors"
                >
                  {savingNote === task.id ? "Saving…" : "Save Note"}
                </button>
              </div>
            </div>

            {/* Task metadata */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-zinc-500 border-t border-zinc-100 pt-3">
              <span><span className="font-semibold">Start:</span> {task.start_date}</span>
              <span><span className="font-semibold">Finish:</span> {task.end_date}</span>
              {!task.is_milestone && (
                <span><span className="font-semibold">Duration:</span> {Math.abs(task.daysUntilEnd)}d remaining</span>
              )}
              <span><span className="font-semibold">Works Sat/Sun:</span> {task.work_sat ? "✓" : "—"} / {task.work_sun ? "✓" : "—"}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Active tasks */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
          Active · {active.length}
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-zinc-400 italic">No active tasks assigned to you.</p>
        ) : (
          <div className="space-y-2">{active.map(renderTask)}</div>
        )}
      </section>

      {/* Done tasks (collapsible) */}
      {done.length > 0 && (
        <section>
          <details className="group">
            <summary className="cursor-pointer text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-3 select-none list-none flex items-center gap-2">
              <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
              Completed · {done.length}
            </summary>
            <div className="space-y-2 mt-3">{done.map(renderTask)}</div>
          </details>
        </section>
      )}
    </div>
  );
}
