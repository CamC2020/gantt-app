import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";
import type { Profile } from "@/lib/supabase/types";

export default async function Header() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("id, email, full_name, is_admin")
        .eq("id", user.id)
        .maybeSingle()
        .returns<Profile | null>()
    : { data: null };

  const isAdmin = profile?.is_admin ?? false;

  return (
    <header className="border-b border-[#0f2340] bg-[#1A3560]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        {/* Left: JV logo + name */}
        <Link href="/" className="flex items-center gap-3 shrink-0">
          <Image
            src="/logo-jv.png"
            alt="Anmore Operations Yard JV"
            width={56}
            height={56}
            className="object-contain"
          />
          <div className="flex flex-col leading-tight">
            <span className="text-base font-bold text-white tracking-wide">
              Anmore Operations Yard
            </span>
            <span className="text-[11px] font-medium text-blue-200 uppercase tracking-widest">
              Virtual Project Site
            </span>
          </div>
        </Link>

        {/* Right: nav */}
        <nav className="flex items-center gap-3 text-sm shrink-0">
          {user ? (
            <>
              <Link href="/schedule" className="text-blue-100 hover:text-white transition-colors">
                Master Schedule
              </Link>
              <Link href="/lookahead" className="text-blue-100 hover:text-white transition-colors">
                Lookahead
              </Link>
              <Link href="/my-tasks" className="text-blue-100 hover:text-white transition-colors">
                My Tasks
              </Link>
              <Link href="/holidays" className="text-blue-100 hover:text-white transition-colors">
                Holidays
              </Link>
              <Link href="/sub-schedules" className="text-blue-100 hover:text-white transition-colors">
                Sub-Schedules
              </Link>
              {isAdmin && (
                <Link href="/admin" className="text-blue-300 hover:text-white transition-colors text-xs border border-blue-700 rounded px-2 py-1">
                  Users
                </Link>
              )}
              <span className="text-blue-400 hidden sm:inline">{user.email}</span>
              <form action={signOut}>
                <button
                  type="submit"
                  className="rounded-md border border-blue-400 px-3 py-1.5 font-medium text-blue-100 hover:bg-blue-800 transition-colors"
                >
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-blue-100 hover:text-white transition-colors"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-[#2A6B35] px-3 py-1.5 font-medium text-white hover:bg-[#235a2c] transition-colors"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
