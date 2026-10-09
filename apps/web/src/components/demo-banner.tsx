import { startDemoOver, toggleDemoView } from "@/app/demo/actions";
import ConfirmForm from "@/components/confirm-form";

/** Shown across the top of every page inside a demo sandbox. */
export default function DemoBanner({ hours, viewingAsMember }: { hours: number | null; viewingAsMember: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-1.5 text-sm text-white" style={{ background: "var(--g-purple)" }}>
      <span><b>Demo sandbox</b> · fake team, just for you{hours != null && ` · resets in ${hours} h`}</span>
      <form action={toggleDemoView}>
        <button className="rounded bg-white/20 px-2 py-0.5 text-xs hover:bg-white/30">{viewingAsMember ? "Back to coach view" : "View as a team member"}</button>
      </form>
      <ConfirmForm action={startDemoOver} message="Throw away everything in this demo and start with a fresh team?">
        <button className="rounded px-2 py-0.5 text-xs underline hover:bg-white/10">Start over</button>
      </ConfirmForm>
    </div>
  );
}
