import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/supabase/types";
import AdminUserList from "@/components/admin/AdminUserList";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: myProfile } = await supabase
    .from("profiles")
    .select("id, email, full_name, is_admin")
    .eq("id", user.id)
    .maybeSingle()
    .returns<Profile | null>();

  if (!myProfile?.is_admin) redirect("/schedule");

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, full_name, is_admin")
    .order("email", { ascending: true })
    .returns<Profile[]>();

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <div className="flex flex-col gap-1 mb-6">
        <h1 className="text-2xl font-bold text-[#1A3560]">User Management</h1>
        <p className="text-sm text-slate-500">
          Control who has admin access to edit the Master Schedule.
        </p>
      </div>
      <AdminUserList profiles={profiles ?? []} currentUserId={user.id} />
    </div>
  );
}
