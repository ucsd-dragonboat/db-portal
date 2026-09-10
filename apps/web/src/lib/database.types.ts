// Hand-written to match supabase/migrations/0001_init.sql.
// Regenerate later with: supabase gen types typescript --project-id <id> > src/lib/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Row<T> = T;
type Insert<T, Optional extends keyof T> = Omit<T, Optional> & Partial<Pick<T, Optional>>;

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  weight_lb: number | null;
  gender: "male" | "female" | "other" | null;
  side_preference: "left" | "right" | "either" | null;
  can_steer: boolean;
  can_drum: boolean;
  address: string | null;
  city: string | null;
  zipcode: string | null;
  lat: number | null;
  lon: number | null;
  car_passengers: number;
  created_at: string;
  updated_at: string;
};

export type PendingMember = {
  org_id: string;
  email: string;
  full_name: string;
  address: string | null;
  city: string | null;
  zipcode: string | null;
  lat: number | null;
  lon: number | null;
  car_passengers: number;
  gender: "male" | "female" | "other" | null;
  weight_lb: number | null;
  created_at: string;
};

export type Organization = {
  id: string;
  name: string;
  join_code: string;
  created_by: string | null;
  created_at: string;
};

export type Membership = {
  org_id: string;
  user_id: string;
  role: "admin" | "member";
  created_at: string;
};

export type Announcement = {
  id: string;
  org_id: string;
  author_id: string | null;
  title: string;
  body: string;
  pinned: boolean;
  created_at: string;
};

export type EventKind = "practice" | "race" | "social" | "other";

export type SavedLocation = {
  id: string;
  org_id: string;
  name: string;
  address: string | null;
  city: string | null;
  zipcode: string | null;
  lat: number | null;
  lon: number | null;
  sort_order: number;
  created_at: string;
};

export type PickupLocation = {
  id: string;
  org_id: string;
  name: string;
  lat: number | null;
  lon: number | null;
  sort_order: number;
  active: boolean;
};

export type EventGroup = {
  id: string;
  org_id: string;
  name: string;
  kind: EventKind;
  folder_id: string | null; // Drive-style folder in the admin events tab
  created_by: string | null;
  created_at: string;
};

export type EventFolder = {
  id: string;
  org_id: string;
  name: string;
  parent_id: string | null; // folders can nest, Drive-style
  color: string | null;     // folder icon color (null = default grey)
  created_at: string;
};

/** Secret for a member's personal iCal feed — service-role-only table. */
export type UserCalendarToken = {
  user_id: string;
  token: string;
  created_at: string;
};

/** Google OAuth refresh token for Sheets sync — service-role-only table. */
export type UserGoogleToken = {
  user_id: string;
  google_email: string;
  refresh_token: string;
  access_token: string | null;
  access_expires_at: string | null;
  default_spreadsheet_id: string | null;
  created_at: string;
};

export type Event = {
  id: string;
  org_id: string;
  kind: EventKind;
  group_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location_name: string | null;
  location_lat: number | null;
  location_lon: number | null;
  notes: string | null;
  rsvp_deadline: string | null;
  google_event_id: string | null; // mirrored event in the org's team Google Calendar
  needs_info: boolean;            // imported from Google, awaiting kind/group/details
  created_by: string | null;
  created_at: string;
};

/** One team Google Calendar per org — service-role-only table. */
export type GoogleCalendarSync = {
  org_id: string;
  user_id: string;
  calendar_id: string;
  sync_token: string | null;
  updated_at: string;
};

export type RideChoice = "none" | "driver" | "self" | "needs_ride";

export type Rsvp = {
  event_id: string;
  user_id: string;
  status: "yes" | "no" | "maybe";
  ride: RideChoice;
  seats: number | null;
  pickup_location_id: string | null;
  pickup_address: string | null;
  note: string | null;
  form_id: string | null;
  updated_at: string;
};

export type QuestionType = "short_text" | "long_text" | "single_choice" | "multi_choice" | "yes_no" | "number" | "info" | "day";
export type FormQuestion = {
  id: string;
  type: QuestionType;
  label: string;
  help?: string;
  required?: boolean;
  options?: string[];
  event_id?: string; // type "day" only: position marker for that day's attendance question
};

