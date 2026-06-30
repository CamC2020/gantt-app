import { createBrowserClient } from "@supabase/ssr";

// Not typed against Database: the installed @supabase/postgrest-js version's
// generic inference breaks (resolves to `never`) on any query using .eq()
// or a multi-column .select() against our schema types. Queries use plain
// `any`-typed clients and read results are annotated manually instead.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
