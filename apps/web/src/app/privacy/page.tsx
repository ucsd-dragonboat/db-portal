import Link from "next/link";

export const metadata = { title: "Privacy Policy · DB Portal" };

/** Public privacy policy — required by Google for OAuth apps published to production. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-[15px] leading-relaxed" style={{ color: "#202124" }}>
      <h1 className="text-2xl font-normal">Privacy Policy</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--g-grey-600)" }}>DB Portal · last updated September 9, 2026</p>

      <section className="mt-6 space-y-3">
        <p>
          DB Portal is a private team-management app for a dragon boat team. It is used only by
          invited team members and their coaches/admins; nothing here is sold, shared with third
          parties, or used for advertising.
        </p>

        <h2 className="pt-2 text-lg font-medium">What we store</h2>
        <p>
          Information you or your team admins enter to run the team: your name, email, phone
          number, and (optionally) home address and pickup preferences for carpool planning,
          weight for boat lineup balancing, and your responses to team forms (attendance, rides,
          and custom questions). This data is visible to your teammates and admins inside the
          portal, stored in our database (Supabase), and used solely to organize practices,
          races, lineups, and carpools.
        </p>

        <h2 className="pt-2 text-lg font-medium">Google account data</h2>
        <p>
          Team admins may optionally connect their Google account so form responses can be
          written into a Google Sheet they choose. When an admin connects, we request permission
          to edit spreadsheets and to read the names of files in their Drive (read-only metadata,
          used only to show a spreadsheet picker — we never read file contents). We store the
          OAuth tokens securely server-side, use them only to list spreadsheets and write form
          responses into the sheets the admin selects, and delete them when the admin disconnects.
          DB Portal&rsquo;s use of information received from Google APIs adheres to the{" "}
          <a className="underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener">
            Google API Services User Data Policy
          </a>, including the Limited Use requirements. Google user data is never transferred to
          third parties, used for advertising, or used for any purpose other than the
          spreadsheet-sync feature described above.
        </p>

        <h2 className="pt-2 text-lg font-medium">Deleting your data</h2>
        <p>
          Ask a team admin to remove your profile, or contact us at{" "}
          <a className="underline" href="mailto:ucsddragonboat@gmail.com">ucsddragonboat@gmail.com</a>{" "}
          to have your account and associated data deleted. Admins can disconnect their Google
          account at any time from Team settings, which deletes the stored tokens and revokes
          our access with Google.
        </p>

        <p className="pt-4"><Link href="/login" className="underline">← Back to sign in</Link></p>
      </section>
    </main>
  );
}
