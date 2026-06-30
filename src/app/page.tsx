import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/projects");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-24 text-center">
      <Image
        src="/logo-jv.png"
        alt="Anmore Operations Yard"
        width={120}
        height={120}
        className="object-contain shadow-lg"
      />
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
      <div className="flex items-center gap-6 mt-4 opacity-60">
        <Image src="/logo-jb.png" alt="Jacob Bros Construction" width={80} height={32} className="object-contain" />
        <Image src="/logo-anmore.png" alt="Village of Anmore" width={40} height={40} className="object-contain" />
        <Image src="/logo-isl.webp" alt="ISL Engineering" width={56} height={36} className="object-contain" />
      </div>
    </div>
  );
}
