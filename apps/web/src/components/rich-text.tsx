import { cleanHtml, isHtml } from "@/lib/html";
import RichTextView from "./rich-text-view";

/** Server-side rich text: sanitizes (defense in depth), then renders via RichTextView.
 * Client components should pre-sanitize on the server and use RichTextView directly. */
export default function RichText({ text, className = "" }: { text: string; className?: string }) {
  return <RichTextView html={isHtml(text) ? cleanHtml(text) : text} className={className} />;
}
