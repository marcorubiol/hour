/**
 * Generated from Supabase schema on 2026-04-19.
 * Re-generate with: `supabase gen types typescript --project-id lqlyorlccnniybezugme`
 * or via the Supabase MCP (`generate_typescript_types`).
 *
 * Do NOT hand-edit — it will drift from the database. Use the helper types
 * at the bottom (`Row`, `Insert`, `Update`, `Enum`, `RpcArgs`, `RpcReturn`)
 * for ergonomic access.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          after: Json | null;
          before: Json | null;
          created_at: string;
          entity_id: string;
          entity_type: string;
          id: string;
          organization_id: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          after?: Json | null;
          before?: Json | null;
          created_at?: string;
          entity_id: string;
          entity_type: string;
          id?: string;
          organization_id: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          after?: Json | null;
          before?: Json | null;
          created_at?: string;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          organization_id?: string;
        };
      };
      contact: {
        Row: {
          city: string | null;
          company: string | null;
          country: string | null;
          created_at: string;
          custom_fields: Json;
          deleted_at: string | null;
          email: string | null;
          id: string;
          name: string;
          notes: string | null;
          organization_id: string;
          phone: string | null;
          role_title: string | null;
          tier: Database['public']['Enums']['contact_tier'];
          updated_at: string;
          website: string | null;
        };
        Insert: {
          city?: string | null;
          company?: string | null;
          country?: string | null;
          created_at?: string;
          custom_fields?: Json;
          deleted_at?: string | null;
          email?: string | null;
          id?: string;
          name: string;
          notes?: string | null;
          organization_id: string;
          phone?: string | null;
          role_title?: string | null;
          tier?: Database['public']['Enums']['contact_tier'];
          updated_at?: string;
          website?: string | null;
        };
        Update: {
          city?: string | null;
          company?: string | null;
          country?: string | null;
          created_at?: string;
          custom_fields?: Json;
          deleted_at?: string | null;
          email?: string | null;
          id?: string;
          name?: string;
          notes?: string | null;
          organization_id?: string;
          phone?: string | null;
          role_title?: string | null;
          tier?: Database['public']['Enums']['contact_tier'];
          updated_at?: string;
          website?: string | null;
        };
      };
      contact_project: {
        Row: {
          contact_id: string;
          created_at: string;
          deleted_at: string | null;
          organization_id: string;
          project_id: string;
          role_label: string | null;
          status: Database['public']['Enums']['contact_project_status'];
          updated_at: string;
        };
        Insert: {
          contact_id: string;
          created_at?: string;
          deleted_at?: string | null;
          organization_id: string;
          project_id: string;
          role_label?: string | null;
          status?: Database['public']['Enums']['contact_project_status'];
          updated_at?: string;
        };
        Update: {
          contact_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          organization_id?: string;
          project_id?: string;
          role_label?: string | null;
          status?: Database['public']['Enums']['contact_project_status'];
          updated_at?: string;
        };
      };
      event: {
        Row: {
          all_day: boolean;
          created_at: string;
          custom_fields: Json;
          deleted_at: string | null;
          ends_at: string | null;
          external_calendar_id: string | null;
          id: string;
          location_address: string | null;
          location_name: string | null;
          notes: string | null;
          organization_id: string;
          project_id: string | null;
          starts_at: string;
          status: Database['public']['Enums']['event_status'];
          timezone: string;
          title: string;
          type: Database['public']['Enums']['event_type'];
          updated_at: string;
        };
        Insert: {
          all_day?: boolean;
          created_at?: string;
          custom_fields?: Json;
          deleted_at?: string | null;
          ends_at?: string | null;
          external_calendar_id?: string | null;
          id?: string;
          location_address?: string | null;
          location_name?: string | null;
          notes?: string | null;
          organization_id: string;
          project_id?: string | null;
          starts_at: string;
          status?: Database['public']['Enums']['event_status'];
          timezone?: string;
          title: string;
          type?: Database['public']['Enums']['event_type'];
          updated_at?: string;
        };
        Update: {
          all_day?: boolean;
          created_at?: string;
          custom_fields?: Json;
          deleted_at?: string | null;
          ends_at?: string | null;
          external_calendar_id?: string | null;
          id?: string;
          location_address?: string | null;
          location_name?: string | null;
          notes?: string | null;
          organization_id?: string;
          project_id?: string | null;
          starts_at?: string;
          status?: Database['public']['Enums']['event_status'];
          timezone?: string;
          title?: string;
          type?: Database['public']['Enums']['event_type'];
          updated_at?: string;
        };
      };
      membership: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          id: string;
          invited_at: string | null;
          organization_id: string;
          role: Database['public']['Enums']['membership_role'];
          user_id: string;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          id?: string;
          invited_at?: string | null;
          organization_id: string;
          role?: Database['public']['Enums']['membership_role'];
          user_id: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          id?: string;
          invited_at?: string | null;
          organization_id?: string;
          role?: Database['public']['Enums']['membership_role'];
          user_id?: string;
        };
      };
      organization: {
        Row: {
          created_at: string;
          default_locale: string;
          deleted_at: string | null;
          id: string;
          logo_r2_key: string | null;
          name: string;
          slug: string;
          timezone: string;
          type: Database['public']['Enums']['org_type'];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          default_locale?: string;
          deleted_at?: string | null;
          id?: string;
          logo_r2_key?: string | null;
          name: string;
          slug: string;
          timezone?: string;
          type?: Database['public']['Enums']['org_type'];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          default_locale?: string;
          deleted_at?: string | null;
          id?: string;
          logo_r2_key?: string | null;
          name?: string;
          slug?: string;
          timezone?: string;
          type?: Database['public']['Enums']['org_type'];
          updated_at?: string;
        };
      };
      project: {
        Row: {
          created_at: string;
          custom_fields: Json;
          deleted_at: string | null;
          description: string | null;
          end_date: string | null;
          id: string;
          name: string;
          organization_id: string;
          slug: string;
          start_date: string | null;
          status: Database['public']['Enums']['project_status'];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          custom_fields?: Json;
          deleted_at?: string | null;
          description?: string | null;
          end_date?: string | null;
          id?: string;
          name: string;
          organization_id: string;
          slug: string;
          start_date?: string | null;
          status?: Database['public']['Enums']['project_status'];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          custom_fields?: Json;
          deleted_at?: string | null;
          description?: string | null;
          end_date?: string | null;
          id?: string;
          name?: string;
          organization_id?: string;
          slug?: string;
          start_date?: string | null;
          status?: Database['public']['Enums']['project_status'];
          updated_at?: string;
        };
      };
      tag: {
        Row: {
          color: string | null;
          created_at: string;
          id: string;
          name: string;
          organization_id: string;
        };
        Insert: {
          color?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          organization_id: string;
        };
        Update: {
          color?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          organization_id?: string;
        };
      };
      tagging: {
        Row: {
          entity_id: string;
          entity_type: string;
          organization_id: string;
          tag_id: string;
        };
        Insert: {
          entity_id: string;
          entity_type: string;
          organization_id: string;
          tag_id: string;
        };
        Update: {
          entity_id?: string;
          entity_type?: string;
          organization_id?: string;
          tag_id?: string;
        };
      };
      // (crew_assignment, file, note, rider, task, user_profile: full rows
      //  available via `supabase gen types typescript` — omitted here to
      //  keep this scaffold compact. Add them as endpoints start needing
      //  them, or regenerate the full file.)
    };
    Views: {
      contact_with_tags: {
        Row: {
          city: string | null;
          company: string | null;
          country: string | null;
          created_at: string | null;
          custom_fields: Json | null;
          deleted_at: string | null;
          email: string | null;
          id: string | null;
          name: string | null;
          organization_id: string | null;
          phone: string | null;
          role_title: string | null;
          tags: string[] | null;
          tier: Database['public']['Enums']['contact_tier'] | null;
          updated_at: string | null;
          website: string | null;
        };
      };
    };
    Functions: {
      current_org_id: { Args: never; Returns: string };
      current_user_id: { Args: never; Returns: string };
      current_user_role: {
        Args: never;
        Returns: Database['public']['Enums']['membership_role'];
      };
      prospect_list: {
        Args: {
          p_project_slug: string;
          p_status?: Database['public']['Enums']['contact_project_status'];
          p_limit?: number;
          p_offset?: number;
        };
        Returns: {
          contact_id: string;
          name: string;
          company: string;
          email: string;
          country: string;
          city: string;
          website: string;
          status: Database['public']['Enums']['contact_project_status'];
          role_label: string;
          updated_at: string;
          tags: string[];
          total_count: number;
        }[];
      };
      uuid_generate_v7: { Args: never; Returns: string };
    };
    Enums: {
      contact_project_status:
        | 'prospect'
        | 'contacted'
        | 'proposal_sent'
        | 'negotiating'
        | 'booked'
        | 'confirmed'
        | 'done'
        | 'lost';
      contact_tier: 'private' | 'tagged';
      event_status: 'tentative' | 'confirmed' | 'cancelled';
      event_type: 'gig' | 'rehearsal' | 'meeting' | 'travel' | 'other';
      file_status: 'pending' | 'ready' | 'deleted';
      linkable_entity: 'project' | 'contact' | 'event' | 'rider';
      membership_role: 'owner' | 'admin' | 'member' | 'viewer';
      notable_entity: 'project' | 'contact' | 'event';
      org_type: 'company' | 'collective' | 'freelancer';
      project_status: 'draft' | 'active' | 'archived';
      task_section: 'dispatch' | 'queue' | 'ping' | 'deferred' | 'shelf' | 'trace';
    };
  };
};

// ----- Convenience aliases -------------------------------------------------

type PublicSchema = Database['public'];

/** Row shape of a table or view. Usage: `Row<'contact'>`, `Row<'contact_with_tags'>`. */
export type Row<K extends keyof PublicSchema['Tables'] | keyof PublicSchema['Views']> =
  K extends keyof PublicSchema['Tables']
    ? PublicSchema['Tables'][K]['Row']
    : K extends keyof PublicSchema['Views']
      ? PublicSchema['Views'][K]['Row']
      : never;

/** Insert shape of a table (has defaults, required cols only). */
export type Insert<K extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][K]['Insert'];

/** Update shape of a table (everything optional). */
export type Update<K extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][K]['Update'];

/** One of the enum values. Usage: `Enum<'contact_project_status'>`. */
export type Enum<K extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][K];

/** Args object for an RPC. */
export type RpcArgs<K extends keyof PublicSchema['Functions']> =
  PublicSchema['Functions'][K]['Args'];

/** Return type for an RPC. */
export type RpcReturn<K extends keyof PublicSchema['Functions']> =
  PublicSchema['Functions'][K]['Returns'];
