"use client";

import { useOptimistic, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Task, TaskStatus } from "@/lib/supabase/types";
import { useTaskSync } from "@/lib/useTaskSync";
import { avatarColor, initials } from "@/lib/people";
import StatusButtons, { STATUS_LABELS, STATUS_STYLES } from "./StatusButtons";

interface Supporter {
  id: string;
  name: string;
}

interface EnrichedTask extends Task {
  note: string;
  role: "champion" | "assignee" | "support";
  parentTitle: string | null;
  daysUntilEnd: number;
  championName: string | null;
  assigneeName: string | null;
  supporters: Supporter[];
}

function PersonPill({ person }: { person: Supporter }) {
  return (
    <span
      title={person.name}
      className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 py-0.5 pl-0.5 pr-2 text-[11px] text-zinc-600"
    >
      <span
        style={{ background: avatarColor(person.id) }}
        className="inline-grid h-4 w-4 place-items-center rounded-full text-[8px] font-bold text-white"
      >
        {initials(person.name)}
      </span>
      {person.name}
    </span>
  );
}

interface Props {
  tasks: EnrichedTask[];
  userId: string;
}

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
  useTaskSync();

  // Server data is authoritative; useOptimistic only carries the in-flight flip
  // until router.refresh() lands the real row.
  const [tasks, setOptimisticStatus] = useOptimistic(
    initialTasks,
    (current, patch: { id: string; status: TaskStatus }) =>
      current.map(t => (t.id === patch.id ? { ...t, status: patch.status } : t))
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [noteValues, setNoteValues] = useState<Record<string, string>>(
    Object.fromEntries(initialTasks.map(t => [t.id, t.note]))
  );
  const [savingNote, setSavingNote] = useState<string | null>(null);

  const supa = createClient();

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
            {task.supporters.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-zinc-400">Support:</span>
                {task.supporters.map(p => <PersonPill key={p.id} person={p} />)}
              </div>
            )}
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
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-semibold text-zinc-500 w-14 shrink-0">Status</label>
              <StatusButtons
                taskId={task.id}
                status={task.status}
                canEdit
                onOptimistic={s => setOptimisticStatus({ id: task.id, status: s })}
              />
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
              {task.championName && (
                <span><span className="font-semibold">Champion:</span> {task.championName}</span>
              )}
              {task.assigneeName && (
                <span><span className="font-semibold">Assignee:</span> {task.assigneeName}</span>
              )}
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
