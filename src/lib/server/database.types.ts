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
      accounting_policies: {
        Row: {
          chosen_value: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          effective_from: string | null
          entity_id: string | null
          evidence_url: string | null
          id: string
          policy_key: string
          rationale: string | null
          updated_at: string
        }
        Insert: {
          chosen_value?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          effective_from?: string | null
          entity_id?: string | null
          evidence_url?: string | null
          id?: string
          policy_key: string
          rationale?: string | null
          updated_at?: string
        }
        Update: {
          chosen_value?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          effective_from?: string | null
          entity_id?: string | null
          evidence_url?: string | null
          id?: string
          policy_key?: string
          rationale?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_policies_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          id: number
          new_value: Json | null
          occurred_at: string
          old_value: Json | null
          record_pk: string
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          id?: never
          new_value?: Json | null
          occurred_at?: string
          old_value?: Json | null
          record_pk: string
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          id?: never
          new_value?: Json | null
          occurred_at?: string
          old_value?: Json | null
          record_pk?: string
          table_name?: string
        }
        Relationships: []
      }
      entities: {
        Row: {
          business_line: string
          code: string
          created_at: string
          fiscal_year_start_month: number
          icon_key: string
          id: string
          is_active: boolean
          legal_name: string
          npwp: string | null
          ownership_pct: number
          reporting_basis: Database["public"]["Enums"]["reporting_basis"]
          revenue_presentation: Database["public"]["Enums"]["revenue_presentation"]
          theme_color: string
          updated_at: string
        }
        Insert: {
          business_line: string
          code: string
          created_at?: string
          fiscal_year_start_month?: number
          icon_key?: string
          id?: string
          is_active?: boolean
          legal_name: string
          npwp?: string | null
          ownership_pct?: number
          reporting_basis?: Database["public"]["Enums"]["reporting_basis"]
          revenue_presentation?: Database["public"]["Enums"]["revenue_presentation"]
          theme_color?: string
          updated_at?: string
        }
        Update: {
          business_line?: string
          code?: string
          created_at?: string
          fiscal_year_start_month?: number
          icon_key?: string
          id?: string
          is_active?: boolean
          legal_name?: string
          npwp?: string | null
          ownership_pct?: number
          reporting_basis?: Database["public"]["Enums"]["reporting_basis"]
          revenue_presentation?: Database["public"]["Enums"]["revenue_presentation"]
          theme_color?: string
          updated_at?: string
        }
        Relationships: []
      }
      intercompany_transactions: {
        Row: {
          amount: number
          buyer_entity_id: string
          buyer_line_code: string | null
          description: string
          evidence_url: string | null
          id: string
          period: string
          recorded_at: string
          recorded_by: string | null
          seller_entity_id: string
          seller_line_code: string | null
        }
        Insert: {
          amount: number
          buyer_entity_id: string
          buyer_line_code?: string | null
          description: string
          evidence_url?: string | null
          id?: string
          period: string
          recorded_at?: string
          recorded_by?: string | null
          seller_entity_id: string
          seller_line_code?: string | null
        }
        Update: {
          amount?: number
          buyer_entity_id?: string
          buyer_line_code?: string | null
          description?: string
          evidence_url?: string | null
          id?: string
          period?: string
          recorded_at?: string
          recorded_by?: string | null
          seller_entity_id?: string
          seller_line_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intercompany_transactions_buyer_entity_id_fkey"
            columns: ["buyer_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intercompany_transactions_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intercompany_transactions_seller_entity_id_fkey"
            columns: ["seller_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      periods: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          entity_id: string
          id: string
          locked_at: string | null
          locked_by: string | null
          period: string
          rejection_note: string | null
          status: Database["public"]["Enums"]["period_status"]
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          entity_id: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          period: string
          rejection_note?: string | null
          status?: Database["public"]["Enums"]["period_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          template_id: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          entity_id?: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          period?: string
          rejection_note?: string | null
          status?: Database["public"]["Enums"]["period_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "periods_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "periods_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "periods_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "periods_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "periods_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "periods_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          is_active?: boolean
          phone?: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      report_lines: {
        Row: {
          amount: number
          created_at: string
          id: string
          line_code: string
          note: string | null
          period_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          line_code: string
          note?: string | null
          period_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          line_code?: string
          note?: string | null
          period_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_lines_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_lines_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "v_period_pnl"
            referencedColumns: ["period_id"]
          },
        ]
      }
      report_template_lines: {
        Row: {
          account_code: string | null
          help_text: string | null
          id: string
          is_active: boolean
          line_code: string
          line_label: string
          section: Database["public"]["Enums"]["line_section"]
          sort_order: number
          template_id: string
        }
        Insert: {
          account_code?: string | null
          help_text?: string | null
          id?: string
          is_active?: boolean
          line_code: string
          line_label: string
          section: Database["public"]["Enums"]["line_section"]
          sort_order: number
          template_id: string
        }
        Update: {
          account_code?: string | null
          help_text?: string | null
          id?: string
          is_active?: boolean
          line_code?: string
          line_label?: string
          section?: Database["public"]["Enums"]["line_section"]
          sort_order?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_template_lines_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      report_templates: {
        Row: {
          business_line: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          version: number
        }
        Insert: {
          business_line?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          version?: number
        }
        Update: {
          business_line?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          version?: number
        }
        Relationships: []
      }
      user_entity_access: {
        Row: {
          entity_id: string
          granted_at: string
          granted_by: string | null
          user_id: string
        }
        Insert: {
          entity_id: string
          granted_at?: string
          granted_by?: string | null
          user_id: string
        }
        Update: {
          entity_id?: string
          granted_at?: string
          granted_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_entity_access_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_entity_access_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_entity_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_group_consolidated: {
        Row: {
          cogs_sum: number | null
          elimination: number | null
          is_complete: boolean | null
          missing_entities: string[] | null
          net_profit_consolidated: number | null
          opex_sum: number | null
          period: string | null
          revenue_consolidated: number | null
          revenue_sum: number | null
        }
        Relationships: []
      }
      v_period_comparison: {
        Row: {
          entity_code: string | null
          entity_id: string | null
          net_profit: number | null
          net_profit_prev_month: number | null
          net_profit_prev_year: number | null
          period: string | null
          revenue: number | null
          revenue_mom_pct: number | null
          revenue_prev_month: number | null
          revenue_prev_year: number | null
          revenue_yoy_pct: number | null
        }
        Relationships: [
          {
            foreignKeyName: "periods_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      v_period_completeness: {
        Row: {
          expected_entities: number | null
          is_complete: boolean | null
          missing_entities: string[] | null
          period: string | null
          reported_entities: number | null
        }
        Relationships: []
      }
      v_period_pnl: {
        Row: {
          business_line: string | null
          cogs: number | null
          entity_code: string | null
          entity_id: string | null
          entity_name: string | null
          gross_profit: number | null
          net_margin_pct: number | null
          net_profit: number | null
          operating_profit: number | null
          opex: number | null
          other_expense: number | null
          other_income: number | null
          period: string | null
          period_id: string | null
          reporting_basis: Database["public"]["Enums"]["reporting_basis"] | null
          revenue: number | null
          revenue_presentation:
            | Database["public"]["Enums"]["revenue_presentation"]
            | null
          status: Database["public"]["Enums"]["period_status"] | null
          tax: number | null
        }
        Relationships: [
          {
            foreignKeyName: "periods_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_approve: { Args: never; Returns: boolean }
      can_read_all_entities: { Args: never; Returns: boolean }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      has_entity_access: { Args: { target_entity: string }; Returns: boolean }
      is_readonly_role: { Args: never; Returns: boolean }
      period_is_editable: { Args: { target_period: string }; Returns: boolean }
    }
    Enums: {
      line_section:
        | "revenue"
        | "cogs"
        | "opex"
        | "other_income"
        | "other_expense"
        | "tax"
      period_status: "draft" | "submitted" | "approved" | "locked"
      reporting_basis: "cash" | "accrual" | "unknown"
      revenue_presentation: "gross" | "net" | "unknown"
      user_role: "direksi" | "manajer_keuangan" | "staf_entitas" | "auditor"
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
      line_section: [
        "revenue",
        "cogs",
        "opex",
        "other_income",
        "other_expense",
        "tax",
      ],
      period_status: ["draft", "submitted", "approved", "locked"],
      reporting_basis: ["cash", "accrual", "unknown"],
      revenue_presentation: ["gross", "net", "unknown"],
      user_role: ["direksi", "manajer_keuangan", "staf_entitas", "auditor"],
    },
  },
} as const