export type Form = {
  id: string;
  org_id: string;
  title: string;
  description: string;
  due_at: string | null;
  status: "draft" | "open" | "closed" | "template";
  questions: Json;   // FormQuestion[]
  ask_weight: boolean;
  carpools_generated_at: string | null; // set once the auto-carpool cron has processed this form
  sheet_spreadsheet_id: string | null;  // linked Google Sheet; responses mirror into it
  sheet_tab_id: number | null;          // tab gid; null until the first sync creates the tab
  sheet_linked_by: string | null;       // whose Google token the sync uses
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FormEvent = {
  form_id: string;
  event_id: string;
  sort_order: number;
  prompt: string | null;
};

export type FormResponse = {
  form_id: string;
  user_id: string;
  answers: Json;     // Record<questionId, string | string[] | number | boolean>
  submitted_at: string;
  first_submitted_at: string | null; // set by DB trigger; basis for the late flag
};

export type LineupRow = {
  id: string;
  org_id: string;
  event_id: string | null;
  name: string;
  boat_type: "open" | "womens" | "mixed";
  division: string | null;   // race-day division display name; null = practice/custom lineup
  boat_label: string | null; // "A", "B", ... within the division
  data: Json;
  published: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CarpoolRow = {
  id: string;
  org_id: string;
  event_id: string;
  data: Json;
  published: boolean;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Row<Profile>;
        Insert: Insert<Profile, "phone" | "weight_lb" | "gender" | "side_preference" | "can_steer" | "can_drum" | "address" | "city" | "zipcode" | "lat" | "lon" | "car_passengers" | "created_at" | "updated_at" | "full_name">;
        Update: Partial<Profile>;
        Relationships: [];
      };
      pending_members: {
        Row: Row<PendingMember>;
        Insert: Insert<PendingMember, "full_name" | "address" | "city" | "zipcode" | "lat" | "lon" | "car_passengers" | "gender" | "weight_lb" | "created_at">;
        Update: Partial<PendingMember>;
        Relationships: [
          { foreignKeyName: "pending_members_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
        ];
      };
      organizations: {
        Row: Row<Organization>;
        Insert: Insert<Organization, "id" | "created_by" | "created_at">;
        Update: Partial<Organization>;
        Relationships: [];
      };
      memberships: {
        Row: Row<Membership>;
        Insert: Insert<Membership, "role" | "created_at">;
        Update: Partial<Membership>;
        Relationships: [
          { foreignKeyName: "memberships_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "memberships_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ];
      };
      announcements: {
        Row: Row<Announcement>;
        Insert: Insert<Announcement, "id" | "author_id" | "body" | "pinned" | "created_at">;
        Update: Partial<Announcement>;
        Relationships: [
          { foreignKeyName: "announcements_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "announcements_author_id_fkey"; columns: ["author_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ];
      };
      saved_locations: {
        Row: Row<SavedLocation>;
        Insert: Insert<SavedLocation, "id" | "address" | "city" | "zipcode" | "lat" | "lon" | "sort_order" | "created_at">;
        Update: Partial<SavedLocation>;
        Relationships: [
          { foreignKeyName: "saved_locations_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
        ];
      };
      pickup_locations: {
        Row: Row<PickupLocation>;
        Insert: Insert<PickupLocation, "id" | "lat" | "lon" | "sort_order" | "active">;
        Update: Partial<PickupLocation>;
        Relationships: [
          { foreignKeyName: "pickup_locations_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
        ];
      };
      user_calendar_tokens: {
        Row: Row<UserCalendarToken>;
        Insert: Insert<UserCalendarToken, "created_at">;
        Update: Partial<UserCalendarToken>;
        Relationships: [
          { foreignKeyName: "user_calendar_tokens_user_id_fkey"; columns: ["user_id"]; isOneToOne: true; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ];
      };
      user_google_tokens: {
        Row: Row<UserGoogleToken>;
        Insert: Insert<UserGoogleToken, "access_token" | "access_expires_at" | "default_spreadsheet_id" | "created_at">;
        Update: Partial<UserGoogleToken>;
        Relationships: [
          { foreignKeyName: "user_google_tokens_user_id_fkey"; columns: ["user_id"]; isOneToOne: true; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ];
      };
      google_calendar_sync: {
        Row: Row<GoogleCalendarSync>;
        Insert: Insert<GoogleCalendarSync, "sync_token" | "updated_at">;
        Update: Partial<GoogleCalendarSync>;
        Relationships: [
          { foreignKeyName: "google_calendar_sync_org_id_fkey"; columns: ["org_id"]; isOneToOne: true; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "google_calendar_sync_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ];
      };
      event_folders: {
        Row: Row<EventFolder>;
        Insert: Insert<EventFolder, "id" | "parent_id" | "color" | "created_at">;
        Update: Partial<EventFolder>;
        Relationships: [
          { foreignKeyName: "event_folders_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
        ];
      };
      event_groups: {
        Row: Row<EventGroup>;
        Insert: Insert<EventGroup, "id" | "kind" | "folder_id" | "created_by" | "created_at">;
        Update: Partial<EventGroup>;
        Relationships: [
          { foreignKeyName: "event_groups_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
        ];
      };
      events: {
        Row: Row<Event>;
        Insert: Insert<Event, "id" | "kind" | "group_id" | "ends_at" | "location_name" | "location_lat" | "location_lon" | "notes" | "rsvp_deadline" | "google_event_id" | "needs_info" | "created_by" | "created_at">;
        Update: Partial<Event>;
        Relationships: [
          { foreignKeyName: "events_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "events_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "events_group_id_fkey"; columns: ["group_id"]; isOneToOne: false; referencedRelation: "event_groups"; referencedColumns: ["id"] },
        ];
      };
      forms: {
        Row: Row<Form>;
        Insert: Insert<Form, "id" | "description" | "due_at" | "status" | "questions" | "ask_weight" | "carpools_generated_at" | "sheet_spreadsheet_id" | "sheet_tab_id" | "sheet_linked_by" | "created_by" | "created_at" | "updated_at">;
        Update: Partial<Form>;
        Relationships: [
          { foreignKeyName: "forms_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "forms_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ];
      };
      form_events: {
        Row: Row<FormEvent>;
        Insert: Insert<FormEvent, "sort_order" | "prompt">;
        Update: Partial<FormEvent>;
        Relationships: [
          { foreignKeyName: "form_events_form_id_fkey"; columns: ["form_id"]; isOneToOne: false; referencedRelation: "forms"; referencedColumns: ["id"] },
          { foreignKeyName: "form_events_event_id_fkey"; columns: ["event_id"]; isOneToOne: false; referencedRelation: "events"; referencedColumns: ["id"] },
        ];
      };
      form_responses: {
        Row: Row<FormResponse>;
        Insert: Insert<FormResponse, "answers" | "submitted_at" | "first_submitted_at">;
        Update: Partial<FormResponse>;
        Relationships: [
          { foreignKeyName: "form_responses_form_id_fkey"; columns: ["form_id"]; isOneToOne: false; referencedRelation: "forms"; referencedColumns: ["id"] },
          { foreignKeyName: "form_responses_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ];
      };
      rsvps: {
        Row: Row<Rsvp>;
        Insert: Insert<Rsvp, "ride" | "seats" | "pickup_location_id" | "pickup_address" | "note" | "form_id" | "updated_at">;
        Update: Partial<Rsvp>;
        Relationships: [
          { foreignKeyName: "rsvps_event_id_fkey"; columns: ["event_id"]; isOneToOne: false; referencedRelation: "events"; referencedColumns: ["id"] },
          { foreignKeyName: "rsvps_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "rsvps_pickup_location_id_fkey"; columns: ["pickup_location_id"]; isOneToOne: false; referencedRelation: "pickup_locations"; referencedColumns: ["id"] },
          { foreignKeyName: "rsvps_form_id_fkey"; columns: ["form_id"]; isOneToOne: false; referencedRelation: "forms"; referencedColumns: ["id"] },
        ];
      };
      lineups: {
        Row: Row<LineupRow>;
        Insert: Insert<LineupRow, "id" | "event_id" | "boat_type" | "division" | "boat_label" | "data" | "published" | "created_by" | "created_at" | "updated_at">;
        Update: Partial<LineupRow>;
        Relationships: [
          { foreignKeyName: "lineups_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "lineups_event_id_fkey"; columns: ["event_id"]; isOneToOne: false; referencedRelation: "events"; referencedColumns: ["id"] },
        ];
      };
      carpools: {
        Row: Row<CarpoolRow>;
        Insert: Insert<CarpoolRow, "id" | "data" | "published" | "updated_at">;
        Update: Partial<CarpoolRow>;
        Relationships: [
          { foreignKeyName: "carpools_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "carpools_event_id_fkey"; columns: ["event_id"]; isOneToOne: false; referencedRelation: "events"; referencedColumns: ["id"] },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_organization: { Args: { org_name: string }; Returns: string };
      join_organization: { Args: { code: string }; Returns: string };
      is_org_member: { Args: { org: string }; Returns: boolean };
      is_org_admin: { Args: { org: string }; Returns: boolean };
      shares_org_with: { Args: { other: string }; Returns: boolean };
      admin_of_user: { Args: { other: string }; Returns: boolean };
      user_has_password: { Args: { uid: string }; Returns: boolean };
      rotate_join_code: { Args: { org: string }; Returns: string };
      hit_rate_limit: { Args: { p_key: string; p_max: number; p_window: string }; Returns: boolean };
      admin_add_member: {
        Args: { p_org: string; p_email: string; p_full_name?: string; p_address?: string | null; p_city?: string | null; p_zipcode?: string | null; p_lat?: number | null; p_lon?: number | null; p_car_passengers?: number | null; p_gender?: string | null; p_weight_lb?: number | null };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
