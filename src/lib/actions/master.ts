"use server";

import { createClient, createAuthedClient } from "@/lib/supabase/server";
import type { Project } from "@/lib/supabase/types";

export async function getOrCreateMasterProject(): Promise<Project | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Check if master already exists
  const { data: existing } = await supabase
    .from("projects")
    .select("id, name, description, owner_id, is_master, created_at")
    .eq("is_master", true)
    .maybeSingle()
    .returns<Project | null>();

  if (existing) return existing;

  // Create it — owned by the first user who hits this page
  const authed = await createAuthedClient();
  const id = crypto.randomUUID();
  const { error } = await authed.from("projects").insert({
    id,
    name: "Master Schedule",
    description: "Company-wide master schedule visible to all users.",
    owner_id: user.id,
    is_master: true,
  });

  if (error) return null;

  const { data: created } = await supabase
    .from("projects")
    .select("id, name, description, owner_id, is_master, created_at")
    .eq("id", id)
    .maybeSingle()
    .returns<Project | null>();

  return created ?? null;
}
