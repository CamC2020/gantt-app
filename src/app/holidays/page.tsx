import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, MemberHoliday } from "@/lib/supabase/types";
import HolidayScheduler from "@/components/holidays/HolidayScheduler";

export default async function HolidaysPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profiles }, { data: holidays }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, is_admin")
      .order("full_name", { ascending: true })
      .returns<Profile[]>(),
    supabase
      .from("member_holidays")
      .select("id, user_id, date, label")
      .order("date", { ascending: true })
      .returns<MemberHoliday[]>(),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <div className="flex flex-col gap-1 mb-6">
        <h1 className="text-2xl font-bold text-[#1A3560]">Holiday Scheduler</h1>
        <p className="text-sm text-slate-500">
          Each team member can enter their personal non-working days. These are visible to everyone so the team can plan around availability.
        </p>
      </div>
      <HolidayScheduler
        profiles={profiles ?? []}
        initialHolidays={holidays ?? []}
        currentUserId={user.id}
      />
    </div>
  );
}
