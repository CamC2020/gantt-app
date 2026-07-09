// Dev-only visual test harness for the Pull Plan board (mock data, no auth).
// Returns 404 in production.
import { notFound } from "next/navigation";
import PullPlanPreview from "./preview";

export default function PullPlanPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PullPlanPreview />;
}
