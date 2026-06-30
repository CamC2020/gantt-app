import Link from "next/link";
import AuthForm from "@/components/auth/AuthForm";
import { signUp } from "@/lib/actions/auth";

export default function SignupPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16">
      <div className="flex flex-col items-center gap-1">
        <h1 className="text-2xl font-bold text-[#1A3560]">Create an account</h1>
        <p className="text-sm text-slate-500">Join the Anmore Operations Yard JV Scheduler.</p>
      </div>
      <AuthForm mode="signup" action={signUp} />
      <p className="text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-[#1A3560] underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
