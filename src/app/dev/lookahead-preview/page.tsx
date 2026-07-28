// Dev-only visual test harness for the Lookahead (mock data, no auth).
// Returns 404 in production.
import { notFound } from "next/navigation";
import LookaheadPreview from "./preview";

export default function LookaheadPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LookaheadPreview />;
}
