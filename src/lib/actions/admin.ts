"use server";

import { createClient, createAuthedClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function setAdminStatus(targetUserId: string, isAdmin: boolean) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Verify caller is admin
  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!me?.is_admin) return { error: "Not authorized" };

  // Prevent self-demotion — protects against accidentally locking yourself out
  if (targetUserId === user.id && !isAdmin) {
    return { error: "You cannot remove your own admin access." };
  }

  const authed = await createAuthedClient();
  const { error } = await authed
    .from("profiles")
    .update({ is_admin: isAdmin })
    .eq("id", targetUserId);

  if (error) return { error: error.message };

  revalidatePath("/admin");
  return { error: null };
}
