// Server-side cache for what every page loads first: the signed-in user's profile,
// membership and team. Without it, each click waited on these queries before the page
// could start its own.
//
// Cached functions can't read cookies, so they use the service-role client. They are
// only ever called with an id taken from the verified session (lib/session.ts), filter
// on it explicitly, and the id is part of the cache key — one user's or team's rows can
// never answer for another. Writes still go through the user's RLS client, so a stale
// entry can at worst show something for up to CACHE_SECONDS, never allow a write.

import { revalidateTag, unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Membership, Organization, Profile } from "@/lib/database.types";

/** Backstop for writes that don't expire the cache themselves (SQL functions, cron). */
const CACHE_SECONDS = 60;

const userTag = (id: string) => `user:${id}`;
const orgTag = (id: string) => `org:${id}`;

/** Call after writing a user's profile or membership; the next read refetches. */
export function expireUser(userId: string) {
  revalidateTag(userTag(userId), { expire: 0 });
}

/** Call after writing a team's organizations row (name, join code, member cap, demo expiry). */
export function expireOrg(orgId: string) {
  revalidateTag(orgTag(orgId), { expire: 0 });
}

export function cachedUserRows(userId: string): Promise<{ profile: Profile | null; membership: Membership | null }> {
  return unstable_cache(
    async () => {
      const admin = createAdminClient();
      const [{ data: profile }, { data: membership }] = await Promise.all([
        admin.from("profiles").select("*").eq("id", userId).maybeSingle(),
        admin.from("memberships").select("*").eq("user_id", userId).order("created_at").limit(1).maybeSingle(),
      ]);
      return { profile, membership };
    },
    ["session-user", userId],
    { tags: [userTag(userId)], revalidate: CACHE_SECONDS },
  )();
}

export function cachedOrg(orgId: string): Promise<Organization | null> {
  return unstable_cache(
    async () => (await createAdminClient().from("organizations").select("*").eq("id", orgId).maybeSingle()).data,
    ["session-org", orgId],
    { tags: [orgTag(orgId)], revalidate: CACHE_SECONDS },
  )();
}

/** Setting a password calls expireUser, so an admin isn't sent back to set it again. */
export function cachedHasPassword(userId: string): Promise<boolean> {
  return unstable_cache(
    async () => !!(await createAdminClient().rpc("user_has_password", { uid: userId })).data,
    ["session-password", userId],
    { tags: [userTag(userId)], revalidate: CACHE_SECONDS },
  )();
}
