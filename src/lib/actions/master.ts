"use server";

import { createClient, createAuthedClient } from "@/lib/supabase/server";
import type { Project } from "@/lib/supabase/types";

// The Lookahead is its own project, populated by "Export to Lookahead" on the Pull Plan.
export async function getOrCreateLookaheadProject(): Promise<Project | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: existing } = await supabase
    .from("projects")
    .select("id, name, description, owner_id, is_master, created_at")
    .eq("name", "Lookahead")
    .eq("is_master", false)
    .maybeSingle()
    .returns<Project | null>();

  if (existing) return existing;

  const authed = await createAuthedClient();
  const id = crypto.randomUUID();
  const { error } = await authed.from("projects").insert({
    id,
    name: "Lookahead",
    description: "6-week lookahead, exported from the Pull Plan.",
    owner_id: user.id,
    is_master: false,
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
