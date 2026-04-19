/**
 * Generated from Supabase schema on 2026-04-19 (post-polymorphic reset).
 * Re-generate with: `supabase gen types typescript --project-id lqlyorlccnniybezugme`
 * or via the Supabase MCP (`generate_typescript_types`).
 *
 * Do NOT hand-edit the generated block — it will drift from the database.
 * Use the helper types at the bottom (`Row`, `Insert`, `Update`, `Enum`,
 * `RpcArgs`, `RpcReturn`) for ergonomic access.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          changes: Json | null;
          created_at: string;
          entity_id: string;
          entity_type: string;
          id: string;
          workspace_id: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          changes?: Json | null;
          created_at?: string;
          entity_id: string;
          entity_type: string;
          id?: string;
          workspace_id?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          changes?: Json | null;
          created_at?: string;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_log_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspace';
            referencedColumns: ['id'];
          },
        ];
      };
      date: {
        Row: {
          all_day: boolean;
          city: string | null;
          country: string | null;
          created_at: string;
          custom_fields: Json;
          deleted_at: string | null;
          ends_at: string | null;
          id: string;
          kind: Database['public']['Enums']['date_kind'];
          notes: string | null;
          project_id: string;
          season: string | null;
          starts_at: string;
          status: Database['public']['Enums']['date_status'];
          title: string | null;
          updated_at: string;
          venue_name: string | null;
          workspace_id: string;
        };
        Insert: {
          all_day?: boolean;
          city?: string | null;
          country?: string | null;
          created_at?: string;
          custom_fields?: Json;
          deleted_at?: string | null;
          ends_at?: string | null;
          id?: string;
          kind?: Database['public']['Enums']['date_kind'];
          notes?: string | null;
          project_id: string;
          season?: string | null;
          starts_at: string;
          status?: Database['public']['Enums']['date_status'];
          title?: string | null;
          updated_at?: string;
          venue_name?: string | null;
          workspace_id: string;
        };
        Update: {
          all_day?: boolean;
          city?: string | null;
          country?: string | null;
          created_at?: string;
          custom_fields?: Json;
          deleted_at?: string | null;
          ends_at?: string | null;
          id?: string;
          kind?: Database['public']['Enums']['date_kind'];
          notes?: string | null;
          project_id?: string;
          season?: string | null;
          starts_at?: string;
          status?: Database['public']['Enums']['date_status'];
          title?: string | null;
          updated_at?: string;
          venue_name?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'date_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'project';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'date_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspace';
            referencedColumns: ['id'];
          },
        ];
      };
      engagement: {
        Row: {
          created_at: string;
          created_by: string;
          custom_fields: Json;
          date_id: string | null;
          deleted_at: string | null;
          first_contacted_at: string | null;
          id: string;
          last_contacted_at: string | null;
          next_action_at: string | null;
          next_action_note: string | null;
          person_id: string;
          project_id: string;
          role: string | null;
          status: Database['public']['Enums']['engagement_status'];
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          custom_fields?: Json;
          date_id?: string | null;
          deleted_at?: string | null;
          first_contacted_at?: string | null;
          id?: string;
          last_contacted_at?: string | null;
          next_action_at?: string | null;
          next_action_note?: string | null;
          person_id: string;
          project_id: string;
          role?: string | null;
          status?: Database['public']['Enums']['engagement_status'];
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          custom_fields?: Json;
          date_id?: string | null;
          deleted_at?: string | null;
          first_contacted_at?: string | null;
          id?: string;
          last_contacted_at?: string | null;
          next_action_at?: string | null;
          next_action_note?: string | null;
          person_id?: string;
          project_id?: string;
          role?: string | null;
          status?: Database['public']['Enums']['engagement_status'];
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'engagement_date_id_fkey';
            columns: ['date_id'];
            isOneToOne: false;
            referencedRelation: 'date';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'engagement_person_id_fkey';
            columns: ['person_id'];
            isOneToOne: false;
            referencedRelation: 'person';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'engagement_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'project';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'engagement_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspace';
            referencedColumns: ['id'];
          },
        ];
      };
      membership: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          id: string;
          invited_by: string | null;
          role: Database['public']['Enums']['membership_role'];
          updated_at: string;
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          id?: string;
          invited_by?: string | null;
          role?: Database['public']['Enums']['membership_role'];
          updated_at?: string;
          user_id: string;
          workspace_id: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          id?: string;
          invited_by?: string | null;
          role?: Database['public']['Enums']['membership_role'];
          updated_at?: string;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'membership_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspace';
            referencedColumns: ['id'];
          },
        ];
      };
      person: {
        Row: {
          city: string | null;
          country: string | null;
          created_at: string;
          created_by: string | null;
          custom_fields: Json;
          deleted_at: string | null;
          email: string | null;
          first_name: string | null;
          full_name: string;
          id: string;
          languages: string[];
          last_name: string | null;
          organization_name: string | null;
          phone: string | null;
          title: string | null;
          updated_at: string;
          website: string | null;
        };
        Insert: {
          city?: string | null;
          country?: string | null;
          created_at?: string;
          created_by?: string | null;
          custom_fields?: Json;
          deleted_at?: string | null;
          email?: string | null;
          first_name?: string | null;
          full_name: string;
          id?: string;
          languages?: string[];
          last_name?: string | null;
          organization_name?: string | null;
          phone?: string | null;
          title?: string | null;
          updated_at?: string;
          website?: string | null;
        };
        Update: {
          city?: string | null;
          country?: string | null;
          created_at?: string;
          created_by?: string | null;
          custom_fields?: Json;
          deleted_at?: string | null;
          email?: string | null;
          first_name?: string | null;
          full_name?: string;
          id?: string;
          languages?: string[];
          last_name?: string | null;
          organization_name?: string | null;
          phone?: string | null;
          title?: string | null;
          updated_at?: string;
          website?: string | null;
        };
        Relationships: [];
      };
      person_note: {
        Row: {
          author_id: string;
          body: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          person_id: string;
          updated_at: string;
          visibility: Database['public']['Enums']['person_note_visibility'];
          workspace_id: string;
        };
        Insert: {
          author_id: string;
          body: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          person_id: string;
          updated_at?: string;
          visibility?: Database['public']['Enums']['person_note_visibility'];
          workspace_id: string;
        };
        Update: {
          author_id?: string;
          body?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          person_id?: string;
          updated_at?: string;
          visibility?: Database['public']['Enums']['person_note_visibility'];
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'person_note_person_id_fkey';
            columns: ['person_id'];
            isOneToOne: false;
            referencedRelation: 'person';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'person_note_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspace';
            referencedColumns: ['id'];
          },
        ];
      };
      project: {
        Row: {
          created_at: string;
          custom_fields: Json;
          deleted_at: string | null;
          description: string | null;
          ends_on: string | null;
          id: string;
          name: string;
          poster_url: string | null;
          slug: string;
          starts_on: string | null;
          status: Database['public']['Enums']['project_status'];
          type: Database['public']['Enums']['project_type'];
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          custom_fields?: Json;
          deleted_at?: string | null;
          description?: string | null;
          ends_on?: string | null;
          id?: string;
          name: string;
          poster_url?: string | null;
          slug: string;
          starts_on?: string | null;
          status?: Database['public']['Enums']['project_status'];
          type: Database['public']['Enums']['project_type'];
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          custom_fields?: Json;
          deleted_at?: string | null;
          description?: string | null;
          ends_on?: string | null;
          id?: string;
          name?: string;
          poster_url?: string | null;
          slug?: string;
          starts_on?: string | null;
          status?: Database['public']['Enums']['project_status'];
          type?: Database['public']['Enums']['project_type'];
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'project_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspace';
            referencedColumns: ['id'];
          },
        ];
      };
      project_membership: {
        Row: {
          created_at: string;
          id: string;
          invited_by: string | null;
          project_id: string;
          role: Database['public']['Enums']['project_member_role'];
          scope: string[];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          invited_by?: string | null;
          project_id: string;
          role?: Database['public']['Enums']['project_member_role'];
          scope?: string[];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          invited_by?: string | null;
          project_id?: string;
          role?: Database['public']['Enums']['project_member_role'];
          scope?: string[];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'project_membership_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'project';
            referencedColumns: ['id'];
          },
        ];
      };
      tag: {
        Row: {
          color: string | null;
          created_at: string;
          id: string;
          name: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          color?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          color?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tag_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspace';
            referencedColumns: ['id'];
          },
        ];
      };
      tagging: {
        Row: {
          created_at: string;
          created_by: string | null;
          entity_id: string;
          entity_type: Database['public']['Enums']['taggable_entity'];
          id: string;
          tag_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          entity_id: string;
          entity_type: Database['public']['Enums']['taggable_entity'];
          id?: string;
          tag_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          entity_id?: string;
          entity_type?: Database['public']['Enums']['taggable_entity'];
          id?: string;
          tag_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tagging_tag_id_fkey';
            columns: ['tag_id'];
            isOneToOne: false;
            referencedRelation: 'tag';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tagging_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspace';
            referencedColumns: ['id'];
          },
        ];
      };
      user_profile: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          full_name: string;
          locale: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          full_name: string;
          locale?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string;
          locale?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      workspace: {
        Row: {
          country: string | null;
          created_at: string;
          custom_fields: Json;
          deleted_at: string | null;
          id: string;
          kind: Database['public']['Enums']['workspace_kind'];
          name: string;
          settings: Json;
          slug: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          country?: string | null;
          created_at?: string;
          custom_fields?: Json;
          deleted_at?: string | null;
          id?: string;
          kind?: Database['public']['Enums']['workspace_kind'];
          name: string;
          settings?: Json;
          slug: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          country?: string | null;
          created_at?: string;
          custom_fields?: Json;
          deleted_at?: string | null;
          id?: string;
          kind?: Database['public']['Enums']['workspace_kind'];
          name?: string;
          settings?: Json;
          slug?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      can_edit_project: { Args: { p_project_id: string }; Returns: boolean };
      can_see_person: { Args: { p_person_id: string }; Returns: boolean };
      current_user_id: { Args: never; Returns: string };
      current_workspace_id: { Args: never; Returns: string };
      current_workspace_role: {
        Args: never;
        Returns: Database['public']['Enums']['membership_role'];
      };
      custom_access_token_hook: { Args: { event: Json }; Returns: Json };
      has_project_access: {
        Args: { p_project_id: string; p_scope: string };
        Returns: boolean;
      };
      is_workspace_member: { Args: { ws_id: string }; Returns: boolean };
      uuid_generate_v7: { Args: never; Returns: string };
    };
    Enums: {
      date_kind:
        | 'performance'
        | 'rehearsal'
        | 'residency'
        | 'travel_day'
        | 'press'
        | 'other';
      date_status:
        | 'tentative'
        | 'held'
        | 'confirmed'
        | 'cancelled'
        | 'performed';
      engagement_status:
        | 'idea'
        | 'proposed'
        | 'discussing'
        | 'held'
        | 'confirmed'
        | 'cancelled'
        | 'declined'
        | 'performed'
        | 'dormant';
      membership_role: 'owner' | 'admin' | 'member' | 'viewer' | 'guest';
      person_note_visibility: 'workspace' | 'private';
      project_member_role: 'lead' | 'collaborator' | 'viewer';
      project_status: 'draft' | 'active' | 'archived';
      project_type: 'show' | 'release' | 'creation_cycle' | 'festival_edition';
      taggable_entity: 'person' | 'project' | 'date' | 'engagement';
      workspace_kind: 'personal' | 'team';
    };
  };
};

// ----- Convenience aliases -------------------------------------------------

type PublicSchema = Database['public'];

/** Row shape of a table or view. Usage: `Row<'engagement'>`, `Row<'person'>`. */
export type Row<
  K extends keyof PublicSchema['Tables'] | keyof PublicSchema['Views'],
> =
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

/** One of the enum values. Usage: `Enum<'engagement_status'>`. */
export type Enum<K extends keyof PublicSchema['Enums']> =
  PublicSchema['Enums'][K];

/** Args object for an RPC. */
export type RpcArgs<K extends keyof PublicSchema['Functions']> =
  PublicSchema['Functions'][K]['Args'];

/** Return type for an RPC. */
export type RpcReturn<K extends keyof PublicSchema['Functions']> =
  PublicSchema['Functions'][K]['Returns'];
