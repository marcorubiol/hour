export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      access_preset: {
        Row: {
          can_edit_meta: boolean
          container_verb: Database["public"]["Enums"]["access_verb"]
          key: string
          sort: number
        }
        Insert: {
          can_edit_meta?: boolean
          container_verb: Database["public"]["Enums"]["access_verb"]
          key: string
          sort?: number
        }
        Update: {
          can_edit_meta?: boolean
          container_verb?: Database["public"]["Enums"]["access_verb"]
          key?: string
          sort?: number
        }
        Relationships: []
      }
      access_preset_facet: {
        Row: {
          facet_key: string
          preset_key: string
          verb: Database["public"]["Enums"]["access_verb"]
        }
        Insert: {
          facet_key: string
          preset_key: string
          verb: Database["public"]["Enums"]["access_verb"]
        }
        Update: {
          facet_key?: string
          preset_key?: string
          verb?: Database["public"]["Enums"]["access_verb"]
        }
        Relationships: [
          {
            foreignKeyName: "access_preset_facet_preset_key_fkey"
            columns: ["preset_key"]
            isOneToOne: false
            referencedRelation: "access_preset"
            referencedColumns: ["key"]
          },
        ]
      }
      account: {
        Row: {
          billing_email: string | null
          country: string | null
          created_at: string
          custom_fields: Json
          default_fiscal_identity_id: string | null
          deleted_at: string | null
          id: string
          kind: Database["public"]["Enums"]["account_kind"]
          name: string
          previous_slugs: string[]
          settings: Json
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          billing_email?: string | null
          country?: string | null
          created_at?: string
          custom_fields?: Json
          default_fiscal_identity_id?: string | null
          deleted_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["account_kind"]
          name: string
          previous_slugs?: string[]
          settings?: Json
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          billing_email?: string | null
          country?: string | null
          created_at?: string
          custom_fields?: Json
          default_fiscal_identity_id?: string | null
          deleted_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["account_kind"]
          name?: string
          previous_slugs?: string[]
          settings?: Json
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_default_fiscal_identity_id_fkey"
            columns: ["default_fiscal_identity_id"]
            isOneToOne: false
            referencedRelation: "fiscal_identity"
            referencedColumns: ["id"]
          },
        ]
      }
      account_membership: {
        Row: {
          accepted_at: string | null
          account_id: string
          invited_at: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["account_role"]
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          account_id: string
          invited_at?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["account_role"]
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          account_id?: string
          invited_at?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["account_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_membership_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_version: {
        Row: {
          adapted_from_id: string | null
          created_at: string
          deleted_at: string | null
          direction: Database["public"]["Enums"]["asset_direction"]
          id: string
          kind: Database["public"]["Enums"]["asset_kind"]
          line_id: string | null
          notes: string | null
          performance_id: string | null
          previous_slugs: string[]
          project_id: string | null
          slug: string | null
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
          url: string
          workspace_id: string
        }
        Insert: {
          adapted_from_id?: string | null
          created_at?: string
          deleted_at?: string | null
          direction?: Database["public"]["Enums"]["asset_direction"]
          id?: string
          kind: Database["public"]["Enums"]["asset_kind"]
          line_id?: string | null
          notes?: string | null
          performance_id?: string | null
          previous_slugs?: string[]
          project_id?: string | null
          slug?: string | null
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          url: string
          workspace_id: string
        }
        Update: {
          adapted_from_id?: string | null
          created_at?: string
          deleted_at?: string | null
          direction?: Database["public"]["Enums"]["asset_direction"]
          id?: string
          kind?: Database["public"]["Enums"]["asset_kind"]
          line_id?: string | null
          notes?: string | null
          performance_id?: string | null
          previous_slugs?: string[]
          project_id?: string | null
          slug?: string | null
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
          url?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_version_adapted_from_id_fkey"
            columns: ["adapted_from_id"]
            isOneToOne: false
            referencedRelation: "asset_version"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_version_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_version_performance_id_fkey"
            columns: ["performance_id"]
            isOneToOne: false
            referencedRelation: "performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_version_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_version_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          changes: Json | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          workspace_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          changes?: Json | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          workspace_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          changes?: Json | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_block: {
        Row: {
          certainty: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          ends_on: string
          id: string
          note: string | null
          person_id: string | null
          starts_on: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          certainty?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          ends_on: string
          id?: string
          note?: string | null
          person_id?: string | null
          starts_on: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          certainty?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          ends_on?: string
          id?: string
          note?: string | null
          person_id?: string | null
          starts_on?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_block_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_block_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_block_workspace_person_fkey"
            columns: ["workspace_id", "person_id"]
            isOneToOne: false
            referencedRelation: "workspace_person"
            referencedColumns: ["workspace_id", "person_id"]
          },
        ]
      }
      bolo: {
        Row: {
          city: string | null
          conversation_id: string | null
          country: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          fee_amount: number | null
          fee_currency: string | null
          id: string
          line_id: string | null
          project_id: string
          status: Database["public"]["Enums"]["performance_status"]
          updated_at: string
          venue_name: string | null
          workspace_id: string
        }
        Insert: {
          city?: string | null
          conversation_id?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          fee_amount?: number | null
          fee_currency?: string | null
          id?: string
          line_id?: string | null
          project_id: string
          status?: Database["public"]["Enums"]["performance_status"]
          updated_at?: string
          venue_name?: string | null
          workspace_id: string
        }
        Update: {
          city?: string | null
          conversation_id?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          fee_amount?: number | null
          fee_currency?: string | null
          id?: string
          line_id?: string | null
          project_id?: string
          status?: Database["public"]["Enums"]["performance_status"]
          updated_at?: string
          venue_name?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bolo_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolo_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolo_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolo_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_share: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          revoked_at: string | null
          token: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          revoked_at?: string | null
          token: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          revoked_at?: string | null
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_share_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      cast_member: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          joined_at: string | null
          left_at: string | null
          notes: string | null
          person_id: string
          project_id: string
          role: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          joined_at?: string | null
          left_at?: string | null
          notes?: string | null
          person_id: string
          project_id: string
          role: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          joined_at?: string | null
          left_at?: string | null
          notes?: string | null
          person_id?: string
          project_id?: string
          role?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cast_member_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cast_member_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cast_member_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cast_member_workspace_person_fkey"
            columns: ["workspace_id", "person_id"]
            isOneToOne: false
            referencedRelation: "workspace_person"
            referencedColumns: ["workspace_id", "person_id"]
          },
        ]
      }
      cast_override: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          performance_id: string
          person_id: string
          reason: string | null
          replaces_person_id: string | null
          role: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          performance_id: string
          person_id: string
          reason?: string | null
          replaces_person_id?: string | null
          role: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          performance_id?: string
          person_id?: string
          reason?: string | null
          replaces_person_id?: string | null
          role?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cast_override_performance_id_fkey"
            columns: ["performance_id"]
            isOneToOne: false
            referencedRelation: "performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cast_override_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cast_override_replaces_person_id_fkey"
            columns: ["replaces_person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cast_override_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cast_override_workspace_person_fkey"
            columns: ["workspace_id", "person_id"]
            isOneToOne: false
            referencedRelation: "workspace_person"
            referencedColumns: ["workspace_id", "person_id"]
          },
          {
            foreignKeyName: "cast_override_workspace_replaces_person_fkey"
            columns: ["workspace_id", "replaces_person_id"]
            isOneToOne: false
            referencedRelation: "workspace_person"
            referencedColumns: ["workspace_id", "person_id"]
          },
        ]
      }
      collab_snapshot: {
        Row: {
          created_at: string
          id: string
          snapshot: string
          target_id: string
          target_table: string
          version: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          snapshot: string
          target_id: string
          target_table: string
          version: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          snapshot?: string
          target_id?: string
          target_table?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collab_snapshot_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      commitment_person: {
        Row: {
          created_at: string
          date_id: string | null
          id: string
          performance_id: string | null
          person_id: string
          project_id: string
          set_by: string | null
          state: Database["public"]["Enums"]["commitment_state"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          date_id?: string | null
          id?: string
          performance_id?: string | null
          person_id: string
          project_id: string
          set_by?: string | null
          state: Database["public"]["Enums"]["commitment_state"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          date_id?: string | null
          id?: string
          performance_id?: string | null
          person_id?: string
          project_id?: string
          set_by?: string | null
          state?: Database["public"]["Enums"]["commitment_state"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commitment_person_date_id_fkey"
            columns: ["date_id"]
            isOneToOne: false
            referencedRelation: "date"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commitment_person_performance_id_fkey"
            columns: ["performance_id"]
            isOneToOne: false
            referencedRelation: "performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commitment_person_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commitment_person_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commitment_person_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation: {
        Row: {
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          first_contacted_at: string | null
          id: string
          last_contacted_at: string | null
          line_id: string | null
          next_action_at: string | null
          next_action_note: string | null
          organization_id: string
          previous_slugs: string[]
          private_to: string | null
          project_id: string
          slug: string
          status: Database["public"]["Enums"]["conversation_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          first_contacted_at?: string | null
          id?: string
          last_contacted_at?: string | null
          line_id?: string | null
          next_action_at?: string | null
          next_action_note?: string | null
          organization_id: string
          previous_slugs?: string[]
          private_to?: string | null
          project_id: string
          slug: string
          status?: Database["public"]["Enums"]["conversation_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          first_contacted_at?: string | null
          id?: string
          last_contacted_at?: string | null
          line_id?: string | null
          next_action_at?: string | null
          next_action_note?: string | null
          organization_id?: string
          previous_slugs?: string[]
          private_to?: string | null
          project_id?: string
          slug?: string
          status?: Database["public"]["Enums"]["conversation_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_workspace_organization_fkey"
            columns: ["workspace_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "workspace_organization"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      conversation_contact: {
        Row: {
          conversation_id: string
          created_at: string
          created_by: string | null
          id: string
          is_primary: boolean
          person_id: string
          role: string | null
          since: string | null
          until: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_primary?: boolean
          person_id: string
          role?: string | null
          since?: string | null
          until?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_primary?: boolean
          person_id?: string
          role?: string | null
          since?: string | null
          until?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_contact_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_contact_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_contact_workspace_person_fkey"
            columns: ["workspace_id", "person_id"]
            isOneToOne: false
            referencedRelation: "workspace_person"
            referencedColumns: ["workspace_id", "person_id"]
          },
        ]
      }
      conversation_event: {
        Row: {
          body: string | null
          conversation_id: string
          created_by: string | null
          direction:
            | Database["public"]["Enums"]["conversation_event_direction"]
            | null
          external_ref: string | null
          id: string
          kind: Database["public"]["Enums"]["conversation_event_kind"]
          metadata: Json
          occurred_at: string
          original_url: string | null
          participants: Json
          provenance: Json
          recorded_at: string
          source: Database["public"]["Enums"]["conversation_event_source"]
          workspace_id: string
        }
        Insert: {
          body?: string | null
          conversation_id: string
          created_by?: string | null
          direction?:
            | Database["public"]["Enums"]["conversation_event_direction"]
            | null
          external_ref?: string | null
          id?: string
          kind: Database["public"]["Enums"]["conversation_event_kind"]
          metadata?: Json
          occurred_at: string
          original_url?: string | null
          participants?: Json
          provenance?: Json
          recorded_at?: string
          source?: Database["public"]["Enums"]["conversation_event_source"]
          workspace_id: string
        }
        Update: {
          body?: string | null
          conversation_id?: string
          created_by?: string | null
          direction?:
            | Database["public"]["Enums"]["conversation_event_direction"]
            | null
          external_ref?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["conversation_event_kind"]
          metadata?: Json
          occurred_at?: string
          original_url?: string | null
          participants?: Json
          provenance?: Json
          recorded_at?: string
          source?: Database["public"]["Enums"]["conversation_event_source"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_event_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_event_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_assignment: {
        Row: {
          contact_override: Json
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          notes: string | null
          performance_id: string
          person_id: string
          role: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          contact_override?: Json
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          notes?: string | null
          performance_id: string
          person_id: string
          role: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          contact_override?: Json
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          notes?: string | null
          performance_id?: string
          person_id?: string
          role?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_assignment_performance_id_fkey"
            columns: ["performance_id"]
            isOneToOne: false
            referencedRelation: "performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_assignment_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_assignment_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_assignment_workspace_person_fkey"
            columns: ["workspace_id", "person_id"]
            isOneToOne: false
            referencedRelation: "workspace_person"
            referencedColumns: ["workspace_id", "person_id"]
          },
        ]
      }
      date: {
        Row: {
          all_day: boolean
          city: string | null
          country: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          destination_city: string | null
          destination_country: string | null
          ends_at: string | null
          id: string
          kind: Database["public"]["Enums"]["date_kind"]
          line_id: string | null
          notes: string | null
          origin_city: string | null
          origin_country: string | null
          performance_id: string | null
          project_id: string
          season: string | null
          series_id: string | null
          starts_at: string
          status: Database["public"]["Enums"]["date_status"]
          title: string | null
          travel_direction: string | null
          updated_at: string
          venue_id: string | null
          venue_name: string | null
          workspace_id: string
        }
        Insert: {
          all_day?: boolean
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          destination_city?: string | null
          destination_country?: string | null
          ends_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["date_kind"]
          line_id?: string | null
          notes?: string | null
          origin_city?: string | null
          origin_country?: string | null
          performance_id?: string | null
          project_id: string
          season?: string | null
          series_id?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["date_status"]
          title?: string | null
          travel_direction?: string | null
          updated_at?: string
          venue_id?: string | null
          venue_name?: string | null
          workspace_id: string
        }
        Update: {
          all_day?: boolean
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          destination_city?: string | null
          destination_country?: string | null
          ends_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["date_kind"]
          line_id?: string | null
          notes?: string | null
          origin_city?: string | null
          origin_country?: string | null
          performance_id?: string | null
          project_id?: string
          season?: string | null
          series_id?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["date_status"]
          title?: string | null
          travel_direction?: string | null
          updated_at?: string
          venue_id?: string | null
          venue_name?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "date_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_performance_id_fkey"
            columns: ["performance_id"]
            isOneToOne: false
            referencedRelation: "performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      expense: {
        Row: {
          amount: number
          bolo_id: string | null
          category: Database["public"]["Enums"]["expense_category"]
          counterparty: string | null
          created_at: string
          created_by: string | null
          currency: string
          custom_fields: Json
          deleted_at: string | null
          description: string
          id: string
          incurred_on: string
          line_id: string | null
          notes: string | null
          paid_by_user_id: string | null
          receipt_url: string | null
          reimbursed: boolean
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount: number
          bolo_id?: string | null
          category?: Database["public"]["Enums"]["expense_category"]
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          custom_fields?: Json
          deleted_at?: string | null
          description: string
          id?: string
          incurred_on?: string
          line_id?: string | null
          notes?: string | null
          paid_by_user_id?: string | null
          receipt_url?: string | null
          reimbursed?: boolean
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          bolo_id?: string | null
          category?: Database["public"]["Enums"]["expense_category"]
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          custom_fields?: Json
          deleted_at?: string | null
          description?: string
          id?: string
          incurred_on?: string
          line_id?: string | null
          notes?: string | null
          paid_by_user_id?: string | null
          receipt_url?: string | null
          reimbursed?: boolean
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_bolo_id_fkey"
            columns: ["bolo_id"]
            isOneToOne: false
            referencedRelation: "bolo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      facet: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          key: string
          label: string | null
          labels: Json
          sort: number
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          key: string
          label?: string | null
          labels?: Json
          sort?: number
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          key?: string
          label?: string | null
          labels?: Json
          sort?: number
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facet_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      facet_level: {
        Row: {
          facet_id: string
          level: Database["public"]["Enums"]["container_level"]
        }
        Insert: {
          facet_id: string
          level: Database["public"]["Enums"]["container_level"]
        }
        Update: {
          facet_id?: string
          level?: Database["public"]["Enums"]["container_level"]
        }
        Relationships: [
          {
            foreignKeyName: "facet_level_facet_id_fkey"
            columns: ["facet_id"]
            isOneToOne: false
            referencedRelation: "facet"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_identity: {
        Row: {
          account_id: string | null
          address_line_1: string | null
          address_line_2: string | null
          archived: boolean
          city: string | null
          country: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          default_irpf_pct: number | null
          default_vat_pct: number | null
          deleted_at: string | null
          iban: string | null
          id: string
          kind: string
          label: string
          legal_name: string
          postal_code: string | null
          region: string | null
          swift_bic: string | null
          tax_id: string | null
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          address_line_1?: string | null
          address_line_2?: string | null
          archived?: boolean
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          default_irpf_pct?: number | null
          default_vat_pct?: number | null
          deleted_at?: string | null
          iban?: string | null
          id?: string
          kind: string
          label?: string
          legal_name: string
          postal_code?: string | null
          region?: string | null
          swift_bic?: string | null
          tax_id?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          address_line_1?: string | null
          address_line_2?: string | null
          archived?: boolean
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          default_irpf_pct?: number | null
          default_vat_pct?: number | null
          deleted_at?: string | null
          iban?: string | null
          id?: string
          kind?: string
          label?: string
          legal_name?: string
          postal_code?: string | null
          region?: string | null
          swift_bic?: string | null
          tax_id?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_identity_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_identity_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice: {
        Row: {
          country: string | null
          created_at: string
          created_by: string | null
          currency: string
          custom_fields: Json
          deleted_at: string | null
          doc_type: string
          due_on: string | null
          expected_on: string | null
          id: string
          issued_on: string
          issuer_fiscal_identity_id: string | null
          issuer_snapshot: Json | null
          notes: string | null
          number: string | null
          payer_fiscal_identity_id: string | null
          payer_organization_id: string | null
          payer_snapshot: Json | null
          payment_condition: string | null
          project_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          total: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          custom_fields?: Json
          deleted_at?: string | null
          doc_type?: string
          due_on?: string | null
          expected_on?: string | null
          id?: string
          issued_on?: string
          issuer_fiscal_identity_id?: string | null
          issuer_snapshot?: Json | null
          notes?: string | null
          number?: string | null
          payer_fiscal_identity_id?: string | null
          payer_organization_id?: string | null
          payer_snapshot?: Json | null
          payment_condition?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          total?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          country?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          custom_fields?: Json
          deleted_at?: string | null
          doc_type?: string
          due_on?: string | null
          expected_on?: string | null
          id?: string
          issued_on?: string
          issuer_fiscal_identity_id?: string | null
          issuer_snapshot?: Json | null
          notes?: string | null
          number?: string | null
          payer_fiscal_identity_id?: string | null
          payer_organization_id?: string | null
          payer_snapshot?: Json | null
          payment_condition?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          total?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_issuer_fiscal_identity_id_fkey"
            columns: ["issuer_fiscal_identity_id"]
            isOneToOne: false
            referencedRelation: "fiscal_identity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payer_fiscal_identity_id_fkey"
            columns: ["payer_fiscal_identity_id"]
            isOneToOne: false
            referencedRelation: "fiscal_identity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_workspace_payer_organization_fkey"
            columns: ["workspace_id", "payer_organization_id"]
            isOneToOne: false
            referencedRelation: "workspace_organization"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      invoice_line: {
        Row: {
          bolo_id: string | null
          created_at: string
          description: string
          id: string
          invoice_id: string
          line_total: number | null
          quantity: number
          unit_amount: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          bolo_id?: string | null
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          line_total?: number | null
          quantity?: number
          unit_amount: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          bolo_id?: string | null
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          line_total?: number | null
          quantity?: number
          unit_amount?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_bolo_id_fkey"
            columns: ["bolo_id"]
            isOneToOne: false
            referencedRelation: "bolo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_number_series: {
        Row: {
          created_at: string
          fiscal_identity_id: string | null
          id: string
          next_seq: number
          scope_kind: string
          scope_ref: string
          updated_at: string
          workspace_id: string
          year: number
        }
        Insert: {
          created_at?: string
          fiscal_identity_id?: string | null
          id?: string
          next_seq?: number
          scope_kind: string
          scope_ref: string
          updated_at?: string
          workspace_id: string
          year: number
        }
        Update: {
          created_at?: string
          fiscal_identity_id?: string | null
          id?: string
          next_seq?: number
          scope_kind?: string
          scope_ref?: string
          updated_at?: string
          workspace_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_number_series_fiscal_identity_id_fkey"
            columns: ["fiscal_identity_id"]
            isOneToOne: false
            referencedRelation: "fiscal_identity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_number_series_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_tax_line: {
        Row: {
          amount: number
          base_amount: number
          created_at: string
          exempt_reason: string | null
          id: string
          invoice_id: string
          kind: string
          label: string
          ordinal: number
          rate_pct: number
          workspace_id: string
        }
        Insert: {
          amount: number
          base_amount: number
          created_at?: string
          exempt_reason?: string | null
          id?: string
          invoice_id: string
          kind: string
          label: string
          ordinal?: number
          rate_pct?: number
          workspace_id: string
        }
        Update: {
          amount?: number
          base_amount?: number
          created_at?: string
          exempt_reason?: string | null
          id?: string
          invoice_id?: string
          kind?: string
          label?: string
          ordinal?: number
          rate_pct?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_tax_line_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_tax_line_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      line: {
        Row: {
          accent: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          description: string | null
          dossier_url: string | null
          end_date: string | null
          id: string
          kind: Database["public"]["Enums"]["line_kind"]
          last_navigated_at: string | null
          modules: Json | null
          name: string
          notes: string | null
          previous_slugs: string[]
          project_id: string
          slug: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["line_status"]
          territory: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          accent?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          description?: string | null
          dossier_url?: string | null
          end_date?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["line_kind"]
          last_navigated_at?: string | null
          modules?: Json | null
          name: string
          notes?: string | null
          previous_slugs?: string[]
          project_id: string
          slug?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["line_status"]
          territory?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          accent?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          description?: string | null
          dossier_url?: string | null
          end_date?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["line_kind"]
          last_navigated_at?: string | null
          modules?: Json | null
          name?: string
          notes?: string | null
          previous_slugs?: string[]
          project_id?: string
          slug?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["line_status"]
          territory?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "line_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_account: {
        Row: {
          address: string
          connected_by: string | null
          created_at: string
          id: string
          last_error: string | null
          last_synced_at: string | null
          messages_ingested: number
          owner_user_id: string | null
          provider: Database["public"]["Enums"]["mail_provider"]
          refresh_token_ciphertext: string
          scope: Database["public"]["Enums"]["mail_account_scope"]
          signature: string | null
          status: Database["public"]["Enums"]["mail_account_status"]
          sync_cursor: string | null
          sync_from: string
          sync_started_at: string | null
          token_key_version: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          address: string
          connected_by?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          messages_ingested?: number
          owner_user_id?: string | null
          provider: Database["public"]["Enums"]["mail_provider"]
          refresh_token_ciphertext: string
          scope: Database["public"]["Enums"]["mail_account_scope"]
          signature?: string | null
          status?: Database["public"]["Enums"]["mail_account_status"]
          sync_cursor?: string | null
          sync_from?: string
          sync_started_at?: string | null
          token_key_version?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          address?: string
          connected_by?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          messages_ingested?: number
          owner_user_id?: string | null
          provider?: Database["public"]["Enums"]["mail_provider"]
          refresh_token_ciphertext?: string
          scope?: Database["public"]["Enums"]["mail_account_scope"]
          signature?: string | null
          status?: Database["public"]["Enums"]["mail_account_status"]
          sync_cursor?: string | null
          sync_from?: string
          sync_started_at?: string | null
          token_key_version?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_account_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_account_address: {
        Row: {
          address: string
          backfilled_at: string
          mail_account_id: string
        }
        Insert: {
          address: string
          backfilled_at?: string
          mail_account_id: string
        }
        Update: {
          address?: string
          backfilled_at?: string
          mail_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_account_address_mail_account_id_fkey"
            columns: ["mail_account_id"]
            isOneToOne: false
            referencedRelation: "mail_account"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_basis: {
        Row: {
          address: string
          evidence_event_id: string | null
          kind: Database["public"]["Enums"]["mail_basis_kind"]
          note: string | null
          recorded_at: string
          recorded_by: string | null
          updated_at: string
          withdrawn_at: string | null
          workspace_id: string
        }
        Insert: {
          address: string
          evidence_event_id?: string | null
          kind: Database["public"]["Enums"]["mail_basis_kind"]
          note?: string | null
          recorded_at?: string
          recorded_by?: string | null
          updated_at?: string
          withdrawn_at?: string | null
          workspace_id: string
        }
        Update: {
          address?: string
          evidence_event_id?: string | null
          kind?: Database["public"]["Enums"]["mail_basis_kind"]
          note?: string | null
          recorded_at?: string
          recorded_by?: string | null
          updated_at?: string
          withdrawn_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_basis_evidence_event_id_fkey"
            columns: ["evidence_event_id"]
            isOneToOne: false
            referencedRelation: "conversation_event"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_basis_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_domain: {
        Row: {
          checked_at: string | null
          configuration_set: string | null
          created_at: string
          created_by: string | null
          dkim_status: string
          dmarc_record: string | null
          dns_records: Json
          domain: string
          from_local_part: string
          from_name: string | null
          id: string
          last_error: string | null
          mail_from_status: string
          mail_from_subdomain: string
          provider: Database["public"]["Enums"]["mail_sending_provider"]
          tenant_name: string | null
          updated_at: string
          verified_at: string | null
          workspace_id: string
        }
        Insert: {
          checked_at?: string | null
          configuration_set?: string | null
          created_at?: string
          created_by?: string | null
          dkim_status?: string
          dmarc_record?: string | null
          dns_records?: Json
          domain: string
          from_local_part?: string
          from_name?: string | null
          id?: string
          last_error?: string | null
          mail_from_status?: string
          mail_from_subdomain?: string
          provider?: Database["public"]["Enums"]["mail_sending_provider"]
          tenant_name?: string | null
          updated_at?: string
          verified_at?: string | null
          workspace_id: string
        }
        Update: {
          checked_at?: string | null
          configuration_set?: string | null
          created_at?: string
          created_by?: string | null
          dkim_status?: string
          dmarc_record?: string | null
          dns_records?: Json
          domain?: string
          from_local_part?: string
          from_name?: string | null
          id?: string
          last_error?: string | null
          mail_from_status?: string
          mail_from_subdomain?: string
          provider?: Database["public"]["Enums"]["mail_sending_provider"]
          tenant_name?: string | null
          updated_at?: string
          verified_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_domain_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_message: {
        Row: {
          deferred: boolean
          events_created: number
          mail_account_id: string
          processed_at: string
          provider_message_id: string
          provider_thread_id: string | null
          refs: string[]
          rfc_message_id: string | null
        }
        Insert: {
          deferred?: boolean
          events_created?: number
          mail_account_id: string
          processed_at?: string
          provider_message_id: string
          provider_thread_id?: string | null
          refs?: string[]
          rfc_message_id?: string | null
        }
        Update: {
          deferred?: boolean
          events_created?: number
          mail_account_id?: string
          processed_at?: string
          provider_message_id?: string
          provider_thread_id?: string | null
          refs?: string[]
          rfc_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mail_message_mail_account_id_fkey"
            columns: ["mail_account_id"]
            isOneToOne: false
            referencedRelation: "mail_account"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_suppression: {
        Row: {
          address: string
          created_at: string
          created_by: string | null
          mailout_recipient_id: string | null
          reason: Database["public"]["Enums"]["mail_suppression_reason"]
          workspace_id: string
        }
        Insert: {
          address: string
          created_at?: string
          created_by?: string | null
          mailout_recipient_id?: string | null
          reason: Database["public"]["Enums"]["mail_suppression_reason"]
          workspace_id: string
        }
        Update: {
          address?: string
          created_at?: string
          created_by?: string | null
          mailout_recipient_id?: string | null
          reason?: Database["public"]["Enums"]["mail_suppression_reason"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_suppression_mailout_recipient_id_fkey"
            columns: ["mailout_recipient_id"]
            isOneToOne: false
            referencedRelation: "mailout_recipient"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_suppression_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      mailout: {
        Row: {
          body: string | null
          created_at: string
          created_by: string | null
          finished_at: string | null
          from_address: string | null
          from_local_part: string
          from_name: string | null
          id: string
          language: string
          line_id: string | null
          mail_domain_id: string | null
          project_id: string
          queued_at: string | null
          queued_by: string | null
          reply_to_address: string | null
          reply_to_mail_account_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["mailout_status"]
          status_reason: string | null
          subject: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          from_address?: string | null
          from_local_part?: string
          from_name?: string | null
          id?: string
          language?: string
          line_id?: string | null
          mail_domain_id?: string | null
          project_id: string
          queued_at?: string | null
          queued_by?: string | null
          reply_to_address?: string | null
          reply_to_mail_account_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["mailout_status"]
          status_reason?: string | null
          subject?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          from_address?: string | null
          from_local_part?: string
          from_name?: string | null
          id?: string
          language?: string
          line_id?: string | null
          mail_domain_id?: string | null
          project_id?: string
          queued_at?: string | null
          queued_by?: string | null
          reply_to_address?: string | null
          reply_to_mail_account_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["mailout_status"]
          status_reason?: string | null
          subject?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mailout_domain_fkey"
            columns: ["mail_domain_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "mail_domain"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "mailout_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mailout_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mailout_reply_to_mail_account_id_fkey"
            columns: ["reply_to_mail_account_id"]
            isOneToOne: false
            referencedRelation: "mail_account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mailout_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      mailout_event: {
        Row: {
          bounce_type: string | null
          created_at: string
          detail: Json
          id: string
          occurred_at: string
          provider_event_id: string
          recipient_id: string
          type: Database["public"]["Enums"]["mailout_event_type"]
          workspace_id: string
        }
        Insert: {
          bounce_type?: string | null
          created_at?: string
          detail?: Json
          id?: string
          occurred_at: string
          provider_event_id: string
          recipient_id: string
          type: Database["public"]["Enums"]["mailout_event_type"]
          workspace_id: string
        }
        Update: {
          bounce_type?: string | null
          created_at?: string
          detail?: Json
          id?: string
          occurred_at?: string
          provider_event_id?: string
          recipient_id?: string
          type?: Database["public"]["Enums"]["mailout_event_type"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mailout_event_recipient_fkey"
            columns: ["recipient_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "mailout_recipient"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      mailout_recipient: {
        Row: {
          address: string | null
          address_kind:
            | Database["public"]["Enums"]["mailout_address_kind"]
            | null
          attempts: number
          basis_kind: Database["public"]["Enums"]["mail_basis_kind"] | null
          claimed_at: string | null
          conversation_event_id: string | null
          conversation_id: string
          created_at: string
          display_name: string | null
          id: string
          last_error: string | null
          mailout_id: string
          next_attempt_at: string | null
          person_id: string | null
          provider_message_id: string | null
          rfc_message_id: string | null
          sent_at: string | null
          skip_reason: Database["public"]["Enums"]["mailout_skip_reason"] | null
          status: Database["public"]["Enums"]["mailout_recipient_status"]
          unsubscribe_token: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          address?: string | null
          address_kind?:
            | Database["public"]["Enums"]["mailout_address_kind"]
            | null
          attempts?: number
          basis_kind?: Database["public"]["Enums"]["mail_basis_kind"] | null
          claimed_at?: string | null
          conversation_event_id?: string | null
          conversation_id: string
          created_at?: string
          display_name?: string | null
          id?: string
          last_error?: string | null
          mailout_id: string
          next_attempt_at?: string | null
          person_id?: string | null
          provider_message_id?: string | null
          rfc_message_id?: string | null
          sent_at?: string | null
          skip_reason?:
            | Database["public"]["Enums"]["mailout_skip_reason"]
            | null
          status?: Database["public"]["Enums"]["mailout_recipient_status"]
          unsubscribe_token?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          address?: string | null
          address_kind?:
            | Database["public"]["Enums"]["mailout_address_kind"]
            | null
          attempts?: number
          basis_kind?: Database["public"]["Enums"]["mail_basis_kind"] | null
          claimed_at?: string | null
          conversation_event_id?: string | null
          conversation_id?: string
          created_at?: string
          display_name?: string | null
          id?: string
          last_error?: string | null
          mailout_id?: string
          next_attempt_at?: string | null
          person_id?: string | null
          provider_message_id?: string | null
          rfc_message_id?: string | null
          sent_at?: string | null
          skip_reason?:
            | Database["public"]["Enums"]["mailout_skip_reason"]
            | null
          status?: Database["public"]["Enums"]["mailout_recipient_status"]
          unsubscribe_token?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mailout_recipient_conversation_event_id_fkey"
            columns: ["conversation_event_id"]
            isOneToOne: false
            referencedRelation: "conversation_event"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mailout_recipient_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mailout_recipient_mailout_fkey"
            columns: ["mailout_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "mailout"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "mailout_recipient_person_fkey"
            columns: ["workspace_id", "person_id"]
            isOneToOne: false
            referencedRelation: "workspace_person"
            referencedColumns: ["workspace_id", "person_id"]
          },
        ]
      }
      membership: {
        Row: {
          accepted_at: string | null
          bolo_id: string | null
          can_edit_meta: boolean
          container_verb: Database["public"]["Enums"]["access_verb"] | null
          created_at: string
          id: string
          invited_by: string | null
          level: Database["public"]["Enums"]["container_level"]
          line_id: string | null
          mail_signature: string | null
          performance_id: string | null
          preset: string | null
          project_id: string | null
          roles: string[]
          updated_at: string
          user_id: string
          workspace_id: string
          workspace_role: Database["public"]["Enums"]["membership_role"] | null
        }
        Insert: {
          accepted_at?: string | null
          bolo_id?: string | null
          can_edit_meta?: boolean
          container_verb?: Database["public"]["Enums"]["access_verb"] | null
          created_at?: string
          id?: string
          invited_by?: string | null
          level: Database["public"]["Enums"]["container_level"]
          line_id?: string | null
          mail_signature?: string | null
          performance_id?: string | null
          preset?: string | null
          project_id?: string | null
          roles?: string[]
          updated_at?: string
          user_id: string
          workspace_id: string
          workspace_role?: Database["public"]["Enums"]["membership_role"] | null
        }
        Update: {
          accepted_at?: string | null
          bolo_id?: string | null
          can_edit_meta?: boolean
          container_verb?: Database["public"]["Enums"]["access_verb"] | null
          created_at?: string
          id?: string
          invited_by?: string | null
          level?: Database["public"]["Enums"]["container_level"]
          line_id?: string | null
          mail_signature?: string | null
          performance_id?: string | null
          preset?: string | null
          project_id?: string | null
          roles?: string[]
          updated_at?: string
          user_id?: string
          workspace_id?: string
          workspace_role?: Database["public"]["Enums"]["membership_role"] | null
        }
        Relationships: [
          {
            foreignKeyName: "membership_bolo_id_fkey"
            columns: ["bolo_id"]
            isOneToOne: false
            referencedRelation: "bolo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_performance_id_fkey"
            columns: ["performance_id"]
            isOneToOne: false
            referencedRelation: "performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_preset_fkey"
            columns: ["preset"]
            isOneToOne: false
            referencedRelation: "access_preset"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "membership_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_facet: {
        Row: {
          created_at: string
          facet_id: string
          granted_by: string | null
          membership_id: string
          source: string
          verb: Database["public"]["Enums"]["access_verb"]
        }
        Insert: {
          created_at?: string
          facet_id: string
          granted_by?: string | null
          membership_id: string
          source: string
          verb: Database["public"]["Enums"]["access_verb"]
        }
        Update: {
          created_at?: string
          facet_id?: string
          granted_by?: string | null
          membership_id?: string
          source?: string
          verb?: Database["public"]["Enums"]["access_verb"]
        }
        Relationships: [
          {
            foreignKeyName: "membership_facet_facet_id_fkey"
            columns: ["facet_id"]
            isOneToOne: false
            referencedRelation: "facet"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_facet_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "membership"
            referencedColumns: ["id"]
          },
        ]
      }
      message: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          performance_id: string | null
          thread_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          performance_id?: string | null
          thread_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          performance_id?: string | null
          thread_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_performance_id_fkey"
            columns: ["performance_id"]
            isOneToOne: false
            referencedRelation: "performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_thread_fk"
            columns: ["thread_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "thread"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      note: {
        Row: {
          author_id: string
          body: string
          created_at: string
          date_id: string | null
          deleted_at: string | null
          id: string
          line_id: string | null
          on_day: string
          performance_id: string | null
          person_id: string | null
          project_id: string | null
          updated_at: string
          visibility: Database["public"]["Enums"]["note_visibility"]
          workspace_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          date_id?: string | null
          deleted_at?: string | null
          id?: string
          line_id?: string | null
          on_day: string
          performance_id?: string | null
          person_id?: string | null
          project_id?: string | null
          updated_at?: string
          visibility?: Database["public"]["Enums"]["note_visibility"]
          workspace_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          date_id?: string | null
          deleted_at?: string | null
          id?: string
          line_id?: string | null
          on_day?: string
          performance_id?: string | null
          person_id?: string | null
          project_id?: string | null
          updated_at?: string
          visibility?: Database["public"]["Enums"]["note_visibility"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_date_id_fkey"
            columns: ["date_id"]
            isOneToOne: false
            referencedRelation: "date"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_performance_id_fkey"
            columns: ["performance_id"]
            isOneToOne: false
            referencedRelation: "performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      payment: {
        Row: {
          amount: number
          bolo_id: string | null
          category: string | null
          counterparty: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          idempotency_key: string | null
          invoice_id: string | null
          line_id: string | null
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          project_id: string | null
          received_on: string
          reference: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount: number
          bolo_id?: string | null
          category?: string | null
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id?: string | null
          line_id?: string | null
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          project_id?: string | null
          received_on?: string
          reference?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          bolo_id?: string | null
          category?: string | null
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id?: string | null
          line_id?: string | null
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          project_id?: string | null
          received_on?: string
          reference?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_bolo_id_fkey"
            columns: ["bolo_id"]
            isOneToOne: false
            referencedRelation: "bolo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      performance: {
        Row: {
          bolo_id: string | null
          city: string | null
          conversation_id: string | null
          country: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          hold_notice_days: number | null
          hospitality: Json
          id: string
          line_id: string | null
          logistics: Json
          notes: string | null
          performed_at: string
          previous_slugs: string[]
          project_id: string
          readiness: Json
          series_id: string | null
          slug: string | null
          status: Database["public"]["Enums"]["performance_status"]
          technical: Json
          updated_at: string
          venue_id: string | null
          venue_name: string | null
          workspace_id: string
        }
        Insert: {
          bolo_id?: string | null
          city?: string | null
          conversation_id?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          hold_notice_days?: number | null
          hospitality?: Json
          id?: string
          line_id?: string | null
          logistics?: Json
          notes?: string | null
          performed_at: string
          previous_slugs?: string[]
          project_id: string
          readiness?: Json
          series_id?: string | null
          slug?: string | null
          status?: Database["public"]["Enums"]["performance_status"]
          technical?: Json
          updated_at?: string
          venue_id?: string | null
          venue_name?: string | null
          workspace_id: string
        }
        Update: {
          bolo_id?: string | null
          city?: string | null
          conversation_id?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          hold_notice_days?: number | null
          hospitality?: Json
          id?: string
          line_id?: string | null
          logistics?: Json
          notes?: string | null
          performed_at?: string
          previous_slugs?: string[]
          project_id?: string
          readiness?: Json
          series_id?: string | null
          slug?: string | null
          status?: Database["public"]["Enums"]["performance_status"]
          technical?: Json
          updated_at?: string
          venue_id?: string | null
          venue_name?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_bolo_id_fkey"
            columns: ["bolo_id"]
            isOneToOne: false
            referencedRelation: "bolo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      person: {
        Row: {
          city: string | null
          country: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          email: string | null
          first_name: string | null
          full_name: string
          id: string
          languages: string[]
          last_name: string | null
          organization_name: string | null
          phone: string | null
          previous_slugs: string[]
          slug: string
          title: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          email?: string | null
          first_name?: string | null
          full_name: string
          id?: string
          languages?: string[]
          last_name?: string | null
          organization_name?: string | null
          phone?: string | null
          previous_slugs?: string[]
          slug: string
          title?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string
          id?: string
          languages?: string[]
          last_name?: string | null
          organization_name?: string | null
          phone?: string | null
          previous_slugs?: string[]
          slug?: string
          title?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      project: {
        Row: {
          accent: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          description: string | null
          dossier_url: string | null
          ends_on: string | null
          id: string
          initials: string | null
          name: string
          notes: string | null
          poster_url: string | null
          previous_slugs: string[]
          slug: string
          starts_on: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          accent?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          description?: string | null
          dossier_url?: string | null
          ends_on?: string | null
          id?: string
          initials?: string | null
          name: string
          notes?: string | null
          poster_url?: string | null
          previous_slugs?: string[]
          slug: string
          starts_on?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          accent?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          description?: string | null
          dossier_url?: string | null
          ends_on?: string | null
          id?: string
          initials?: string | null
          name?: string
          notes?: string | null
          poster_url?: string | null
          previous_slugs?: string[]
          slug?: string
          starts_on?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      roadsheet_share: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          performance_id: string
          revoked_at: string | null
          role: string
          token: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          performance_id: string
          revoked_at?: string | null
          role: string
          token: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          performance_id?: string
          revoked_at?: string | null
          role?: string
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadsheet_share_performance_id_fkey"
            columns: ["performance_id"]
            isOneToOne: false
            referencedRelation: "performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadsheet_share_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_slot: {
        Row: {
          at: string
          created_at: string
          created_by: string | null
          date_id: string | null
          ends_at: string | null
          id: string
          kind: string | null
          label: string | null
          notes: string | null
          performance_id: string | null
          project_id: string
          sort: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          at: string
          created_at?: string
          created_by?: string | null
          date_id?: string | null
          ends_at?: string | null
          id?: string
          kind?: string | null
          label?: string | null
          notes?: string | null
          performance_id?: string | null
          project_id: string
          sort: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          at?: string
          created_at?: string
          created_by?: string | null
          date_id?: string | null
          ends_at?: string | null
          id?: string
          kind?: string | null
          label?: string | null
          notes?: string | null
          performance_id?: string | null
          project_id?: string
          sort?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_slot_date_id_fkey"
            columns: ["date_id"]
            isOneToOne: false
            referencedRelation: "date"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_slot_performance_id_fkey"
            columns: ["performance_id"]
            isOneToOne: false
            referencedRelation: "performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_slot_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_slot_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      task: {
        Row: {
          conversation_id: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          due_at: string | null
          from_at: string | null
          id: string
          lead_days: number | null
          line_id: string | null
          note: string | null
          origin: Database["public"]["Enums"]["task_origin"]
          performance_id: string | null
          project_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          due_at?: string | null
          from_at?: string | null
          id?: string
          lead_days?: number | null
          line_id?: string | null
          note?: string | null
          origin?: Database["public"]["Enums"]["task_origin"]
          performance_id?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          due_at?: string | null
          from_at?: string | null
          id?: string
          lead_days?: number | null
          line_id?: string | null
          note?: string | null
          origin?: Database["public"]["Enums"]["task_origin"]
          performance_id?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_performance_id_fkey"
            columns: ["performance_id"]
            isOneToOne: false
            referencedRelation: "performance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      thread: {
        Row: {
          bolo_id: string | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          facet_id: string | null
          id: string
          last_message_at: string | null
          line_id: string | null
          project_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          bolo_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          facet_id?: string | null
          id?: string
          last_message_at?: string | null
          line_id?: string | null
          project_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          bolo_id?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          facet_id?: string | null
          id?: string
          last_message_at?: string | null
          line_id?: string | null
          project_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_bolo_id_fkey"
            columns: ["bolo_id"]
            isOneToOne: false
            referencedRelation: "bolo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_facet_id_fkey"
            columns: ["facet_id"]
            isOneToOne: false
            referencedRelation: "facet"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      thread_read: {
        Row: {
          last_read_at: string
          thread_id: string
          user_id: string
        }
        Insert: {
          last_read_at?: string
          thread_id: string
          user_id: string
        }
        Update: {
          last_read_at?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_read_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "thread"
            referencedColumns: ["id"]
          },
        ]
      }
      travel_stage: {
        Row: {
          arrive_at: string | null
          arrive_tz: string | null
          created_at: string
          created_by: string | null
          date_id: string
          depart_at: string | null
          depart_tz: string | null
          from_city: string | null
          from_country: string | null
          from_place: string | null
          from_venue_id: string | null
          id: string
          mode: Database["public"]["Enums"]["transport_mode"]
          notes: string | null
          position: number
          project_id: string
          reference: string | null
          to_city: string | null
          to_country: string | null
          to_place: string | null
          to_venue_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          arrive_at?: string | null
          arrive_tz?: string | null
          created_at?: string
          created_by?: string | null
          date_id: string
          depart_at?: string | null
          depart_tz?: string | null
          from_city?: string | null
          from_country?: string | null
          from_place?: string | null
          from_venue_id?: string | null
          id?: string
          mode?: Database["public"]["Enums"]["transport_mode"]
          notes?: string | null
          position: number
          project_id: string
          reference?: string | null
          to_city?: string | null
          to_country?: string | null
          to_place?: string | null
          to_venue_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          arrive_at?: string | null
          arrive_tz?: string | null
          created_at?: string
          created_by?: string | null
          date_id?: string
          depart_at?: string | null
          depart_tz?: string | null
          from_city?: string | null
          from_country?: string | null
          from_place?: string | null
          from_venue_id?: string | null
          id?: string
          mode?: Database["public"]["Enums"]["transport_mode"]
          notes?: string | null
          position?: number
          project_id?: string
          reference?: string | null
          to_city?: string | null
          to_country?: string | null
          to_place?: string | null
          to_venue_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "travel_stage_date_id_fkey"
            columns: ["date_id"]
            isOneToOne: false
            referencedRelation: "date"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "travel_stage_from_venue_id_fkey"
            columns: ["from_venue_id"]
            isOneToOne: false
            referencedRelation: "venue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "travel_stage_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "travel_stage_to_venue_id_fkey"
            columns: ["to_venue_id"]
            isOneToOne: false
            referencedRelation: "venue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "travel_stage_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profile: {
        Row: {
          avatar_url: string | null
          bio: string | null
          city: string | null
          country: string | null
          created_at: string
          first_name: string | null
          full_name: string
          is_platform_admin: boolean
          languages: string[]
          last_name: string | null
          locale: string
          person_id: string | null
          phone: string | null
          professional_title: string | null
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          first_name?: string | null
          full_name: string
          is_platform_admin?: boolean
          languages?: string[]
          last_name?: string | null
          locale?: string
          person_id?: string | null
          phone?: string | null
          professional_title?: string | null
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          first_name?: string | null
          full_name?: string
          is_platform_admin?: boolean
          languages?: string[]
          last_name?: string | null
          locale?: string
          person_id?: string | null
          phone?: string | null
          professional_title?: string | null
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profile_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
        ]
      }
      venue: {
        Row: {
          address: string | null
          capacity: number | null
          city: string | null
          contacts: Json
          country: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          directory_id: string | null
          id: string
          name: string
          notes: string | null
          previous_slugs: string[]
          slug: string | null
          timezone: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          address?: string | null
          capacity?: number | null
          city?: string | null
          contacts?: Json
          country?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          directory_id?: string | null
          id?: string
          name: string
          notes?: string | null
          previous_slugs?: string[]
          slug?: string | null
          timezone?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          address?: string | null
          capacity?: number | null
          city?: string | null
          contacts?: Json
          country?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          directory_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          previous_slugs?: string[]
          slug?: string | null
          timezone?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "venue_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_directory: {
        Row: {
          address: string | null
          capacity: number | null
          city: string | null
          country: string
          created_at: string
          designation: string | null
          email: string | null
          field_sources: Json
          first_seen_at: string
          id: string
          kind: string
          last_seen_at: string
          latitude: number | null
          longitude: number | null
          name: string
          phone: string | null
          postal_code: string | null
          region: string | null
          search_key: string
          source: string
          source_id: string
          sources: Json
          status: string
          timezone: string | null
          updated_at: string
          website: string | null
          wikidata_qid: string | null
        }
        Insert: {
          address?: string | null
          capacity?: number | null
          city?: string | null
          country: string
          created_at?: string
          designation?: string | null
          email?: string | null
          field_sources?: Json
          first_seen_at?: string
          id?: string
          kind: string
          last_seen_at?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          phone?: string | null
          postal_code?: string | null
          region?: string | null
          search_key: string
          source: string
          source_id: string
          sources?: Json
          status?: string
          timezone?: string | null
          updated_at?: string
          website?: string | null
          wikidata_qid?: string | null
        }
        Update: {
          address?: string | null
          capacity?: number | null
          city?: string | null
          country?: string
          created_at?: string
          designation?: string | null
          email?: string | null
          field_sources?: Json
          first_seen_at?: string
          id?: string
          kind?: string
          last_seen_at?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          phone?: string | null
          postal_code?: string | null
          region?: string | null
          search_key?: string
          source?: string
          source_id?: string
          sources?: Json
          status?: string
          timezone?: string | null
          updated_at?: string
          website?: string | null
          wikidata_qid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venue_directory_source_fkey"
            columns: ["source"]
            isOneToOne: false
            referencedRelation: "venue_directory_source"
            referencedColumns: ["key"]
          },
        ]
      }
      venue_directory_source: {
        Row: {
          attribution: string
          data_date: string | null
          imported_at: string | null
          key: string
          license: string
          license_url: string
          name: string
          publisher: string
          source_url: string
        }
        Insert: {
          attribution: string
          data_date?: string | null
          imported_at?: string | null
          key: string
          license: string
          license_url: string
          name: string
          publisher: string
          source_url: string
        }
        Update: {
          attribution?: string
          data_date?: string | null
          imported_at?: string | null
          key?: string
          license?: string
          license_url?: string
          name?: string
          publisher?: string
          source_url?: string
        }
        Relationships: []
      }
      workspace: {
        Row: {
          accent: string | null
          account_id: string
          alias: string | null
          city: string | null
          country: string | null
          created_at: string
          custom_fields: Json
          deleted_at: string | null
          description: string | null
          domain: Database["public"]["Enums"]["workspace_domain"] | null
          fiscal_identity_id: string | null
          id: string
          kind: Database["public"]["Enums"]["workspace_kind"]
          logo_url: string | null
          mail_signature: string | null
          mailout_daily_cap: number
          mailout_reviewed_at: string | null
          mailout_reviewed_by: string | null
          mailout_simulator_only: boolean
          name: string
          new_conversations_private: boolean
          phone: string | null
          previous_slugs: string[]
          privacy_url: string | null
          settings: Json
          slug: string
          timezone: string
          updated_at: string
          website: string | null
        }
        Insert: {
          accent?: string | null
          account_id: string
          alias?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          custom_fields?: Json
          deleted_at?: string | null
          description?: string | null
          domain?: Database["public"]["Enums"]["workspace_domain"] | null
          fiscal_identity_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["workspace_kind"]
          logo_url?: string | null
          mail_signature?: string | null
          mailout_daily_cap?: number
          mailout_reviewed_at?: string | null
          mailout_reviewed_by?: string | null
          mailout_simulator_only?: boolean
          name: string
          new_conversations_private?: boolean
          phone?: string | null
          previous_slugs?: string[]
          privacy_url?: string | null
          settings?: Json
          slug: string
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          accent?: string | null
          account_id?: string
          alias?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          custom_fields?: Json
          deleted_at?: string | null
          description?: string | null
          domain?: Database["public"]["Enums"]["workspace_domain"] | null
          fiscal_identity_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["workspace_kind"]
          logo_url?: string | null
          mail_signature?: string | null
          mailout_daily_cap?: number
          mailout_reviewed_at?: string | null
          mailout_reviewed_by?: string | null
          mailout_simulator_only?: boolean
          name?: string
          new_conversations_private?: boolean
          phone?: string | null
          previous_slugs?: string[]
          privacy_url?: string | null
          settings?: Json
          slug?: string
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspace_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_fiscal_identity_id_fkey"
            columns: ["fiscal_identity_id"]
            isOneToOne: false
            referencedRelation: "fiscal_identity"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_alias_request: {
        Row: {
          alias: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          requested_by: string
          status: string
          workspace_id: string
          workspace_name: string
        }
        Insert: {
          alias: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          requested_by: string
          status?: string
          workspace_id: string
          workspace_name: string
        }
        Update: {
          alias?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          requested_by?: string
          status?: string
          workspace_id?: string
          workspace_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_alias_request_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_facet_setting: {
        Row: {
          active: boolean
          facet_id: string
          label: string | null
          labels: Json
          sort: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          facet_id: string
          label?: string | null
          labels?: Json
          sort?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          facet_id?: string
          label?: string | null
          labels?: Json
          sort?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_facet_setting_facet_id_fkey"
            columns: ["facet_id"]
            isOneToOne: false
            referencedRelation: "facet"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_facet_setting_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invitation: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          person_id: string | null
          project_id: string | null
          project_preset: string | null
          project_role_code: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["membership_role"]
          token_hash: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          person_id?: string | null
          project_id?: string | null
          project_preset?: string | null
          project_role_code?: string | null
          revoked_at?: string | null
          role: Database["public"]["Enums"]["membership_role"]
          token_hash: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          person_id?: string | null
          project_id?: string | null
          project_preset?: string | null
          project_role_code?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["membership_role"]
          token_hash?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invitation_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invitation_project_preset_fkey"
            columns: ["project_preset"]
            isOneToOne: false
            referencedRelation: "access_preset"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "workspace_invitation_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invitation_workspace_person_fkey"
            columns: ["workspace_id", "person_id"]
            isOneToOne: false
            referencedRelation: "workspace_person"
            referencedColumns: ["workspace_id", "person_id"]
          },
        ]
      }
      workspace_organization: {
        Row: {
          address: string | null
          city: string | null
          country: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          email: string | null
          fiscal_identity_id: string | null
          id: string
          kind: string
          name: string
          notes: string | null
          phone: string | null
          slug: string
          updated_at: string
          website: string | null
          workspace_id: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          email?: string | null
          fiscal_identity_id?: string | null
          id?: string
          kind?: string
          name: string
          notes?: string | null
          phone?: string | null
          slug: string
          updated_at?: string
          website?: string | null
          workspace_id: string
        }
        Update: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          email?: string | null
          fiscal_identity_id?: string | null
          id?: string
          kind?: string
          name?: string
          notes?: string | null
          phone?: string | null
          slug?: string
          updated_at?: string
          website?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_organization_fiscal_identity_id_fkey"
            columns: ["fiscal_identity_id"]
            isOneToOne: false
            referencedRelation: "fiscal_identity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_organization_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_person: {
        Row: {
          city: string | null
          country: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          email: string | null
          first_name: string | null
          full_name: string
          languages: string[]
          last_name: string | null
          notes: string | null
          organization_id: string | null
          person_id: string
          phone: string | null
          profile_shared_at: string | null
          profile_shared_fields: string[]
          profile_sync_enabled: boolean
          slug: string
          title: string | null
          updated_at: string
          website: string | null
          workspace_id: string
        }
        Insert: {
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          email?: string | null
          first_name?: string | null
          full_name: string
          languages?: string[]
          last_name?: string | null
          notes?: string | null
          organization_id?: string | null
          person_id: string
          phone?: string | null
          profile_shared_at?: string | null
          profile_shared_fields?: string[]
          profile_sync_enabled?: boolean
          slug: string
          title?: string | null
          updated_at?: string
          website?: string | null
          workspace_id: string
        }
        Update: {
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string
          languages?: string[]
          last_name?: string | null
          notes?: string | null
          organization_id?: string | null
          person_id?: string
          phone?: string | null
          profile_shared_at?: string | null
          profile_shared_fields?: string[]
          profile_sync_enabled?: boolean
          slug?: string
          title?: string | null
          updated_at?: string
          website?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_person_organization_fkey"
            columns: ["workspace_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "workspace_organization"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "workspace_person_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_person_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_role: {
        Row: {
          archived_at: string | null
          code: string
          created_at: string
          id: string
          is_system: boolean
          label: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          code: string
          created_at?: string
          id?: string
          is_system?: boolean
          label: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          code?: string
          created_at?: string
          id?: string
          is_system?: boolean
          label?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_role_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_workspace_invitation: {
        Args: { p_token: string }
        Returns: {
          role: Database["public"]["Enums"]["membership_role"]
          workspace_id: string
          workspace_name: string
          workspace_slug: string
        }[]
      }
      accessible_project_ids: { Args: { p_perm: string }; Returns: string[] }
      add_cast_member: {
        Args: { p_person_id: string; p_project_id: string; p_role: string }
        Returns: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          joined_at: string | null
          left_at: string | null
          notes: string | null
          person_id: string
          project_id: string
          role: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "cast_member"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_conversation_contact: {
        Args: {
          p_conversation_id: string
          p_email?: string
          p_full_name: string
          p_phone?: string
          p_role?: string
        }
        Returns: {
          conversation_id: string
          created_at: string
          created_by: string | null
          id: string
          is_primary: boolean
          person_id: string
          role: string | null
          since: string | null
          until: string | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "conversation_contact"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_mail_domain: {
        Args: {
          p_domain: string
          p_from_local_part?: string
          p_from_name?: string
          p_provider?: Database["public"]["Enums"]["mail_sending_provider"]
          p_workspace_id: string
        }
        Returns: {
          checked_at: string | null
          configuration_set: string | null
          created_at: string
          created_by: string | null
          dkim_status: string
          dmarc_record: string | null
          dns_records: Json
          domain: string
          from_local_part: string
          from_name: string | null
          id: string
          last_error: string | null
          mail_from_status: string
          mail_from_subdomain: string
          provider: Database["public"]["Enums"]["mail_sending_provider"]
          tenant_name: string | null
          updated_at: string
          verified_at: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mail_domain"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      adopt_directory_venue: {
        Args: { p_directory_id: string; p_workspace_id: string }
        Returns: {
          address: string | null
          capacity: number | null
          city: string | null
          contacts: Json
          country: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          directory_id: string | null
          id: string
          name: string
          notes: string | null
          previous_slugs: string[]
          slug: string | null
          timezone: string | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "venue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      bolo_board: { Args: { p_performance_id: string }; Returns: Json }
      bolo_status_can_move: {
        Args: { p_status: Database["public"]["Enums"]["performance_status"] }
        Returns: boolean
      }
      bolo_status_can_open: {
        Args: { p_status: Database["public"]["Enums"]["performance_status"] }
        Returns: boolean
      }
      can_access_project: { Args: { p_project_id: string }; Returns: boolean }
      can_edit_project: { Args: { p_project_id: string }; Returns: boolean }
      can_edit_workspace_money: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      can_manage_mail_account: {
        Args: { p_account_id: string }
        Returns: boolean
      }
      can_read_workspace_money: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      can_see_person: { Args: { p_person_id: string }; Returns: boolean }
      can_user_write_collab: {
        Args: { p_target_id: string; p_target_table: string; p_user_id: string }
        Returns: boolean
      }
      cancel_mailout: {
        Args: { p_id: string }
        Returns: {
          body: string | null
          created_at: string
          created_by: string | null
          finished_at: string | null
          from_address: string | null
          from_local_part: string
          from_name: string | null
          id: string
          language: string
          line_id: string | null
          mail_domain_id: string | null
          project_id: string
          queued_at: string | null
          queued_by: string | null
          reply_to_address: string | null
          reply_to_mail_account_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["mailout_status"]
          status_reason: string | null
          subject: string | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mailout"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      connect_mail_account: {
        Args: {
          p_address: string
          p_provider: Database["public"]["Enums"]["mail_provider"]
          p_refresh_token_ciphertext: string
          p_scope: Database["public"]["Enums"]["mail_account_scope"]
          p_token_key_version?: number
          p_workspace_id: string
        }
        Returns: string
      }
      conversation_for_contact_write: {
        Args: { p_conversation_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          first_contacted_at: string | null
          id: string
          last_contacted_at: string | null
          line_id: string | null
          next_action_at: string | null
          next_action_note: string | null
          organization_id: string
          previous_slugs: string[]
          private_to: string | null
          project_id: string
          slug: string
          status: Database["public"]["Enums"]["conversation_status"]
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "conversation"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      conversation_free_slug: {
        Args: { p_base: string; p_id: string; p_workspace_id: string }
        Returns: string
      }
      conversation_search: {
        Args: { p_q: string }
        Returns: {
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          first_contacted_at: string | null
          id: string
          last_contacted_at: string | null
          line_id: string | null
          next_action_at: string | null
          next_action_note: string | null
          organization_id: string
          previous_slugs: string[]
          private_to: string | null
          project_id: string
          slug: string
          status: Database["public"]["Enums"]["conversation_status"]
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "conversation"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_asset_version: {
        Args: {
          p_direction?: Database["public"]["Enums"]["asset_direction"]
          p_kind: Database["public"]["Enums"]["asset_kind"]
          p_line_id: string
          p_notes?: string
          p_url: string
        }
        Returns: {
          adapted_from_id: string | null
          created_at: string
          deleted_at: string | null
          direction: Database["public"]["Enums"]["asset_direction"]
          id: string
          kind: Database["public"]["Enums"]["asset_kind"]
          line_id: string | null
          notes: string | null
          performance_id: string | null
          previous_slugs: string[]
          project_id: string | null
          slug: string | null
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
          url: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "asset_version"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_availability_block: {
        Args: {
          p_certainty?: string
          p_ends_on: string
          p_note?: string
          p_person_id?: string
          p_starts_on: string
          p_workspace_id: string
        }
        Returns: {
          certainty: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          ends_on: string
          id: string
          note: string | null
          person_id: string | null
          starts_on: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "availability_block"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_bolo: {
        Args: {
          p_city?: string
          p_conversation_id?: string
          p_country?: string
          p_fee_amount?: number
          p_fee_currency?: string
          p_line_id?: string
          p_project_id: string
          p_status?: Database["public"]["Enums"]["performance_status"]
          p_venue_name?: string
        }
        Returns: {
          city: string | null
          conversation_id: string | null
          country: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          fee_amount: number | null
          fee_currency: string | null
          id: string
          line_id: string | null
          project_id: string
          status: Database["public"]["Enums"]["performance_status"]
          updated_at: string
          venue_name: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "bolo"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_calendar_share: {
        Args: { p_workspace_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          id: string
          revoked_at: string | null
          token: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "calendar_share"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_conversation: {
        Args: {
          p_email?: string
          p_full_name?: string
          p_line_id?: string
          p_next_action_at?: string
          p_next_action_note?: string
          p_organization_id?: string
          p_organization_name?: string
          p_person_id?: string
          p_phone?: string
          p_project_id: string
          p_role?: string
          p_status?: Database["public"]["Enums"]["conversation_status"]
          p_title?: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          first_contacted_at: string | null
          id: string
          last_contacted_at: string | null
          line_id: string | null
          next_action_at: string | null
          next_action_note: string | null
          organization_id: string
          previous_slugs: string[]
          private_to: string | null
          project_id: string
          slug: string
          status: Database["public"]["Enums"]["conversation_status"]
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "conversation"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_date: {
        Args: {
          p_all_day?: boolean
          p_city?: string
          p_country?: string
          p_destination_city?: string
          p_destination_country?: string
          p_ends_at?: string
          p_kind: Database["public"]["Enums"]["date_kind"]
          p_label?: string
          p_line_id?: string
          p_origin_city?: string
          p_origin_country?: string
          p_performance_id?: string
          p_project_id: string
          p_starts_at: string
          p_status?: Database["public"]["Enums"]["date_status"]
          p_title?: string
          p_travel_direction?: string
          p_venue_name?: string
        }
        Returns: {
          all_day: boolean
          city: string | null
          country: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          destination_city: string | null
          destination_country: string | null
          ends_at: string | null
          id: string
          kind: Database["public"]["Enums"]["date_kind"]
          line_id: string | null
          notes: string | null
          origin_city: string | null
          origin_country: string | null
          performance_id: string | null
          project_id: string
          season: string | null
          series_id: string | null
          starts_at: string
          status: Database["public"]["Enums"]["date_status"]
          title: string | null
          travel_direction: string | null
          updated_at: string
          venue_id: string | null
          venue_name: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "date"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_date_series: {
        Args: {
          p_all_day?: boolean
          p_city?: string
          p_country?: string
          p_ends?: string[]
          p_kind: Database["public"]["Enums"]["date_kind"]
          p_label?: string
          p_line_id?: string
          p_project_id: string
          p_starts: string[]
          p_status?: Database["public"]["Enums"]["date_status"]
          p_title?: string
          p_venue_name?: string
        }
        Returns: {
          all_day: boolean
          city: string | null
          country: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          destination_city: string | null
          destination_country: string | null
          ends_at: string | null
          id: string
          kind: Database["public"]["Enums"]["date_kind"]
          line_id: string | null
          notes: string | null
          origin_city: string | null
          origin_country: string | null
          performance_id: string | null
          project_id: string
          season: string | null
          series_id: string | null
          starts_at: string
          status: Database["public"]["Enums"]["date_status"]
          title: string | null
          travel_direction: string | null
          updated_at: string
          venue_id: string | null
          venue_name: string | null
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "date"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_expense: {
        Args: {
          p_amount?: number
          p_bolo_id?: string
          p_category?: Database["public"]["Enums"]["expense_category"]
          p_counterparty?: string
          p_currency?: string
          p_description?: string
          p_incurred_on?: string
          p_line_id?: string
          p_notes?: string
        }
        Returns: {
          amount: number
          bolo_id: string | null
          category: Database["public"]["Enums"]["expense_category"]
          counterparty: string | null
          created_at: string
          created_by: string | null
          currency: string
          custom_fields: Json
          deleted_at: string | null
          description: string
          id: string
          incurred_on: string
          line_id: string | null
          notes: string | null
          paid_by_user_id: string | null
          receipt_url: string | null
          reimbursed: boolean
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "expense"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_invoice_from_bolo: {
        Args: {
          p_bolo_id: string
          p_country?: string
          p_doc_type?: string
          p_due_on?: string
          p_expected_on?: string
          p_notes?: string
          p_number?: string
          p_payer_fiscal_identity_id?: string
          p_payer_organization_id?: string
          p_payment_condition?: string
          p_tax_lines?: Json
        }
        Returns: {
          country: string | null
          created_at: string
          created_by: string | null
          currency: string
          custom_fields: Json
          deleted_at: string | null
          doc_type: string
          due_on: string | null
          expected_on: string | null
          id: string
          issued_on: string
          issuer_fiscal_identity_id: string | null
          issuer_snapshot: Json | null
          notes: string | null
          number: string | null
          payer_fiscal_identity_id: string | null
          payer_organization_id: string | null
          payer_snapshot: Json | null
          payment_condition: string | null
          project_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          total: number
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "invoice"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_line: {
        Args: {
          p_accent?: string
          p_description?: string
          p_kind?: Database["public"]["Enums"]["line_kind"]
          p_modules?: Json
          p_name: string
          p_project_id: string
        }
        Returns: {
          accent: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          description: string | null
          dossier_url: string | null
          end_date: string | null
          id: string
          kind: Database["public"]["Enums"]["line_kind"]
          last_navigated_at: string | null
          modules: Json | null
          name: string
          notes: string | null
          previous_slugs: string[]
          project_id: string
          slug: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["line_status"]
          territory: string | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "line"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_mailout: {
        Args: {
          p_line_id?: string
          p_mail_domain_id?: string
          p_project_id: string
        }
        Returns: {
          body: string | null
          created_at: string
          created_by: string | null
          finished_at: string | null
          from_address: string | null
          from_local_part: string
          from_name: string | null
          id: string
          language: string
          line_id: string | null
          mail_domain_id: string | null
          project_id: string
          queued_at: string | null
          queued_by: string | null
          reply_to_address: string | null
          reply_to_mail_account_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["mailout_status"]
          status_reason: string | null
          subject: string | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mailout"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_note: {
        Args: {
          p_body: string
          p_date_id?: string
          p_line_id?: string
          p_on_day: string
          p_performance_id?: string
          p_person_id?: string
          p_project_id?: string
          p_workspace_id?: string
        }
        Returns: {
          author_id: string
          body: string
          created_at: string
          date_id: string | null
          deleted_at: string | null
          id: string
          line_id: string | null
          on_day: string
          performance_id: string | null
          person_id: string | null
          project_id: string | null
          updated_at: string
          visibility: Database["public"]["Enums"]["note_visibility"]
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "note"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_payment: {
        Args: {
          p_amount?: number
          p_bolo_id?: string
          p_category?: string
          p_counterparty?: string
          p_idempotency_key?: string
          p_invoice_id?: string
          p_line_id?: string
          p_method?: Database["public"]["Enums"]["payment_method"]
          p_notes?: string
          p_project_id?: string
          p_received_on?: string
          p_reference?: string
        }
        Returns: {
          amount: number
          bolo_id: string | null
          category: string | null
          counterparty: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          idempotency_key: string | null
          invoice_id: string | null
          line_id: string | null
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          project_id: string | null
          received_on: string
          reference: string | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "payment"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_performance: {
        Args: {
          p_bolo_id?: string
          p_city?: string
          p_conversation_id?: string
          p_country?: string
          p_line_id?: string
          p_performed_at: string
          p_project_id: string
          p_status?: Database["public"]["Enums"]["performance_status"]
          p_venue_name?: string
        }
        Returns: {
          bolo_id: string | null
          city: string | null
          conversation_id: string | null
          country: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          hold_notice_days: number | null
          hospitality: Json
          id: string
          line_id: string | null
          logistics: Json
          notes: string | null
          performed_at: string
          previous_slugs: string[]
          project_id: string
          readiness: Json
          series_id: string | null
          slug: string | null
          status: Database["public"]["Enums"]["performance_status"]
          technical: Json
          updated_at: string
          venue_id: string | null
          venue_name: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "performance"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_performance_series: {
        Args: {
          p_bolo_id?: string
          p_city?: string
          p_conversation_id?: string
          p_country?: string
          p_line_id?: string
          p_performed_at: string[]
          p_project_id: string
          p_status?: Database["public"]["Enums"]["performance_status"]
          p_venue_name?: string
        }
        Returns: {
          bolo_id: string | null
          city: string | null
          conversation_id: string | null
          country: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          hold_notice_days: number | null
          hospitality: Json
          id: string
          line_id: string | null
          logistics: Json
          notes: string | null
          performed_at: string
          previous_slugs: string[]
          project_id: string
          readiness: Json
          series_id: string | null
          slug: string | null
          status: Database["public"]["Enums"]["performance_status"]
          technical: Json
          updated_at: string
          venue_id: string | null
          venue_name: string | null
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "performance"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_project: {
        Args: {
          p_accent?: string
          p_description?: string
          p_name: string
          p_slug?: string
          p_workspace_id: string
        }
        Returns: {
          accent: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          description: string | null
          dossier_url: string | null
          ends_on: string | null
          id: string
          initials: string | null
          name: string
          notes: string | null
          poster_url: string | null
          previous_slugs: string[]
          slug: string
          starts_on: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "project"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_roadsheet_share: {
        Args: { p_performance_id: string; p_role: string }
        Returns: {
          created_at: string
          created_by: string | null
          id: string
          performance_id: string
          revoked_at: string | null
          role: string
          token: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "roadsheet_share"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_schedule_slot: {
        Args: {
          p_at: string
          p_ends_at?: string
          p_kind?: string
          p_label?: string
          p_notes?: string
          p_target_id: string
          p_target_table: string
        }
        Returns: {
          at: string
          created_at: string
          created_by: string | null
          date_id: string | null
          ends_at: string | null
          id: string
          kind: string | null
          label: string | null
          notes: string | null
          performance_id: string | null
          project_id: string
          sort: number
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "schedule_slot"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_task: {
        Args: {
          p_conversation_id?: string
          p_due_at?: string
          p_from_at?: string
          p_lead_days?: number
          p_line_id?: string
          p_note?: string
          p_performance_id?: string
          p_project_id?: string
          p_title: string
          p_workspace_id?: string
        }
        Returns: {
          conversation_id: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          due_at: string | null
          from_at: string | null
          id: string
          lead_days: number | null
          line_id: string | null
          note: string | null
          origin: Database["public"]["Enums"]["task_origin"]
          performance_id: string | null
          project_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "task"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_travel_stage: {
        Args: {
          p_arrive_at?: string
          p_arrive_tz?: string
          p_date_id: string
          p_depart_at?: string
          p_depart_tz?: string
          p_from_city?: string
          p_from_country?: string
          p_from_place?: string
          p_from_venue_id?: string
          p_mode?: Database["public"]["Enums"]["transport_mode"]
          p_notes?: string
          p_reference?: string
          p_to_city?: string
          p_to_country?: string
          p_to_place?: string
          p_to_venue_id?: string
        }
        Returns: {
          arrive_at: string | null
          arrive_tz: string | null
          created_at: string
          created_by: string | null
          date_id: string
          depart_at: string | null
          depart_tz: string | null
          from_city: string | null
          from_country: string | null
          from_place: string | null
          from_venue_id: string | null
          id: string
          mode: Database["public"]["Enums"]["transport_mode"]
          notes: string | null
          position: number
          project_id: string
          reference: string | null
          to_city: string | null
          to_country: string | null
          to_place: string | null
          to_venue_id: string | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "travel_stage"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_venue: {
        Args: {
          p_address?: string
          p_capacity?: number
          p_city?: string
          p_country?: string
          p_name: string
          p_timezone?: string
          p_workspace_id: string
        }
        Returns: {
          address: string | null
          capacity: number | null
          city: string | null
          contacts: Json
          country: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          directory_id: string | null
          id: string
          name: string
          notes: string | null
          previous_slugs: string[]
          slug: string | null
          timezone: string | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "venue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_workspace: {
        Args: {
          p_accent?: string
          p_description?: string
          p_name: string
          p_slug?: string
        }
        Returns: {
          accent: string | null
          account_id: string
          alias: string | null
          city: string | null
          country: string | null
          created_at: string
          custom_fields: Json
          deleted_at: string | null
          description: string | null
          domain: Database["public"]["Enums"]["workspace_domain"] | null
          fiscal_identity_id: string | null
          id: string
          kind: Database["public"]["Enums"]["workspace_kind"]
          logo_url: string | null
          mail_signature: string | null
          mailout_daily_cap: number
          mailout_reviewed_at: string | null
          mailout_reviewed_by: string | null
          mailout_simulator_only: boolean
          name: string
          new_conversations_private: boolean
          phone: string | null
          previous_slugs: string[]
          privacy_url: string | null
          settings: Json
          slug: string
          timezone: string
          updated_at: string
          website: string | null
        }
        SetofOptions: {
          from: "*"
          to: "workspace"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_workspace_invitation: {
        Args: {
          p_email: string
          p_expires_days?: number
          p_project_id?: string
          p_project_preset?: string
          p_project_role_code?: string
          p_role?: Database["public"]["Enums"]["membership_role"]
          p_workspace_id: string
        }
        Returns: {
          email: string
          expires_at: string
          id: string
          project_id: string
          project_role_code: string
          role: Database["public"]["Enums"]["membership_role"]
          token: string
        }[]
      }
      create_workspace_person: {
        Args: {
          p_email?: string
          p_full_name: string
          p_phone?: string
          p_title?: string
          p_workspace_id: string
        }
        Returns: {
          city: string | null
          country: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          email: string | null
          first_name: string | null
          full_name: string
          languages: string[]
          last_name: string | null
          notes: string | null
          organization_id: string | null
          person_id: string
          phone: string | null
          profile_shared_at: string | null
          profile_shared_fields: string[]
          profile_sync_enabled: boolean
          slug: string
          title: string | null
          updated_at: string
          website: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_person"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_user_id: { Args: never; Returns: string }
      current_workspace_id: { Args: never; Returns: string }
      current_workspace_role: {
        Args: never
        Returns: Database["public"]["Enums"]["membership_role"]
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      delete_asset_version: { Args: { p_asset_id: string }; Returns: undefined }
      delete_availability_block: {
        Args: { p_availability_block_id: string }
        Returns: undefined
      }
      delete_bolo: { Args: { p_bolo_id: string }; Returns: undefined }
      delete_conversation: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      delete_date: { Args: { p_date_id: string }; Returns: undefined }
      delete_expense: { Args: { p_expense_id: string }; Returns: undefined }
      delete_invoice: { Args: { p_invoice_id: string }; Returns: undefined }
      delete_message: { Args: { p_message_id: string }; Returns: undefined }
      delete_note: { Args: { p_note_id: string }; Returns: undefined }
      delete_payment: { Args: { p_payment_id: string }; Returns: undefined }
      delete_performance: {
        Args: { p_performance_id: string }
        Returns: undefined
      }
      delete_schedule_slot: { Args: { p_slot_id: string }; Returns: undefined }
      delete_task: { Args: { p_task_id: string }; Returns: undefined }
      delete_travel_stage: { Args: { p_stage_id: string }; Returns: undefined }
      disconnect_mail_account: {
        Args: { p_account_id: string }
        Returns: undefined
      }
      edit_message: {
        Args: { p_body: string; p_message_id: string }
        Returns: {
          author_id: string | null
          body: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          performance_id: string | null
          thread_id: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "message"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      end_conversation_contact: {
        Args: {
          p_conversation_id: string
          p_person_id: string
          p_until?: string
        }
        Returns: {
          conversation_id: string
          created_at: string
          created_by: string | null
          id: string
          is_primary: boolean
          person_id: string
          role: string | null
          since: string | null
          until: string | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "conversation_contact"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fiscal_identity_snapshot: { Args: { p_id: string }; Returns: Json }
      generate_workspace_sid: { Args: never; Returns: string }
      get_public_calendar: { Args: { p_token: string }; Returns: Json }
      get_public_roadsheet: { Args: { p_token: string }; Returns: Json }
      grant_container_preset: {
        Args: {
          p_container_id: string
          p_level: Database["public"]["Enums"]["container_level"]
          p_preset: string
          p_user_id: string
        }
        Returns: string
      }
      has_permission: {
        Args: { p_perm: string; p_project_id: string }
        Returns: boolean
      }
      has_permission_for_user: {
        Args: { p_perm: string; p_project_id: string; p_user_id: string }
        Returns: boolean
      }
      invite_workspace_person: {
        Args: {
          p_email: string
          p_person_id: string
          p_role?: Database["public"]["Enums"]["membership_role"]
          p_workspace_id: string
        }
        Returns: {
          email: string
          expires_at: string
          id: string
          project_id: string
          project_role_code: string
          role: Database["public"]["Enums"]["membership_role"]
          token: string
        }[]
      }
      is_account_admin: { Args: { acc_id: string }; Returns: boolean }
      is_account_member: { Args: { acc_id: string }; Returns: boolean }
      is_account_owner: { Args: { acc_id: string }; Returns: boolean }
      is_reserved_slug: { Args: { candidate: string }; Returns: boolean }
      is_workspace_admin: { Args: { ws_id: string }; Returns: boolean }
      is_workspace_internal_member: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      is_workspace_member: { Args: { ws_id: string }; Returns: boolean }
      issue_invoice: {
        Args: { p_invoice_id: string }
        Returns: {
          country: string | null
          created_at: string
          created_by: string | null
          currency: string
          custom_fields: Json
          deleted_at: string | null
          doc_type: string
          due_on: string | null
          expected_on: string | null
          id: string
          issued_on: string
          issuer_fiscal_identity_id: string | null
          issuer_snapshot: Json | null
          notes: string | null
          number: string | null
          payer_fiscal_identity_id: string | null
          payer_organization_id: string | null
          payer_snapshot: Json | null
          payment_condition: string | null
          project_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          total: number
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "invoice"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      list_calendar_shares: {
        Args: { p_workspace_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          id: string
          revoked_at: string | null
          token: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "calendar_share"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_expenses_for_scope: {
        Args: {
          p_bolo_ids?: string[]
          p_category?: Database["public"]["Enums"]["expense_category"]
          p_limit?: number
          p_line_ids?: string[]
          p_project_ids?: string[]
          p_workspace_ids?: string[]
        }
        Returns: {
          amount: number
          bolo_id: string | null
          category: Database["public"]["Enums"]["expense_category"]
          counterparty: string | null
          created_at: string
          created_by: string | null
          currency: string
          custom_fields: Json
          deleted_at: string | null
          description: string
          id: string
          incurred_on: string
          line_id: string | null
          notes: string | null
          paid_by_user_id: string | null
          receipt_url: string | null
          reimbursed: boolean
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "expense"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_money_bolos: {
        Args: {
          p_from?: string
          p_limit?: number
          p_line_ids?: string[]
          p_project_ids?: string[]
          p_to?: string
          p_workspace_ids?: string[]
        }
        Returns: {
          city: string
          collected: number
          conversation_id: string
          country: string
          fee_amount: number
          fee_currency: string
          function_count: number
          id: string
          line_id: string
          next_performed_at: string
          project: Json
          project_id: string
          status: Database["public"]["Enums"]["performance_status"]
          venue_name: string
        }[]
      }
      list_money_payer_organizations: {
        Args: {
          p_limit?: number
          p_project_ids?: string[]
          p_workspace_ids?: string[]
        }
        Returns: {
          has_fiscal_identity: boolean
          id: string
          name: string
          slug: string
          workspace_id: string
        }[]
      }
      list_performance_bolo_links: {
        Args: { p_performance_ids: string[] }
        Returns: {
          bolo_id: string
          performance_id: string
        }[]
      }
      list_roadsheet_shares: {
        Args: { p_performance_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          id: string
          performance_id: string
          revoked_at: string | null
          role: string
          token: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "roadsheet_share"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_workspace_access: {
        Args: { p_workspace_id: string }
        Returns: {
          accepted_at: string
          access_kind: string
          created_at: string
          display_name: string
          email: string
          expires_at: string
          id: string
          project_id: string
          project_name: string
          project_role_code: string
          role: Database["public"]["Enums"]["membership_role"]
          status: string
          user_id: string
        }[]
      }
      mail_account_eligible_conversation: {
        Args: {
          p_account: Database["public"]["Tables"]["mail_account"]["Row"]
          p_conversation: Database["public"]["Tables"]["conversation"]["Row"]
        }
        Returns: boolean
      }
      mail_account_secret: {
        Args: { p_account_id: string }
        Returns: {
          address: string
          connected_by: string | null
          created_at: string
          id: string
          last_error: string | null
          last_synced_at: string | null
          messages_ingested: number
          owner_user_id: string | null
          provider: Database["public"]["Enums"]["mail_provider"]
          refresh_token_ciphertext: string
          scope: Database["public"]["Enums"]["mail_account_scope"]
          signature: string | null
          status: Database["public"]["Enums"]["mail_account_status"]
          sync_cursor: string | null
          sync_from: string
          sync_started_at: string | null
          token_key_version: number
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "mail_account"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      mail_contact_addresses: {
        Args: { p_account_id: string }
        Returns: {
          address: string
          backfilled: boolean
        }[]
      }
      mail_deferred_ready: {
        Args: { p_account_id: string; p_limit?: number }
        Returns: string[]
      }
      mail_domain_record_status: {
        Args: {
          p_dkim_status: string
          p_dmarc_record?: string
          p_dns_records?: Json
          p_error?: string
          p_id: string
          p_mail_from_status: string
        }
        Returns: {
          checked_at: string | null
          configuration_set: string | null
          created_at: string
          created_by: string | null
          dkim_status: string
          dmarc_record: string | null
          dns_records: Json
          domain: string
          from_local_part: string
          from_name: string | null
          id: string
          last_error: string | null
          mail_from_status: string
          mail_from_subdomain: string
          provider: Database["public"]["Enums"]["mail_sending_provider"]
          tenant_name: string | null
          updated_at: string
          verified_at: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mail_domain"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mail_ingest_message: {
        Args: { p_account_id: string; p_created_by?: string; p_message: Json }
        Returns: number
      }
      mail_known_messages: {
        Args: { p_account_id: string; p_ids: string[] }
        Returns: string[]
      }
      mail_mark_backfilled: {
        Args: { p_account_id: string; p_addresses: string[] }
        Returns: undefined
      }
      mail_send_authorize: {
        Args: { p_account_id: string; p_conversation_id: string }
        Returns: {
          account_address: string
          recipient_address: string
          recipient_name: string
        }[]
      }
      mail_sync_claim: {
        Args: {
          p_account_id?: string
          p_limit?: number
          p_min_interval?: string
        }
        Returns: {
          address: string
          connected_by: string | null
          created_at: string
          id: string
          last_error: string | null
          last_synced_at: string | null
          messages_ingested: number
          owner_user_id: string | null
          provider: Database["public"]["Enums"]["mail_provider"]
          refresh_token_ciphertext: string
          scope: Database["public"]["Enums"]["mail_account_scope"]
          signature: string | null
          status: Database["public"]["Enums"]["mail_account_status"]
          sync_cursor: string | null
          sync_from: string
          sync_started_at: string | null
          token_key_version: number
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "mail_account"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      mail_sync_finish: {
        Args: {
          p_account_id: string
          p_complete?: boolean
          p_cursor?: string
          p_error?: string
          p_ingested?: number
          p_status: Database["public"]["Enums"]["mail_account_status"]
        }
        Returns: undefined
      }
      mailout_approve_review: {
        Args: { p_mailout_id: string; p_reviewed_by?: string }
        Returns: {
          body: string | null
          created_at: string
          created_by: string | null
          finished_at: string | null
          from_address: string | null
          from_local_part: string
          from_name: string | null
          id: string
          language: string
          line_id: string | null
          mail_domain_id: string | null
          project_id: string
          queued_at: string | null
          queued_by: string | null
          reply_to_address: string | null
          reply_to_mail_account_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["mailout_status"]
          status_reason: string | null
          subject: string | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mailout"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mailout_claim: {
        Args: { p_limit?: number; p_mailout_id?: string }
        Returns: {
          address: string
          address_kind: Database["public"]["Enums"]["mailout_address_kind"]
          attempts: number
          basis_kind: Database["public"]["Enums"]["mail_basis_kind"]
          body: string
          configuration_set: string
          conversation_id: string
          display_name: string
          from_address: string
          from_name: string
          language: string
          mailout_id: string
          provider: Database["public"]["Enums"]["mail_sending_provider"]
          recipient_id: string
          reply_to_address: string
          subject: string
          tenant_name: string
          unsubscribe_token: string
          workspace_id: string
        }[]
      }
      mailout_compose_preview: {
        Args: { p_id: string }
        Returns: {
          address_kind: Database["public"]["Enums"]["mailout_address_kind"]
          basis_kind: Database["public"]["Enums"]["mail_basis_kind"]
          city: string
          company_city: string
          company_name: string
          company_phone: string
          company_signature: string
          company_website: string
          contact_first_name: string
          contact_name: string
          mailout_id: string
          organization_name: string
          privacy_url: string
          recipient_id: string
        }[]
      }
      mailout_preview: {
        Args: { p_id: string }
        Returns: {
          address: string
          address_kind: Database["public"]["Enums"]["mailout_address_kind"]
          basis_kind: Database["public"]["Enums"]["mail_basis_kind"]
          basis_withdrawn_at: string
          conversation_id: string
          display_name: string
          ready: boolean
          recipient_id: string
          skip_reason: Database["public"]["Enums"]["mailout_skip_reason"]
          status: Database["public"]["Enums"]["mailout_recipient_status"]
          suppressed_at: string
          suppressed_reason: Database["public"]["Enums"]["mail_suppression_reason"]
        }[]
      }
      mailout_record_event: { Args: { p_payload: Json }; Returns: boolean }
      mailout_record_failure: {
        Args: { p_error: string; p_recipient_id: string; p_retry_at?: string }
        Returns: {
          address: string | null
          address_kind:
            | Database["public"]["Enums"]["mailout_address_kind"]
            | null
          attempts: number
          basis_kind: Database["public"]["Enums"]["mail_basis_kind"] | null
          claimed_at: string | null
          conversation_event_id: string | null
          conversation_id: string
          created_at: string
          display_name: string | null
          id: string
          last_error: string | null
          mailout_id: string
          next_attempt_at: string | null
          person_id: string | null
          provider_message_id: string | null
          rfc_message_id: string | null
          sent_at: string | null
          skip_reason: Database["public"]["Enums"]["mailout_skip_reason"] | null
          status: Database["public"]["Enums"]["mailout_recipient_status"]
          unsubscribe_token: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mailout_recipient"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mailout_record_sent: {
        Args: {
          p_body: string
          p_provider_message_id: string
          p_recipient_id: string
          p_rfc_message_id: string
          p_subject?: string
        }
        Returns: {
          address: string | null
          address_kind:
            | Database["public"]["Enums"]["mailout_address_kind"]
            | null
          attempts: number
          basis_kind: Database["public"]["Enums"]["mail_basis_kind"] | null
          claimed_at: string | null
          conversation_event_id: string | null
          conversation_id: string
          created_at: string
          display_name: string | null
          id: string
          last_error: string | null
          mailout_id: string
          next_attempt_at: string | null
          person_id: string | null
          provider_message_id: string | null
          rfc_message_id: string | null
          sent_at: string | null
          skip_reason: Database["public"]["Enums"]["mailout_skip_reason"] | null
          status: Database["public"]["Enums"]["mailout_recipient_status"]
          unsubscribe_token: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mailout_recipient"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mailout_resubscribe: { Args: { p_token: string }; Returns: undefined }
      mailout_send_context: {
        Args: { p_recipient_ids: string[] }
        Returns: {
          address_kind: Database["public"]["Enums"]["mailout_address_kind"]
          basis_kind: Database["public"]["Enums"]["mail_basis_kind"]
          city: string
          company_city: string
          company_name: string
          company_phone: string
          company_signature: string
          company_website: string
          contact_first_name: string
          contact_name: string
          mailout_id: string
          organization_name: string
          privacy_url: string
          recipient_id: string
        }[]
      }
      mailout_test_authorize: { Args: { p_id: string }; Returns: string }
      mailout_unsubscribe: { Args: { p_token: string }; Returns: undefined }
      mailout_unsubscribe_info: {
        Args: { p_token: string }
        Returns: {
          company_name: string
          language: string
          unsubscribed: boolean
        }[]
      }
      mark_thread_read: { Args: { p_thread_id: string }; Returns: string }
      my_mail_signature: {
        Args: { p_workspace_id: string }
        Returns: {
          company_name: string
          company_phone: string
          company_signature: string
          company_website: string
          full_name: string
          signature: string
          title: string
        }[]
      }
      next_invoice_number: {
        Args: {
          p_doc_type: string
          p_fiscal_identity_id: string
          p_workspace_id: string
          p_year: number
        }
        Returns: string
      }
      post_message: {
        Args: {
          p_anchor_id: string
          p_anchor_kind: string
          p_body: string
          p_facet_id?: string
          p_performance_id?: string
        }
        Returns: {
          author_id: string | null
          body: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          performance_id: string | null
          thread_id: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "message"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      preview_workspace_invitation: {
        Args: { p_token: string }
        Returns: {
          email: string
          expires_at: string
          project_id: string
          project_name: string
          project_role_code: string
          role: Database["public"]["Enums"]["membership_role"]
          workspace_id: string
          workspace_name: string
          workspace_slug: string
        }[]
      }
      queue_mailout: {
        Args: { p_id: string }
        Returns: {
          body: string | null
          created_at: string
          created_by: string | null
          finished_at: string | null
          from_address: string | null
          from_local_part: string
          from_name: string | null
          id: string
          language: string
          line_id: string | null
          mail_domain_id: string | null
          project_id: string
          queued_at: string | null
          queued_by: string | null
          reply_to_address: string | null
          reply_to_mail_account_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["mailout_status"]
          status_reason: string | null
          subject: string | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mailout"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_conversation_event: {
        Args: {
          p_body?: string
          p_conversation_id: string
          p_direction?: Database["public"]["Enums"]["conversation_event_direction"]
          p_external_ref?: string
          p_kind: Database["public"]["Enums"]["conversation_event_kind"]
          p_metadata?: Json
          p_occurred_at?: string
          p_original_url?: string
          p_participants?: Json
          p_provenance?: Json
          p_source?: Database["public"]["Enums"]["conversation_event_source"]
        }
        Returns: {
          body: string | null
          conversation_id: string
          created_by: string | null
          direction:
            | Database["public"]["Enums"]["conversation_event_direction"]
            | null
          external_ref: string | null
          id: string
          kind: Database["public"]["Enums"]["conversation_event_kind"]
          metadata: Json
          occurred_at: string
          original_url: string | null
          participants: Json
          provenance: Json
          recorded_at: string
          source: Database["public"]["Enums"]["conversation_event_source"]
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "conversation_event"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_cast_member: {
        Args: { p_cast_member_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          joined_at: string | null
          left_at: string | null
          notes: string | null
          person_id: string
          project_id: string
          role: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "cast_member"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_mail_domain: { Args: { p_id: string }; Returns: undefined }
      remove_mail_suppression: {
        Args: { p_address: string; p_workspace_id: string }
        Returns: undefined
      }
      reorder_schedule_slots: {
        Args: {
          p_slot_ids: string[]
          p_target_id: string
          p_target_table: string
        }
        Returns: {
          at: string
          created_at: string
          created_by: string | null
          date_id: string | null
          ends_at: string | null
          id: string
          kind: string | null
          label: string | null
          notes: string | null
          performance_id: string | null
          project_id: string
          sort: number
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "schedule_slot"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reorder_travel_stages: {
        Args: { p_date_id: string; p_stage_ids: string[] }
        Returns: {
          arrive_at: string | null
          arrive_tz: string | null
          created_at: string
          created_by: string | null
          date_id: string
          depart_at: string | null
          depart_tz: string | null
          from_city: string | null
          from_country: string | null
          from_place: string | null
          from_venue_id: string | null
          id: string
          mode: Database["public"]["Enums"]["transport_mode"]
          notes: string | null
          position: number
          project_id: string
          reference: string | null
          to_city: string | null
          to_country: string | null
          to_place: string | null
          to_venue_id: string | null
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "travel_stage"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      replace_schedule_slots: {
        Args: { p_slots: Json; p_target_id: string; p_target_table: string }
        Returns: {
          at: string
          created_at: string
          created_by: string | null
          date_id: string | null
          ends_at: string | null
          id: string
          kind: string | null
          label: string | null
          notes: string | null
          performance_id: string | null
          project_id: string
          sort: number
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "schedule_slot"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      replace_schedule_slots_for_user: {
        Args: {
          p_slots: Json
          p_target_id: string
          p_target_table: string
          p_user_id: string
        }
        Returns: {
          at: string
          created_at: string
          created_by: string | null
          date_id: string | null
          ends_at: string | null
          id: string
          kind: string | null
          label: string | null
          notes: string | null
          performance_id: string | null
          project_id: string
          sort: number
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "schedule_slot"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      request_workspace_alias: {
        Args: { p_alias: string; p_workspace_id: string }
        Returns: {
          alias: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          requested_by: string
          status: string
          workspace_id: string
          workspace_name: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_alias_request"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_workspace_alias: {
        Args: { p_approve: boolean; p_request_id: string }
        Returns: {
          alias: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          requested_by: string
          status: string
          workspace_id: string
          workspace_name: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_alias_request"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_calendar_share: {
        Args: { p_share_id: string }
        Returns: undefined
      }
      revoke_membership: {
        Args: { p_membership_id: string }
        Returns: undefined
      }
      revoke_roadsheet_share: {
        Args: { p_share_id: string }
        Returns: undefined
      }
      revoke_workspace_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      revoke_workspace_member: {
        Args: { p_membership_id: string }
        Returns: undefined
      }
      set_commitment_person: {
        Args: {
          p_person_id: string
          p_state: Database["public"]["Enums"]["commitment_state"]
          p_target_id: string
          p_target_table: string
        }
        Returns: {
          created_at: string
          date_id: string | null
          id: string
          performance_id: string | null
          person_id: string
          project_id: string
          set_by: string | null
          state: Database["public"]["Enums"]["commitment_state"]
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "commitment_person"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_conversation_contact: {
        Args: {
          p_conversation_id: string
          p_is_primary?: boolean
          p_person_id: string
          p_role?: string
          p_since?: string
        }
        Returns: {
          conversation_id: string
          created_at: string
          created_by: string | null
          id: string
          is_primary: boolean
          person_id: string
          role: string | null
          since: string | null
          until: string | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "conversation_contact"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_mail_basis: {
        Args: {
          p_address: string
          p_evidence_event_id?: string
          p_kind: Database["public"]["Enums"]["mail_basis_kind"]
          p_note?: string
          p_workspace_id: string
        }
        Returns: {
          address: string
          evidence_event_id: string | null
          kind: Database["public"]["Enums"]["mail_basis_kind"]
          note: string | null
          recorded_at: string
          recorded_by: string | null
          updated_at: string
          withdrawn_at: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mail_basis"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_mail_domain_sender: {
        Args: { p_from_local_part: string; p_from_name?: string; p_id: string }
        Returns: {
          checked_at: string | null
          configuration_set: string | null
          created_at: string
          created_by: string | null
          dkim_status: string
          dmarc_record: string | null
          dns_records: Json
          domain: string
          from_local_part: string
          from_name: string | null
          id: string
          last_error: string | null
          mail_from_status: string
          mail_from_subdomain: string
          provider: Database["public"]["Enums"]["mail_sending_provider"]
          tenant_name: string | null
          updated_at: string
          verified_at: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mail_domain"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_mail_signature: {
        Args: { p_account_id: string; p_signature: string }
        Returns: undefined
      }
      set_mailout_recipients: {
        Args: { p_conversation_ids: string[]; p_id: string }
        Returns: {
          address: string | null
          address_kind:
            | Database["public"]["Enums"]["mailout_address_kind"]
            | null
          attempts: number
          basis_kind: Database["public"]["Enums"]["mail_basis_kind"] | null
          claimed_at: string | null
          conversation_event_id: string | null
          conversation_id: string
          created_at: string
          display_name: string | null
          id: string
          last_error: string | null
          mailout_id: string
          next_attempt_at: string | null
          person_id: string | null
          provider_message_id: string | null
          rfc_message_id: string | null
          sent_at: string | null
          skip_reason: Database["public"]["Enums"]["mailout_skip_reason"] | null
          status: Database["public"]["Enums"]["mailout_recipient_status"]
          unsubscribe_token: string
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "mailout_recipient"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_membership_facet: {
        Args: {
          p_facet_id: string
          p_membership_id: string
          p_verb?: Database["public"]["Enums"]["access_verb"]
        }
        Returns: undefined
      }
      set_my_mail_signature: {
        Args: { p_signature: string; p_workspace_id: string }
        Returns: undefined
      }
      set_organization_fiscal_identity: {
        Args: { p_fiscal: Json; p_organization_id: string }
        Returns: {
          account_id: string | null
          address_line_1: string | null
          address_line_2: string | null
          archived: boolean
          city: string | null
          country: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          default_irpf_pct: number | null
          default_vat_pct: number | null
          deleted_at: string | null
          iban: string | null
          id: string
          kind: string
          label: string
          legal_name: string
          postal_code: string | null
          region: string | null
          swift_bic: string | null
          tax_id: string | null
          updated_at: string
          workspace_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "fiscal_identity"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      share_my_profile_with_workspace: {
        Args: { p_fields?: string[]; p_workspace_id: string }
        Returns: {
          city: string | null
          country: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          email: string | null
          first_name: string | null
          full_name: string
          languages: string[]
          last_name: string | null
          notes: string | null
          organization_id: string | null
          person_id: string
          phone: string | null
          profile_shared_at: string | null
          profile_shared_fields: string[]
          profile_sync_enabled: boolean
          slug: string
          title: string | null
          updated_at: string
          website: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_person"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      slugify: { Args: { input: string }; Returns: string }
      stop_sharing_my_profile_with_workspace: {
        Args: { p_workspace_id: string }
        Returns: undefined
      }
      suppress_mail_address: {
        Args: { p_address: string; p_workspace_id: string }
        Returns: undefined
      }
      thread_audience: {
        Args: {
          p_anchor_id: string
          p_anchor_kind: string
          p_facet_id?: string
        }
        Returns: Json
      }
      touch_line_visit: { Args: { p_line_id: string }; Returns: undefined }
      travel_stage_venue: {
        Args: { p_venue_id: string; p_workspace_id: string }
        Returns: string
      }
      travel_stage_zone: { Args: { p_tz: string }; Returns: string }
      update_bolo_fee: {
        Args: {
          p_bolo_id: string
          p_fee_amount: number
          p_fee_currency?: string
        }
        Returns: {
          fee_amount: number
          fee_currency: string
          id: string
        }[]
      }
      update_bolo_status: {
        Args: {
          p_bolo_id: string
          p_status: Database["public"]["Enums"]["performance_status"]
        }
        Returns: {
          id: string
          status: Database["public"]["Enums"]["performance_status"]
        }[]
      }
      update_invoice: {
        Args: { p_invoice_id: string; p_patch: Json }
        Returns: {
          country: string | null
          created_at: string
          created_by: string | null
          currency: string
          custom_fields: Json
          deleted_at: string | null
          doc_type: string
          due_on: string | null
          expected_on: string | null
          id: string
          issued_on: string
          issuer_fiscal_identity_id: string | null
          issuer_snapshot: Json | null
          notes: string | null
          number: string | null
          payer_fiscal_identity_id: string | null
          payer_organization_id: string | null
          payer_snapshot: Json | null
          payment_condition: string | null
          project_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          total: number
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "invoice"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_mailout: {
        Args: {
          p_body: string
          p_from_local_part?: string
          p_from_name?: string
          p_id: string
          p_language?: string
          p_mail_domain_id?: string
          p_reply_to_mail_account_id?: string
          p_subject: string
        }
        Returns: {
          body: string | null
          created_at: string
          created_by: string | null
          finished_at: string | null
          from_address: string | null
          from_local_part: string
          from_name: string | null
          id: string
          language: string
          line_id: string | null
          mail_domain_id: string | null
          project_id: string
          queued_at: string | null
          queued_by: string | null
          reply_to_address: string | null
          reply_to_mail_account_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["mailout_status"]
          status_reason: string | null
          subject: string | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mailout"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_project: {
        Args: { p_patch: Json; p_project_id: string }
        Returns: {
          accent: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          description: string | null
          dossier_url: string | null
          ends_on: string | null
          id: string
          initials: string | null
          name: string
          notes: string | null
          poster_url: string | null
          previous_slugs: string[]
          slug: string
          starts_on: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "project"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_schedule_slot: {
        Args: {
          p_at: string
          p_ends_at?: string
          p_kind?: string
          p_label?: string
          p_notes?: string
          p_slot_id: string
        }
        Returns: {
          at: string
          created_at: string
          created_by: string | null
          date_id: string | null
          ends_at: string | null
          id: string
          kind: string | null
          label: string | null
          notes: string | null
          performance_id: string | null
          project_id: string
          sort: number
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "schedule_slot"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_travel_stage: {
        Args: {
          p_arrive_at?: string
          p_arrive_tz?: string
          p_depart_at?: string
          p_depart_tz?: string
          p_from_city?: string
          p_from_country?: string
          p_from_place?: string
          p_from_venue_id?: string
          p_mode: Database["public"]["Enums"]["transport_mode"]
          p_notes?: string
          p_reference?: string
          p_stage_id: string
          p_to_city?: string
          p_to_country?: string
          p_to_place?: string
          p_to_venue_id?: string
        }
        Returns: {
          arrive_at: string | null
          arrive_tz: string | null
          created_at: string
          created_by: string | null
          date_id: string
          depart_at: string | null
          depart_tz: string | null
          from_city: string | null
          from_country: string | null
          from_place: string | null
          from_venue_id: string | null
          id: string
          mode: Database["public"]["Enums"]["transport_mode"]
          notes: string | null
          position: number
          project_id: string
          reference: string | null
          to_city: string | null
          to_country: string | null
          to_place: string | null
          to_venue_id: string | null
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "travel_stage"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_workspace: {
        Args: { p_patch: Json; p_workspace_id: string }
        Returns: {
          accent: string | null
          account_id: string
          alias: string | null
          city: string | null
          country: string | null
          created_at: string
          custom_fields: Json
          deleted_at: string | null
          description: string | null
          domain: Database["public"]["Enums"]["workspace_domain"] | null
          fiscal_identity_id: string | null
          id: string
          kind: Database["public"]["Enums"]["workspace_kind"]
          logo_url: string | null
          mail_signature: string | null
          mailout_daily_cap: number
          mailout_reviewed_at: string | null
          mailout_reviewed_by: string | null
          mailout_simulator_only: boolean
          name: string
          new_conversations_private: boolean
          phone: string | null
          previous_slugs: string[]
          privacy_url: string | null
          settings: Json
          slug: string
          timezone: string
          updated_at: string
          website: string | null
        }
        SetofOptions: {
          from: "*"
          to: "workspace"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_workspace_member_role: {
        Args: {
          p_membership_id: string
          p_role: Database["public"]["Enums"]["membership_role"]
        }
        Returns: undefined
      }
      update_workspace_person: {
        Args: {
          p_email?: string
          p_full_name: string
          p_person_id: string
          p_phone?: string
          p_title?: string
          p_workspace_id: string
        }
        Returns: {
          city: string | null
          country: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          email: string | null
          first_name: string | null
          full_name: string
          languages: string[]
          last_name: string | null
          notes: string | null
          organization_id: string | null
          person_id: string
          phone: string | null
          profile_shared_at: string | null
          profile_shared_fields: string[]
          profile_sync_enabled: boolean
          slug: string
          title: string | null
          updated_at: string
          website: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_person"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      uuid_generate_v7: { Args: never; Returns: string }
      withdraw_mail_basis: {
        Args: { p_address: string; p_workspace_id: string }
        Returns: undefined
      }
    }
    Enums: {
      access_verb: "view" | "edit"
      account_kind: "personal" | "team"
      account_role: "owner" | "admin"
      asset_direction: "outbound" | "inbound" | "adapted"
      asset_kind:
        | "rider"
        | "stage_plot"
        | "tech_sheet"
        | "bar_plot"
        | "dossier"
        | "roadsheet_snapshot"
        | "photo"
        | "video"
        | "other"
      commitment_state: "going" | "not_going"
      container_level: "workspace" | "project" | "line" | "bolo" | "performance"
      conversation_event_direction: "inbound" | "outbound"
      conversation_event_kind: "note" | "call" | "email" | "meeting" | "message"
      conversation_event_source:
        | "manual"
        | "email"
        | "whatsapp"
        | "import"
        | "integration"
      conversation_status:
        | "contacted"
        | "in_conversation"
        | "hold"
        | "confirmed"
        | "declined"
        | "dormant"
        | "recurring"
      date_kind:
        | "rehearsal"
        | "residency"
        | "travel_day"
        | "press"
        | "other"
        | "day_off"
      date_status: "tentative" | "confirmed" | "cancelled" | "done"
      expense_category:
        | "travel"
        | "lodging"
        | "per_diem"
        | "freight"
        | "production"
        | "fees"
        | "other"
      invoice_status: "draft" | "issued" | "paid" | "cancelled"
      line_kind:
        | "tour"
        | "season"
        | "phase"
        | "circuit"
        | "residency"
        | "other"
        | "creation"
        | "campaign"
        | "comms"
        | "misc"
      line_status: "open" | "closed" | "archived"
      mail_account_scope: "personal" | "workspace"
      mail_account_status: "active" | "revoked" | "error"
      mail_basis_kind: "consent" | "relationship" | "generic"
      mail_provider: "google"
      mail_sending_provider: "simulator" | "ses"
      mail_suppression_reason: "unsubscribe" | "bounce" | "complaint" | "manual"
      mailout_address_kind: "contact" | "organization"
      mailout_event_type:
        | "send"
        | "delivery"
        | "bounce"
        | "complaint"
        | "reject"
        | "delivery_delay"
        | "rendering_failure"
      mailout_recipient_status:
        | "pending"
        | "queued"
        | "sending"
        | "sent"
        | "delivered"
        | "bounced"
        | "complained"
        | "skipped"
        | "failed"
      mailout_skip_reason:
        | "suppressed"
        | "no_basis"
        | "no_address"
        | "duplicate"
        | "cancelled"
        | "unavailable"
      mailout_status:
        | "draft"
        | "review"
        | "queued"
        | "sending"
        | "paused"
        | "done"
        | "cancelled"
      membership_role: "owner" | "admin" | "member" | "viewer" | "guest"
      note_visibility: "private" | "workspace"
      payment_method: "transfer" | "card" | "cash" | "other"
      performance_status:
        | "proposed"
        | "hold"
        | "hold_1"
        | "hold_2"
        | "hold_3"
        | "confirmed"
        | "done"
        | "invoiced"
        | "paid"
        | "cancelled"
      project_status: "draft" | "active" | "archived"
      task_origin: "manual" | "protocol" | "ai"
      task_status: "open" | "done"
      transport_mode:
        | "plane"
        | "train"
        | "bus"
        | "car"
        | "taxi"
        | "metro"
        | "walk"
        | "ferry"
        | "other"
      workspace_domain:
        | "theatre"
        | "dance"
        | "circus"
        | "music"
        | "mixed"
        | "other"
      workspace_kind: "personal" | "team"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      access_verb: ["view", "edit"],
      account_kind: ["personal", "team"],
      account_role: ["owner", "admin"],
      asset_direction: ["outbound", "inbound", "adapted"],
      asset_kind: [
        "rider",
        "stage_plot",
        "tech_sheet",
        "bar_plot",
        "dossier",
        "roadsheet_snapshot",
        "photo",
        "video",
        "other",
      ],
      commitment_state: ["going", "not_going"],
      container_level: ["workspace", "project", "line", "bolo", "performance"],
      conversation_event_direction: ["inbound", "outbound"],
      conversation_event_kind: ["note", "call", "email", "meeting", "message"],
      conversation_event_source: [
        "manual",
        "email",
        "whatsapp",
        "import",
        "integration",
      ],
      conversation_status: [
        "contacted",
        "in_conversation",
        "hold",
        "confirmed",
        "declined",
        "dormant",
        "recurring",
      ],
      date_kind: [
        "rehearsal",
        "residency",
        "travel_day",
        "press",
        "other",
        "day_off",
      ],
      date_status: ["tentative", "confirmed", "cancelled", "done"],
      expense_category: [
        "travel",
        "lodging",
        "per_diem",
        "freight",
        "production",
        "fees",
        "other",
      ],
      invoice_status: ["draft", "issued", "paid", "cancelled"],
      line_kind: [
        "tour",
        "season",
        "phase",
        "circuit",
        "residency",
        "other",
        "creation",
        "campaign",
        "comms",
        "misc",
      ],
      line_status: ["open", "closed", "archived"],
      mail_account_scope: ["personal", "workspace"],
      mail_account_status: ["active", "revoked", "error"],
      mail_basis_kind: ["consent", "relationship", "generic"],
      mail_provider: ["google"],
      mail_sending_provider: ["simulator", "ses"],
      mail_suppression_reason: ["unsubscribe", "bounce", "complaint", "manual"],
      mailout_address_kind: ["contact", "organization"],
      mailout_event_type: [
        "send",
        "delivery",
        "bounce",
        "complaint",
        "reject",
        "delivery_delay",
        "rendering_failure",
      ],
      mailout_recipient_status: [
        "pending",
        "queued",
        "sending",
        "sent",
        "delivered",
        "bounced",
        "complained",
        "skipped",
        "failed",
      ],
      mailout_skip_reason: [
        "suppressed",
        "no_basis",
        "no_address",
        "duplicate",
        "cancelled",
        "unavailable",
      ],
      mailout_status: [
        "draft",
        "review",
        "queued",
        "sending",
        "paused",
        "done",
        "cancelled",
      ],
      membership_role: ["owner", "admin", "member", "viewer", "guest"],
      note_visibility: ["private", "workspace"],
      payment_method: ["transfer", "card", "cash", "other"],
      performance_status: [
        "proposed",
        "hold",
        "hold_1",
        "hold_2",
        "hold_3",
        "confirmed",
        "done",
        "invoiced",
        "paid",
        "cancelled",
      ],
      project_status: ["draft", "active", "archived"],
      task_origin: ["manual", "protocol", "ai"],
      task_status: ["open", "done"],
      transport_mode: [
        "plane",
        "train",
        "bus",
        "car",
        "taxi",
        "metro",
        "walk",
        "ferry",
        "other",
      ],
      workspace_domain: [
        "theatre",
        "dance",
        "circus",
        "music",
        "mixed",
        "other",
      ],
      workspace_kind: ["personal", "team"],
    },
  },
} as const

