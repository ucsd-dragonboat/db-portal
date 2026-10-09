import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { CHECK_LIST } from "@/lib/status-checks";
import StatusPanel from "./status-panel";

export default async function AdminStatusPage() {
  const { org } = await requireAdmin();
  // Demo sandboxes don't get the Status page: it reads team-wide counts and runs real
  // API calls outside the demo's geo budget.
  if (org.is_demo) notFound();
  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-normal">Status</h1>
        <p className="text-sm" style={{ color: "var(--g-grey-600)" }}>Check every service the portal depends on. Nothing runs until you click Run — pick the checks you want, or run them all. Secret values are never shown.</p>
      </div>
      <StatusPanel checks={CHECK_LIST} />
    </div>
  );
}
