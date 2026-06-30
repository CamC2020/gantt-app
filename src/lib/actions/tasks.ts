"use server";

import { revalidatePath } from "next/cache";
import { createAuthedClient } from "@/lib/supabase/server";
import type { TaskStatus } from "@/lib/supabase/types";

export interface ActionResult {
  error: string | null;
}

const VALID_STATUSES: TaskStatus[] = ["not_started", "in_progress", "done"];

export async function createTask(
  projectId: string,
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const title = String(formData.get("title") ?? "").trim();
  const startDate = String(formData.get("start_date") ?? "");
  const endDate = String(formData.get("end_date") ?? "");
  const assigneeId = String(formData.get("assignee_id") ?? "").trim();
  const statusRaw = String(formData.get("status") ?? "not_started");
  const status = VALID_STATUSES.includes(statusRaw as TaskStatus)
    ? (statusRaw as TaskStatus)
    : "not_started";

  if (!title || !startDate || !endDate) {
    return { error: "Title, start date, and end date are required." };
  }

  if (startDate > endDate) {
    return { error: "Start date must be before end date." };
  }

  const supabase = await createAuthedClient();
  const { error } = await supabase.from("tasks").insert({
    project_id: projectId,
    title,
    start_date: startDate,
    end_date: endDate,
    assignee_id: assigneeId || null,
    status,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function updateTask(
  taskId: string,
  projectId: string,
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const title = String(formData.get("title") ?? "").trim();
  const startDate = String(formData.get("start_date") ?? "");
  const endDate = String(formData.get("end_date") ?? "");
  const assigneeId = String(formData.get("assignee_id") ?? "").trim();
  const statusRaw = String(formData.get("status") ?? "not_started");
  const status = VALID_STATUSES.includes(statusRaw as TaskStatus)
    ? (statusRaw as TaskStatus)
    : "not_started";

  if (!title || !startDate || !endDate) {
    return { error: "Title, start date, and end date are required." };
  }

  if (startDate > endDate) {
    return { error: "Start date must be before end date." };
  }

  const supabase = await createAuthedClient();
  const { error } = await supabase
    .from("tasks")
    .update({
      title,
      start_date: startDate,
      end_date: endDate,
      assignee_id: assigneeId || null,
      status,
    })
    .eq("id", taskId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function deleteTask(taskId: string, projectId: string): Promise<void> {
  const supabase = await createAuthedClient();
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/projects/${projectId}`);
}

export async function updateTaskDates(
  taskId: string,
  projectId: string,
  startDate: string,
  endDate: string
): Promise<{ error: string | null }> {
  const supabase = await createAuthedClient();
  const { error } = await supabase
    .from("tasks")
    .update({ start_date: startDate, end_date: endDate })
    .eq("id", taskId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}
