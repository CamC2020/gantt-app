import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// Not typed against Database: the installed @supabase/postgrest-js version's
// generic inference breaks (resolves to `never`) on any query using .eq()
// or a multi-column .select() against our schema types. Queries use plain
// `any`-typed clients and read results are annotated manually instead.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  );
}

// The cookie-bridged client above resolves `getUser()`/`getSession()`
// correctly, but with the installed supabase-js/ssr version combo its
// PostgREST requests don't reliably carry the user's access token — RLS
// writes get rejected as if unauthenticated even though the session is
// valid. Use this for any insert/update/delete that's subject to RLS;
// it forwards the session's access token explicitly as the Authorization
// header instead of relying on that internal wiring.
export async function createAuthedClient() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return supabase;
  }

  const authed = createSupabaseJsClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );

  // Some supabase-js versions derive the PostgREST Authorization header from
  // internal auth state rather than the static `global.headers` above, which
  // silently falls back to the anon key for a client with no session. Setting
  // the session explicitly forces that internal state to match.
  await authed.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });

  return authed;
}
