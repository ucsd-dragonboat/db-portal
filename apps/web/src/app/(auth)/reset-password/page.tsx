import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ResetForm from "./form";

/** Landed on from the emailed reset link (which signs the browser in). */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?error=auth");
  return <ResetForm email={user.email ?? ""} />;
}
