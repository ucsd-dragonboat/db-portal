import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { tabTitle } from "@/lib/tab-title";

// Tab title for the form's editor, responses and response-edit pages.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { data: form } = await (await createClient()).from("forms").select("title").eq("id", id).maybeSingle();
  return { title: tabTitle("Forms", form?.title) };
}

export default function AdminFormLayout({ children }: { children: React.ReactNode }) {
  return children;
}
