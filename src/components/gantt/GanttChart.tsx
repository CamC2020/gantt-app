"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { addDays, diffInDays, formatISODate, parseISODate } from "@/lib/date";
import type { Profile, Task } from "@/lib/supabase/types";

interface GanttChartProps {
  projectId: string;
  initialTasks: Task[];
  members: Profile[];
  readOnly?: boolean;
}

const DAY_WIDTH = 32; // px per day
const ROW_HEIGHT = 44; // px per task row
const PADDING_DAYS = 3; // extra days of breathing room on either side

type DragMode = "move" | "resize-start" | "resize-end";

interface DragState {
  taskId: string;
  mode: DragMode;
  startX: number;
  originalStart: string;
  originalEnd: string;
}

function initials(profile: Profile | undefined): string {
  if (!profile) return "?";
  const name = profile.full_name?.trim() || profile.email;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

const STATUS_COLOR: Record<Task["status"], string> = {
  not_started: "bg-zinc-400",
  in_progress: "bg-blue-500",
  done: "bg-emerald-500",
};

export default function GanttChart({
  projectId,
  initialTasks,
  members,
  readOnly = false,
}: GanttChartProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  // This client uses lazy session initialization: the session isn't loaded
  // until the first call to getSession()/getUser(). Without forcing that
  // here, the first drag's update() can run before hydration completes and
  // gets silently rejected by RLS (no error surfaced, optimistic UI looks
  // fine, but nothing is actually persisted).
  useEffect(() => {
    supabase.auth.getSession();
  }, [supabase]);

  // `initialTasks` is a new array each time the parent Server Component
  // re-fetches after a create/edit/delete (via revalidatePath), but
  // useState only consumes its initial value once. Sync local state so
  // task changes show up without a full page reload, as long as we're
  // not mid-drag (which manages `tasks` optimistically itself).
  useEffect(() => {
    if (!dragState) {
      setTasks(initialTasks);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTasks]);

  const membersById = useMemo(() => {
    const map = new Map<string, Profile>();
    for (const member of members) map.set(member.id, member);
    return map;
  }, [members]);

  const { rangeStart, totalDays } = useMemo(() => {
    if (tasks.length === 0) {
      const today = formatISODate(new Date());
      return { rangeStart: addDays(today, -PADDING_DAYS), totalDays: 30 };
    }
    let minStart = tasks[0].start_date;
    let maxEnd = tasks[0].end_date;
    for (const task of tasks) {
      if (task.start_date < minStart) minStart = task.start_date;
      if (task.end_date > maxEnd) maxEnd = task.end_date;
    }
    const rangeStart = addDays(minStart, -PADDING_DAYS);
    const rangeEnd = addDays(maxEnd, PADDING_DAYS);
    const totalDays = Math.max(diffInDays(rangeStart, rangeEnd) + 1, 14);
    return { rangeStart, totalDays };
  }, [tasks]);

  const days = useMemo(() => {
    const list: { date: string; label: string; isMonthStart: boolean; isWeekend: boolean }[] = [];
    for (let i = 0; i < totalDays; i++) {
      const date = addDays(rangeStart, i);
      const d = parseISODate(date);
      list.push({
        date,
        label: String(d.getDate()),
        isMonthStart: d.getDate() === 1 || i === 0,
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
      });
    }
    return list;
  }, [rangeStart, totalDays]);

  const monthLabels = useMemo(() => {
    const labels: { offset: number; label: string }[] = [];
    let lastMonth = "";
    days.forEach((day, index) => {
      const d = parseISODate(day.date);
      const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
      if (monthKey !== lastMonth) {
        lastMonth = monthKey;
        labels.push({
          offset: index,
          label: d.toLocaleDateString(undefined, { month: "short", year: "numeric" }),
        });
      }
    });
    return labels;
  }, [days]);

  const chartWidth = totalDays * DAY_WIDTH;

  function dayOffset(date: string): number {
    return diffInDays(rangeStart, date);
  }

  function handlePointerDown(
    event: React.PointerEvent<HTMLDivElement>,
    task: Task,
    mode: DragMode
  ) {
    if (readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    setDragState({
      taskId: task.id,
      mode,
      startX: event.clientX,
      originalStart: task.start_date,
      originalEnd: task.end_date,
    });
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragState) return;
    const deltaX = event.clientX - dragState.startX;
    const deltaDays = Math.round(deltaX / DAY_WIDTH);
    if (deltaDays === 0) return;

    setTasks((prev) =>
      prev.map((task) => {
        if (task.id !== dragState.taskId) return task;

        if (dragState.mode === "move") {
          return {
            ...task,
            start_date: addDays(dragState.originalStart, deltaDays),
            end_date: addDays(dragState.originalEnd, deltaDays),
          };
        }

        if (dragState.mode === "resize-start") {
          const newStart = addDays(dragState.originalStart, deltaDays);
          if (newStart > task.end_date) return task;
          return { ...task, start_date: newStart };
        }

        // resize-end
        const newEnd = addDays(dragState.originalEnd, deltaDays);
        if (newEnd < task.start_date) return task;
        return { ...task, end_date: newEnd };
      })
    );
  }

  async function handlePointerUp() {
    if (!dragState) return;
    const task = tasks.find((t) => t.id === dragState.taskId);
    const dragged = dragState;
    setDragState(null);
    if (!task) return;

    const changed =
      task.start_date !== dragged.originalStart ||
      task.end_date !== dragged.originalEnd;
    if (!changed) return;

    const revert = () =>
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? { ...t, start_date: dragged.originalStart, end_date: dragged.originalEnd }
            : t
        )
      );

    try {
      await supabase.auth.getSession();
      const { error: updateError } = await supabase
        .from("tasks")
        .update({ start_date: task.start_date, end_date: task.end_date })
        .eq("id", task.id);

      if (updateError) {
        setError(updateError.message);
        revert();
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save task dates.");
      revert();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <div
          ref={containerRef}
          className="relative select-none"
          style={{ width: chartWidth + 200 }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* Header: month labels + day grid */}
          <div className="flex border-b border-zinc-200">
            <div className="sticky left-0 z-10 w-[200px] shrink-0 border-r border-zinc-200 bg-zinc-50" />
            <div className="relative" style={{ width: chartWidth, height: 28 }}>
              {monthLabels.map((m) => (
                <div
                  key={`${m.offset}-${m.label}`}
                  className="absolute top-0 truncate text-xs font-medium text-zinc-600"
                  style={{ left: m.offset * DAY_WIDTH + 4 }}
                >
                  {m.label}
                </div>
              ))}
            </div>
          </div>
          <div className="flex border-b border-zinc-200">
            <div className="sticky left-0 z-10 w-[200px] shrink-0 border-r border-zinc-200 bg-zinc-50" />
            <div className="flex" style={{ width: chartWidth }}>
              {days.map((day) => (
                <div
                  key={day.date}
                  className={`flex h-7 shrink-0 items-center justify-center border-r border-zinc-100 text-[10px] ${
                    day.isWeekend ? "bg-zinc-50 text-zinc-400" : "text-zinc-500"
                  }`}
                  style={{ width: DAY_WIDTH }}
                >
                  {day.label}
                </div>
              ))}
            </div>
          </div>

          {/* Rows */}
          {tasks.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-zinc-400">
              No tasks yet — create one to see it on the timeline.
            </div>
          ) : (
            tasks.map((task) => {
              const assignee = membersById.get(task.assignee_id ?? "");
              const left = dayOffset(task.start_date) * DAY_WIDTH;
              const width = (diffInDays(task.start_date, task.end_date) + 1) * DAY_WIDTH;

              return (
                <div
                  key={task.id}
                  className="flex border-b border-zinc-100"
                  style={{ height: ROW_HEIGHT }}
                >
                  <div className="sticky left-0 z-10 flex w-[200px] shrink-0 items-center border-r border-zinc-200 bg-white px-3">
                    <span className="truncate text-sm text-zinc-700">{task.title}</span>
                  </div>
                  <div className="relative" style={{ width: chartWidth }}>
                    {/* weekend background stripes */}
                    <div className="absolute inset-0 flex">
                      {days.map((day) => (
                        <div
                          key={day.date}
                          className={day.isWeekend ? "bg-zinc-50" : ""}
                          style={{ width: DAY_WIDTH, height: ROW_HEIGHT }}
                        />
                      ))}
                    </div>

                    <div
                      className={`group absolute top-1/2 flex -translate-y-1/2 items-center gap-2 rounded-md px-2 text-xs font-medium text-white shadow-sm ${STATUS_COLOR[task.status]}`}
                      style={{ left, width, height: 28, cursor: "grab" }}
                      onPointerDown={(event) => handlePointerDown(event, task, "move")}
                      title={`${task.title} (${task.start_date} → ${task.end_date})`}
                    >
                      <div
                        className="absolute left-0 top-0 h-full w-2 cursor-ew-resize rounded-l-md bg-black/10 opacity-0 group-hover:opacity-100"
                        onPointerDown={(event) =>
                          handlePointerDown(event, task, "resize-start")
                        }
                      />
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/25 text-[10px]">
                        {initials(assignee)}
                      </span>
                      <span className="truncate">{task.title}</span>
                      <div
                        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize rounded-r-md bg-black/10 opacity-0 group-hover:opacity-100"
                        onPointerDown={(event) =>
                          handlePointerDown(event, task, "resize-end")
                        }
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      <p className="text-xs text-zinc-400">
        Drag a bar to move it, or drag its edges to resize. Changes save automatically.
      </p>
    </div>
  );
}
