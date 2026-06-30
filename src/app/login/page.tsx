import Link from "next/link";
import AuthForm from "@/components/auth/AuthForm";
import { signIn } from "@/lib/actions/auth";

export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16">
      <div className="flex flex-col items-center gap-1">
        <h1 className="text-2xl font-bold text-[#1A3560]">Log in</h1>
        <p className="text-sm text-slate-500">Welcome back to the JV Scheduler.</p>
      </div>
      <AuthForm mode="login" action={signIn} />
      <p className="text-sm text-slate-500">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-medium text-[#1A3560] underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
