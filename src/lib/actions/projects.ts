"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, createAuthedClient } from "@/lib/supabase/server";

export interface ActionResult {
  error: string | null;
}

export async function createProject(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!name) {
    return { error: "Name is required." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You must be logged in." };

  const authed = await createAuthedClient();
  const id = crypto.randomUUID();

  const { error: insertError } = await authed.from("projects").insert({
    id,
    name,
    description: description || null,
    owner_id: user.id,
  });

  if (insertError) return { error: insertError.message };

  revalidatePath("/sub-schedules");
  redirect(`/sub-schedules/${id}`);
}

export async function updateProject(
  projectId: string,
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!name) return { error: "Name is required." };

  const authed = await createAuthedClient();
  const { error } = await authed
    .from("projects")
    .update({ name, description: description || null })
    .eq("id", projectId);

  if (error) return { error: error.message };

  revalidatePath(`/sub-schedules/${projectId}`);
  revalidatePath("/sub-schedules");
  redirect(`/sub-schedules/${projectId}`);
}

export async function deleteProject(projectId: string): Promise<void> {
  const authed = await createAuthedClient();
  const { error } = await authed.from("projects").delete().eq("id", projectId);
  if (error) throw new Error(error.message);

  revalidatePath("/sub-schedules");
  redirect("/sub-schedules");
}

export async function addProjectMember(
  projectId: string,
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Email is required." };

  const supabase = await createClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (profileError) return { error: profileError.message };
  if (!profile) return { error: `No user found with email ${email}.` };

  const authed = await createAuthedClient();
  const { error: insertError } = await authed.from("project_members").insert({
    project_id: projectId,
    user_id: profile.id,
    role: "member",
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return { error: "That user is already a member." };
    }
    return { error: insertError.message };
  }

  revalidatePath(`/sub-schedules/${projectId}`);
  return { error: null };
}

export async function removeProjectMember(
  projectId: string,
  userId: string
): Promise<void> {
  const authed = await createAuthedClient();
  const { error } = await authed
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
  revalidatePath(`/sub-schedules/${projectId}`);
}
