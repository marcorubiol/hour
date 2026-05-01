export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
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
          previous_slugs: string[]
          project_id: string | null
          show_id: string | null
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
          previous_slugs?: string[]
          project_id?: string | null
          show_id?: string | null
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
          previous_slugs?: string[]
          project_id?: string | null
          show_id?: string | null
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
            foreignKeyName: "asset_version_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_version_show_id_fkey"
            columns: ["show_id"]
            isOneToOne: false
            referencedRelation: "show"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_version_show_id_fkey"
            columns: ["show_id"]
            isOneToOne: false
            referencedRelation: "show_redacted"
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
      cast_override: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          person_id: string
          reason: string | null
          replaces_person_id: string | null
          role: string
          show_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          person_id: string
          reason?: string | null
          replaces_person_id?: string | null
          role: string
          show_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          person_id?: string
          reason?: string | null
          replaces_person_id?: string | null
          role?: string
          show_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
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
            foreignKeyName: "cast_override_show_id_fkey"
            columns: ["show_id"]
            isOneToOne: false
            referencedRelation: "show"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cast_override_show_id_fkey"
            columns: ["show_id"]
            isOneToOne: false
            referencedRelation: "show_redacted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cast_override_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
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
      crew_assignment: {
        Row: {
          contact_override: Json
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          notes: string | null
          person_id: string
          role: string
          show_id: string
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
          person_id: string
          role: string
          show_id: string
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
          person_id?: string
          role?: string
          show_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_assignment_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_assignment_show_id_fkey"
            columns: ["show_id"]
            isOneToOne: false
            referencedRelation: "show"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_assignment_show_id_fkey"
            columns: ["show_id"]
            isOneToOne: false
            referencedRelation: "show_redacted"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_assignment_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
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
          ends_at: string | null
          id: string
          kind: Database["public"]["Enums"]["date_kind"]
          notes: string | null
          project_id: string
          season: string | null
          show_id: string | null
          starts_at: string
          status: Database["public"]["Enums"]["date_status"]
          title: string | null
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
          ends_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["date_kind"]
          notes?: string | null
          project_id: string
          season?: string | null
          show_id?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["date_status"]
          title?: string | null
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
          ends_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["date_kind"]
          notes?: string | null
          project_id?: string
          season?: string | null
          show_id?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["date_status"]
          title?: string | null
          updated_at?: string
          venue_id?: string | null
          venue_name?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "date_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_show_id_fkey"
            columns: ["show_id"]
            isOneToOne: false
            referencedRelation: "show"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "date_show_id_fkey"
            columns: ["show_id"]
            isOneToOne: false
            referencedRelation: "show_redacted"
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
      engagement: {
        Row: {
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          first_contacted_at: string | null
          id: string
          last_contacted_at: string | null
          next_action_at: string | null
          next_action_note: string | null
          person_id: string
          previous_slugs: string[]
          project_id: string
          role: string | null
          slug: string
          status: Database["public"]["Enums"]["engagement_status"]
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
          next_action_at?: string | null
          next_action_note?: string | null
          person_id: string
          previous_slugs?: string[]
          project_id: string
          role?: string | null
          slug: string
          status?: Database["public"]["Enums"]["engagement_status"]
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
          next_action_at?: string | null
          next_action_note?: string | null
          person_id?: string
          previous_slugs?: string[]
          project_id?: string
          role?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["engagement_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_workspace_id_fkey"
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
          category: Database["public"]["Enums"]["expense_category"]
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
          show_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount: number
          category?: Database["public"]["Enums"]["expense_category"]
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
          show_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          category?: Database["public"]["Enums"]["expense_category"]
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
          show_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_show_id_fkey"
            columns: ["show_id"]
            isOneToOne: false
            referencedRelation: "show"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_show_id_fkey"
            columns: ["show_id"]
            isOneToOne: false
            referencedRelation: "show_redacted"
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
      invoice: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          custom_fields: Json
          deleted_at: string | null
          due_on: string | null
          id: string
          irpf_amount: number | null
          irpf_pct: number | null
          issued_on: string
          notes: string | null
          number: string | null
          payer_person_id: string | null
          project_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          total: number
          updated_at: string
          vat_amount: number | null
          vat_pct: number | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          custom_fields?: Json
          deleted_at?: string | null
          due_on?: string | null
          id?: string
          irpf_amount?: number | null
          irpf_pct?: number | null
          issued_on?: string
          notes?: string | null
          number?: string | null
          payer_person_id?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          total?: number
          updated_at?: string
          vat_amount?: number | null
          vat_pct?: number | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          custom_fields?: Json
          deleted_at?: string | null
          due_on?: string | null
          id?: string
          irpf_amount?: number | null
          irpf_pct?: number | null
          issued_on?: string
          notes?: string | null
          number?: string | null
          payer_person_id?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          total?: number
          updated_at?: string
          vat_amount?: number | null
          vat_pct?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payer_person_id_fkey"
            columns: ["payer_person_id"]
            isOneToOne: false
            referencedRelation: "person"
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
        ]
      }
      invoice_line: {
        Row: {
          created_at: string
          description: string
          id: string
          invoice_id: string
          line_total: number | null
          quantity: number
          show_id: string | null
          unit_amount: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          line_total?: number | null
          quantity?: number
          show_id?: string | null
          unit_amount: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          line_total?: number | null
          quantity?: number
          show_id?: string | null
          unit_amount?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_show_id_fkey"
            columns: ["show_id"]
            isOneToOne: false
            referencedRelation: "show"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_show_id_fkey"
            columns: ["show_id"]
            isOneToOne: false
            referencedRelation: "show_redacted"
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
      line: {
        Row: {
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          dossier_url: string | null
          end_date: string | null
          id: string
          kind: Database["public"]["Enums"]["line_kind"]
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
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          dossier_url?: string | null
          end_date?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["line_kind"]
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
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          dossier_url?: string | null
          end_date?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["line_kind"]
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
      payment: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          received_on: string
          reference: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          invoice_id: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          received_on?: string
          reference?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          invoice_id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          received_on?: string
          reference?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice"
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
      person_note: {
        Row: {
          author_id: string
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          person_id: string
          updated_at: string
          visibility: Database["public"]["Enums"]["person_note_visibility"]
          workspace_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          person_id: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["person_note_visibility"]
          workspace_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          person_id?: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["person_note_visibility"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_note_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_note_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      project: {
        Row: {
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          description: string | null
          dossier_url: string | null
          ends_on: string | null
          id: string
          name: string
          notes: string | null
          owner_id: string | null
          poster_url: string | null
          previous_slugs: string[]
          slug: string
          starts_on: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          description?: string | null
          dossier_url?: string | null
          ends_on?: string | null
          id?: string
          name: string
          notes?: string | null
          owner_id?: string | null
          poster_url?: string | null
          previous_slugs?: string[]
          slug: string
          starts_on?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          description?: string | null
          dossier_url?: string | null
          ends_on?: string | null
          id?: string
          name?: string
          notes?: string | null
          owner_id?: string | null
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
            foreignKeyName: "project_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "workspace_membership"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      project_membership: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          permission_grants: string[]
          permission_revokes: string[]
          project_id: string
          roles: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          permission_grants?: string[]
          permission_revokes?: string[]
          project_id: string
          roles?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          permission_grants?: string[]
          permission_revokes?: string[]
          project_id?: string
          roles?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_membership_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
        ]
      }
      show: {
        Row: {
          city: string | null
          country: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          deleted_at: string | null
          engagement_id: string | null
          fee_amount: number | null
          fee_currency: string | null
          hospitality: Json
          id: string
          line_id: string | null
          load_in_at: string | null
          loadout_at: string | null
          logistics: Json
          notes: string | null
          performed_at: string
          previous_slugs: string[]
          project_id: string
          show_start_at: string | null
          slug: string | null
          soundcheck_at: string | null
          status: Database["public"]["Enums"]["show_status"]
          technical: Json
          updated_at: string
          venue_id: string | null
          venue_name: string | null
          workspace_id: string
          wrap_at: string | null
        }
        Insert: {
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          engagement_id?: string | null
          fee_amount?: number | null
          fee_currency?: string | null
          hospitality?: Json
          id?: string
          line_id?: string | null
          load_in_at?: string | null
          loadout_at?: string | null
          logistics?: Json
          notes?: string | null
          performed_at: string
          previous_slugs?: string[]
          project_id: string
          show_start_at?: string | null
          slug?: string | null
          soundcheck_at?: string | null
          status?: Database["public"]["Enums"]["show_status"]
          technical?: Json
          updated_at?: string
          venue_id?: string | null
          venue_name?: string | null
          workspace_id: string
          wrap_at?: string | null
        }
        Update: {
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          deleted_at?: string | null
          engagement_id?: string | null
          fee_amount?: number | null
          fee_currency?: string | null
          hospitality?: Json
          id?: string
          line_id?: string | null
          load_in_at?: string | null
          loadout_at?: string | null
          logistics?: Json
          notes?: string | null
          performed_at?: string
          previous_slugs?: string[]
          project_id?: string
          show_start_at?: string | null
          slug?: string | null
          soundcheck_at?: string | null
          status?: Database["public"]["Enums"]["show_status"]
          technical?: Json
          updated_at?: string
          venue_id?: string | null
          venue_name?: string | null
          workspace_id?: string
          wrap_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "show_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "show_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "show_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "show_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "show_workspace_id_fkey"
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
          created_at: string
          full_name: string
          locale: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name: string
          locale?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          locale?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
            foreignKeyName: "venue_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace: {
        Row: {
          country: string | null
          created_at: string
          custom_fields: Json
          deleted_at: string | null
          id: string
          kind: Database["public"]["Enums"]["workspace_kind"]
          name: string
          previous_slugs: string[]
          settings: Json
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          custom_fields?: Json
          deleted_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["workspace_kind"]
          name: string
          previous_slugs?: string[]
          settings?: Json
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          country?: string | null
          created_at?: string
          custom_fields?: Json
          deleted_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["workspace_kind"]
          name?: string
          previous_slugs?: string[]
          settings?: Json
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      workspace_membership: {
        Row: {
          accepted_at: string | null
          created_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["membership_role"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["membership_role"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["membership_role"]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_membership_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_role: {
        Row: {
          access_level: Database["public"]["Enums"]["workspace_role_access_level"]
          archived_at: string | null
          code: string
          created_at: string
          id: string
          is_system: boolean
          label: string
          permissions: string[]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          access_level: Database["public"]["Enums"]["workspace_role_access_level"]
          archived_at?: string | null
          code: string
          created_at?: string
          id?: string
          is_system?: boolean
          label: string
          permissions?: string[]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          access_level?: Database["public"]["Enums"]["workspace_role_access_level"]
          archived_at?: string | null
          code?: string
          created_at?: string
          id?: string
          is_system?: boolean
          label?: string
          permissions?: string[]
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
      show_redacted: {
        Row: {
          city: string | null
          country: string | null
          created_at: string | null
          created_by: string | null
          custom_fields: Json | null
          deleted_at: string | null
          engagement_id: string | null
          fee_amount: number | null
          fee_currency: string | null
          id: string | null
          line_id: string | null
          notes: string | null
          performed_at: string | null
          project_id: string | null
          status: Database["public"]["Enums"]["show_status"] | null
          updated_at: string | null
          venue_id: string | null
          venue_name: string | null
          workspace_id: string | null
        }
        Insert: {
          city?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          custom_fields?: Json | null
          deleted_at?: string | null
          engagement_id?: string | null
          fee_amount?: never
          fee_currency?: never
          id?: string | null
          line_id?: string | null
          notes?: string | null
          performed_at?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["show_status"] | null
          updated_at?: string | null
          venue_id?: string | null
          venue_name?: string | null
          workspace_id?: string | null
        }
        Update: {
          city?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          custom_fields?: Json | null
          deleted_at?: string | null
          engagement_id?: string | null
          fee_amount?: never
          fee_currency?: never
          id?: string | null
          line_id?: string | null
          notes?: string | null
          performed_at?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["show_status"] | null
          updated_at?: string | null
          venue_id?: string | null
          venue_name?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "show_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "show_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "show_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "show_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "show_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_edit_project: { Args: { p_project_id: string }; Returns: boolean }
      can_see_person: { Args: { p_person_id: string }; Returns: boolean }
      current_user_id: { Args: never; Returns: string }
      current_workspace_id: { Args: never; Returns: string }
      current_workspace_role: {
        Args: never
        Returns: Database["public"]["Enums"]["membership_role"]
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      has_permission: {
        Args: { p_perm: string; p_project_id: string }
        Returns: boolean
      }
      is_reserved_slug: { Args: { candidate: string }; Returns: boolean }
      is_workspace_member: { Args: { ws_id: string }; Returns: boolean }
      project_id_of_asset_version: {
        Args: { p_line_id: string; p_project_id: string; p_show_id: string }
        Returns: string
      }
      project_id_of_expense: { Args: { p_expense_id: string }; Returns: string }
      project_id_of_show: { Args: { p_show_id: string }; Returns: string }
      slugify: { Args: { input: string }; Returns: string }
      uuid_generate_v7: { Args: never; Returns: string }
    }
    Enums: {
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
      date_kind: "rehearsal" | "residency" | "travel_day" | "press" | "other"
      date_status: "tentative" | "confirmed" | "cancelled" | "done"
      engagement_status:
        | "contacted"
        | "in_conversation"
        | "hold"
        | "confirmed"
        | "declined"
        | "dormant"
        | "recurring"
      expense_category:
        | "travel"
        | "lodging"
        | "per_diem"
        | "freight"
        | "production"
        | "fees"
        | "other"
      invoice_status: "draft" | "issued" | "paid" | "cancelled"
      line_kind: "tour" | "season" | "phase" | "circuit" | "residency" | "other"
      line_status: "open" | "closed" | "archived"
      membership_role: "owner" | "admin" | "member" | "viewer" | "guest"
      payment_method: "transfer" | "card" | "cash" | "other"
      person_note_visibility: "workspace" | "private"
      project_status: "draft" | "active" | "archived"
      show_status:
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
      workspace_kind: "personal" | "team"
      workspace_role_access_level:
        | "owner"
        | "admin"
        | "producer"
        | "member"
        | "viewer"
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
  public: {
    Enums: {
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
      date_kind: ["rehearsal", "residency", "travel_day", "press", "other"],
      date_status: ["tentative", "confirmed", "cancelled", "done"],
      engagement_status: [
        "contacted",
        "in_conversation",
        "hold",
        "confirmed",
        "declined",
        "dormant",
        "recurring",
      ],
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
      line_kind: ["tour", "season", "phase", "circuit", "residency", "other"],
      line_status: ["open", "closed", "archived"],
      membership_role: ["owner", "admin", "member", "viewer", "guest"],
      payment_method: ["transfer", "card", "cash", "other"],
      person_note_visibility: ["workspace", "private"],
      project_status: ["draft", "active", "archived"],
      show_status: [
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
      workspace_kind: ["personal", "team"],
      workspace_role_access_level: [
        "owner",
        "admin",
        "producer",
        "member",
        "viewer",
      ],
    },
  },
} as const

