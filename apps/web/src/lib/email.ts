// Thin Resend wrapper for opt-in notification emails (see lib/notifications.ts).
// Fail-soft like the rest of the app's optional integrations: with no
// RESEND_API_KEY configured this quietly no-ops instead of breaking whatever
// action triggered it (an RSVP, a form submission, ...).

const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";
const CHUNK_SIZE = 100; // Resend's batch endpoint limit

export type EmailMessage = { to: string; subject: string; html: string };

/** Sends each message as its own email (never a shared "to" list) so recipients
 * never see each other's addresses. Safe to call with an empty array. */
export async function sendEmailBatch(messages: EmailMessage[]): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from || messages.length === 0) return;

  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    try {
      await fetch(RESEND_BATCH_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(chunk.map((m) => ({ from, to: [m.to], subject: m.subject, html: m.html }))),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      // A missed notification must never break the action that triggered it.
    }
  }
}

/** Shared minimal wrapper so the notification kinds don't each hand-roll a full document. */
export function renderEmail(title: string, bodyHtml: string): string {
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
  <div style="background:#0f9d58;color:#fff;padding:12px 16px;font-size:16px">${title}</div>
  <div style="padding:16px;color:#1a1f36;font-size:14px;line-height:1.5">${bodyHtml}</div>
</div>`;
}
