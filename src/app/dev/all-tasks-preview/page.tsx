// Dev-only visual test harness for the All Tasks page (mock data, no auth).
// Returns 404 in production.
import { notFound } from "next/navigation";
import AllTasksPreview from "./preview";

export default function AllTasksPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AllTasksPreview />;
}
