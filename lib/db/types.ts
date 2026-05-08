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
      cancellations: {
        Row: {
          agreement_number: number
          gym_id: string
          id: string
          imported_at: string
          member_name: string | null
          member_status: string | null
          primary_member: string | null
          raw: Json
        }
        Insert: {
          agreement_number: number
          gym_id: string
          id?: string
          imported_at?: string
          member_name?: string | null
          member_status?: string | null
          primary_member?: string | null
          raw?: Json
        }
        Update: {
          agreement_number?: number
          gym_id?: string
          id?: string
          imported_at?: string
          member_name?: string | null
          member_status?: string | null
          primary_member?: string | null
          raw?: Json
        }
        Relationships: [
          {
            foreignKeyName: "cancellations_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      gym_configs: {
        Row: {
          config: Json
          gym_id: string
          updated_at: string
          version: number
        }
        Insert: {
          config?: Json
          gym_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          config?: Json
          gym_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "gym_configs_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: true
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      gym_members: {
        Row: {
          created_at: string
          gym_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          gym_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          gym_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gym_members_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      gyms: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          timezone: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          timezone?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          timezone?: string
        }
        Relationships: []
      }
      import_history: {
        Row: {
          filename: string
          format: string
          gym_id: string
          id: string
          imported_at: string
          imported_by: string | null
          reporting_period_end: string | null
          reporting_period_start: string | null
          row_count: number
          source_hash: string | null
          storage_path: string | null
          warnings_count: number
        }
        Insert: {
          filename: string
          format: string
          gym_id: string
          id?: string
          imported_at?: string
          imported_by?: string | null
          reporting_period_end?: string | null
          reporting_period_start?: string | null
          row_count?: number
          source_hash?: string | null
          storage_path?: string | null
          warnings_count?: number
        }
        Update: {
          filename?: string
          format?: string
          gym_id?: string
          id?: string
          imported_at?: string
          imported_by?: string | null
          reporting_period_end?: string | null
          reporting_period_start?: string | null
          row_count?: number
          source_hash?: string | null
          storage_path?: string | null
          warnings_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_history_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          created_at: string
          email: string | null
          first_contact: string | null
          first_name: string | null
          gym_id: string
          id: string
          imported_at: string
          last_name: string | null
          leaving_at: string | null
          leaving_reason: string | null
          phone: string | null
          raw: Json
          sale_at: string | null
          salesperson: string | null
          source: string | null
          source_id: string
          status: string | null
          tags: string[]
          trial_end_at: string | null
          updated_at: string | null
          waiver_signed_date: string | null
        }
        Insert: {
          created_at: string
          email?: string | null
          first_contact?: string | null
          first_name?: string | null
          gym_id: string
          id?: string
          imported_at?: string
          last_name?: string | null
          leaving_at?: string | null
          leaving_reason?: string | null
          phone?: string | null
          raw?: Json
          sale_at?: string | null
          salesperson?: string | null
          source?: string | null
          source_id: string
          status?: string | null
          tags?: string[]
          trial_end_at?: string | null
          updated_at?: string | null
          waiver_signed_date?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          first_contact?: string | null
          first_name?: string | null
          gym_id?: string
          id?: string
          imported_at?: string
          last_name?: string | null
          leaving_at?: string | null
          leaving_reason?: string | null
          phone?: string | null
          raw?: Json
          sale_at?: string | null
          salesperson?: string | null
          source?: string | null
          source_id?: string
          status?: string | null
          tags?: string[]
          trial_end_at?: string | null
          updated_at?: string | null
          waiver_signed_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          age: number | null
          agreement_number: number
          as_of: string
          begin_date: string | null
          check_in_count: number | null
          club_name: string | null
          email: string | null
          expiration_date: string | null
          gender: string | null
          gym_id: string
          id: string
          imported_at: string
          last_visit_date: string | null
          management_group: string | null
          member_name: string | null
          member_status: string | null
          mrr: number | null
          next_due_amount: number | null
          payment_plan: string | null
          plan_name: string | null
          primary_member: string | null
          primary_phone: string | null
          raw: Json
          renewal_cash: number | null
          renewal_eft: number | null
          renewal_statement: number | null
          visits_used: number | null
        }
        Insert: {
          age?: number | null
          agreement_number: number
          as_of: string
          begin_date?: string | null
          check_in_count?: number | null
          club_name?: string | null
          email?: string | null
          expiration_date?: string | null
          gender?: string | null
          gym_id: string
          id?: string
          imported_at?: string
          last_visit_date?: string | null
          management_group?: string | null
          member_name?: string | null
          member_status?: string | null
          mrr?: number | null
          next_due_amount?: number | null
          payment_plan?: string | null
          plan_name?: string | null
          primary_member?: string | null
          primary_phone?: string | null
          raw?: Json
          renewal_cash?: number | null
          renewal_eft?: number | null
          renewal_statement?: number | null
          visits_used?: number | null
        }
        Update: {
          age?: number | null
          agreement_number?: number
          as_of?: string
          begin_date?: string | null
          check_in_count?: number | null
          club_name?: string | null
          email?: string | null
          expiration_date?: string | null
          gender?: string | null
          gym_id?: string
          id?: string
          imported_at?: string
          last_visit_date?: string | null
          management_group?: string | null
          member_name?: string | null
          member_status?: string | null
          mrr?: number | null
          next_due_amount?: number | null
          payment_plan?: string | null
          plan_name?: string | null
          primary_member?: string | null
          primary_phone?: string | null
          raw?: Json
          renewal_cash?: number | null
          renewal_eft?: number | null
          renewal_statement?: number | null
          visits_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "members_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_windows: {
        Row: {
          created_at: string
          end_date: string
          gym_id: string
          id: string
          name: string
          start_date: string
        }
        Insert: {
          created_at?: string
          end_date: string
          gym_id: string
          id?: string
          name: string
          start_date: string
        }
        Update: {
          created_at?: string
          end_date?: string
          gym_id?: string
          id?: string
          name?: string
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_windows_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      rfc_entries: {
        Row: {
          agreement_number: number
          begin_date: string | null
          club_name: string | null
          days_past_due: number | null
          gym_id: string
          id: string
          imported_at: string
          last_billing_date: string | null
          member_name: string | null
          member_status: string | null
          next_due_amount: number | null
          payment_method: string | null
          plan_name: string | null
          raw: Json
          salesperson: string | null
          status_date: string
          term: string | null
          total_past_due: number | null
        }
        Insert: {
          agreement_number: number
          begin_date?: string | null
          club_name?: string | null
          days_past_due?: number | null
          gym_id: string
          id?: string
          imported_at?: string
          last_billing_date?: string | null
          member_name?: string | null
          member_status?: string | null
          next_due_amount?: number | null
          payment_method?: string | null
          plan_name?: string | null
          raw?: Json
          salesperson?: string | null
          status_date: string
          term?: string | null
          total_past_due?: number | null
        }
        Update: {
          agreement_number?: number
          begin_date?: string | null
          club_name?: string | null
          days_past_due?: number | null
          gym_id?: string
          id?: string
          imported_at?: string
          last_billing_date?: string | null
          member_name?: string | null
          member_status?: string | null
          next_due_amount?: number | null
          payment_method?: string | null
          plan_name?: string | null
          raw?: Json
          salesperson?: string | null
          status_date?: string
          term?: string | null
          total_past_due?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rfc_entries_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          agreement_number: number
          agreement_type: string | null
          club_name: string | null
          department: string | null
          gym_id: string
          id: string
          imported_at: string
          member_name: string | null
          payment_plan: string | null
          plan_name: string | null
          queue: string | null
          queue_date: string | null
          raw: Json
          salesperson: string | null
          term: string | null
        }
        Insert: {
          agreement_number: number
          agreement_type?: string | null
          club_name?: string | null
          department?: string | null
          gym_id: string
          id?: string
          imported_at?: string
          member_name?: string | null
          payment_plan?: string | null
          plan_name?: string | null
          queue?: string | null
          queue_date?: string | null
          raw?: Json
          salesperson?: string | null
          term?: string | null
        }
        Update: {
          agreement_number?: number
          agreement_type?: string | null
          club_name?: string | null
          department?: string | null
          gym_id?: string
          id?: string
          imported_at?: string
          member_name?: string | null
          payment_plan?: string | null
          plan_name?: string | null
          queue?: string | null
          queue_date?: string | null
          raw?: Json
          salesperson?: string | null
          term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      validation_runs: {
        Row: {
          check_name: string
          details: Json
          gym_id: string
          id: string
          import_id: string | null
          passed: boolean
          ran_at: string
        }
        Insert: {
          check_name: string
          details?: Json
          gym_id: string
          id?: string
          import_id?: string | null
          passed: boolean
          ran_at?: string
        }
        Update: {
          check_name?: string
          details?: Json
          gym_id?: string
          id?: string
          import_id?: string | null
          passed?: boolean
          ran_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "validation_runs_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "validation_runs_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "import_history"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_user_has_gym_access: {
        Args: { target_gym_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const

