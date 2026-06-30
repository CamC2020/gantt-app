import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/supabase/types";

const NAV_CARDS = [
  {
    href: "/schedule",
    title: "Master Schedule",
    description: "View and edit the full project Gantt chart.",
    icon: "📅",
    color: "border-[#1A3560]",
  },
  {
    href: "/lookahead",
    title: "6-Week Lookahead",
    description: "Tasks coming up in the next six weeks.",
    icon: "🔭",
    color: "border-[#2E6EA6]",
  },
  {
    href: "/my-tasks",
    title: "My Tasks",
    description: "Tasks assigned to you with status and notes.",
    icon: "✅",
    color: "border-green-600",
  },
  {
    href: "/holidays",
    title: "Holiday Scheduler",
    description: "Enter your personal non-working days.",
    icon: "🏖️",
    color: "border-amber-500",
  },
  {
    href: "/sub-schedules",
    title: "Sub-Schedules",
    description: "Project-specific sub-schedules.",
    icon: "📋",
    color: "border-zinc-400",
  },
];

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-24 text-center">
        <div className="flex flex-col gap-3">
          <h1 className="max-w-xl text-4xl font-bold tracking-tight text-[#1A3560]">
            Anmore Operations Yard
          </h1>
          <p className="text-lg font-medium text-[#2E6EA6]">
            Virtual Project Site
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/signup"
            className="rounded-md bg-[#1A3560] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#152b4e] transition-colors"
          >
            Get started
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-[#1A3560] px-6 py-2.5 text-sm font-medium text-[#1A3560] hover:bg-blue-50 transition-colors"
          >
            Log in
          </Link>
        </div>
      </div>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, is_admin")
    .eq("id", user.id)
    .maybeSingle()
    .returns<Profile | null>();

  const isAdmin = profile?.is_admin ?? false;
  const displayName = profile?.full_name || user.email?.split("@")[0] || "there";

  const cards = [
    ...NAV_CARDS,
    ...(isAdmin ? [{
      href: "/admin",
      title: "User Management",
      description: "Manage admin access for team members.",
      icon: "👤",
      color: "border-purple-500",
    }] : []),
  ];

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1A3560]">
          Welcome, {displayName}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Anmore Operations Yard — Virtual Project Site
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map(card => (
          <Link
            key={card.href}
            href={card.href}
            className={`flex flex-col gap-2 rounded-xl border-l-4 ${card.color} bg-white p-5 shadow-sm hover:shadow-md transition-shadow`}
          >
            <span className="text-2xl">{card.icon}</span>
            <span className="font-semibold text-[#1A3560]">{card.title}</span>
            <span className="text-sm text-zinc-500 leading-snug">{card.description}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
