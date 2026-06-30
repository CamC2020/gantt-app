import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import sgMail from "@sendgrid/mail";

function serviceClient() {
  return createSupabaseJsClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

function addDays(dateISO: string, days: number): string {
  const d = new Date(dateISO);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

function emailHtml(opts: {
  name: string;
  taskTitle: string;
  parentTitle: string | null;
  endDate: string;
  daysLeft: number;
  reminderType: "5_day" | "1_day";
  taskUrl: string;
}): string {
  const { name, taskTitle, parentTitle, endDate, daysLeft, reminderType, taskUrl } = opts;
  const urgency = reminderType === "1_day" ? "tomorrow" : "in 5 days";
  const color = reminderType === "1_day" ? "#dc2626" : "#d97706";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:system-ui,sans-serif">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
    <div style="background:#1A3560;padding:24px 32px">
      <p style="margin:0;font-size:18px;font-weight:700;color:#fff">Anmore Operations Yard</p>
      <p style="margin:4px 0 0;font-size:12px;color:#93c5fd;letter-spacing:0.08em;text-transform:uppercase">Task Deadline Reminder</p>
    </div>
    <div style="padding:28px 32px">
      <p style="margin:0 0 16px;font-size:15px;color:#374151">Hi ${name || "there"},</p>
      <p style="margin:0 0 20px;font-size:15px;color:#374151">
        A task assigned to you is due <strong style="color:${color}">${urgency}</strong>.
      </p>
      <div style="background:#f8fafc;border-left:4px solid ${color};border-radius:4px;padding:16px 20px;margin-bottom:24px">
        <p style="margin:0;font-size:16px;font-weight:600;color:#1A3560">${taskTitle}</p>
        ${parentTitle ? `<p style="margin:4px 0 0;font-size:12px;color:#6b7280">Under: ${parentTitle}</p>` : ""}
        <p style="margin:10px 0 0;font-size:13px;color:#374151">
          <strong>Due:</strong> ${fmtDate(endDate)}
          ${daysLeft === 1 ? " · Tomorrow" : ` · ${daysLeft} days`}
        </p>
      </div>
      <a href="${taskUrl}" style="display:inline-block;background:#1A3560;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 22px;border-radius:6px">
        View My Tasks →
      </a>
      <p style="margin:24px 0 0;font-size:12px;color:#9ca3af">
        You're receiving this because you are assigned as champion, assignee, or support on this task in the Anmore Operations Yard Master Schedule.
      </p>
    </div>
    <div style="padding:16px 32px;border-top:1px solid #f1f5f9;background:#f8fafc">
      <p style="margin:0;font-size:11px;color:#9ca3af">
        Anmore Operations Yard — Jacob Bros Construction, Village of Anmore &amp; ISL Engineering
      </p>
    </div>
  </div>
</body>
</html>`;
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  sgMail.setApiKey(process.env.SENDGRID_API_KEY!);
  const from = process.env.SENDGRID_FROM!;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://your-app.vercel.app";

  const supa = serviceClient();
  const today = new Date().toISOString().split("T")[0];
  const in1 = addDays(today, 1);
  const in5 = addDays(today, 5);

  const { data: tasks, error: taskErr } = await supa
    .from("tasks")
    .select("id, title, end_date, parent_id, assignee_id, champion_id, is_milestone")
    .in("end_date", [in1, in5])
    .eq("is_milestone", false);

  if (taskErr) return NextResponse.json({ error: taskErr.message }, { status: 500 });
  if (!tasks?.length) return NextResponse.json({ sent: 0, message: "No tasks due in 1 or 5 days." });

  const taskIds = tasks.map(t => t.id);

  const { data: supporters } = await supa
    .from("task_support")
    .select("task_id, user_id")
    .in("task_id", taskIds);

  const supportMap = new Map<string, string[]>();
  for (const row of supporters ?? []) {
    const list = supportMap.get(row.task_id) ?? [];
    list.push(row.user_id);
    supportMap.set(row.task_id, list);
  }

  const allUserIds = new Set<string>(
    tasks.flatMap(t => [t.champion_id, t.assignee_id].filter(Boolean) as string[])
  );
  for (const ids of supportMap.values()) ids.forEach(id => allUserIds.add(id));

  const { data: profiles } = await supa
    .from("profiles")
    .select("id, email, full_name")
    .in("id", Array.from(allUserIds));

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]));

  const parentIds = [...new Set(tasks.map(t => t.parent_id).filter(Boolean) as string[])];
  const { data: parentTasks } = parentIds.length > 0
    ? await supa.from("tasks").select("id, title").in("id", parentIds)
    : { data: [] };
  const parentMap = new Map((parentTasks ?? []).map(p => [p.id, p.title as string]));

  const { data: existingLogs } = await supa
    .from("reminder_log")
    .select("task_id, user_id, reminder_type")
    .in("task_id", taskIds);

  const loggedSet = new Set(
    (existingLogs ?? []).map(l => `${l.task_id}:${l.user_id}:${l.reminder_type}`)
  );

  const sent: { task: string; user: string; type: string }[] = [];
  const errors: string[] = [];

  for (const task of tasks) {
    const reminderType: "5_day" | "1_day" = task.end_date === in1 ? "1_day" : "5_day";
    const daysLeft = reminderType === "1_day" ? 1 : 5;
    const parentTitle = task.parent_id ? (parentMap.get(task.parent_id) ?? null) : null;

    const usersToNotify = [
      task.champion_id,
      task.assignee_id,
      ...(supportMap.get(task.id) ?? []),
    ].filter((id): id is string => !!id);

    for (const userId of usersToNotify) {
      const key = `${task.id}:${userId}:${reminderType}`;
      if (loggedSet.has(key)) continue;

      const profile = profileMap.get(userId);
      if (!profile?.email) continue;

      try {
        await sgMail.send({
          to: profile.email,
          from,
          subject: `Reminder: "${task.title}" is due ${reminderType === "1_day" ? "tomorrow" : "in 5 days"}`,
          html: emailHtml({
            name: profile.full_name ?? "",
            taskTitle: task.title,
            parentTitle,
            endDate: task.end_date,
            daysLeft,
            reminderType,
            taskUrl: `${appUrl}/my-tasks`,
          }),
        });

        await supa.from("reminder_log").insert({
          task_id: task.id,
          user_id: userId,
          reminder_type: reminderType,
        });

        loggedSet.add(key);
        sent.push({ task: task.title, user: profile.email, type: reminderType });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("reminder cron: email failed", { task: task.id, user: userId, err: msg });
        errors.push(msg);
      }
    }
  }

  return NextResponse.json({ sent: sent.length, details: sent, errors });
}
