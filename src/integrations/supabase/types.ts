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
      clients: {
        Row: {
          company: string | null
          contact: string | null
          created_at: string
          folder_links: string[]
          id: string
          monthly_value: number | null
          name: string
          notes: string | null
          services: string[]
          source: string | null
          status: Database["public"]["Enums"]["client_status"]
          updated_at: string
          user_id: string
          whatsapp: string | null
          whatsapp_log: string | null
        }
        Insert: {
          company?: string | null
          contact?: string | null
          created_at?: string
          folder_links?: string[]
          id?: string
          monthly_value?: number | null
          name: string
          notes?: string | null
          services?: string[]
          source?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
          user_id: string
          whatsapp?: string | null
          whatsapp_log?: string | null
        }
        Update: {
          company?: string | null
          contact?: string | null
          created_at?: string
          folder_links?: string[]
          id?: string
          monthly_value?: number | null
          name?: string
          notes?: string | null
          services?: string[]
          source?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
          user_id?: string
          whatsapp?: string | null
          whatsapp_log?: string | null
        }
        Relationships: []
      }
      client_recurring_services: {
        Row: {
          active: boolean
          amount: number
          billing_cycle: "monthly" | "annual"
          client_id: string
          created_at: string
          due_day: number
          due_month: number | null
          id: string
          position: number
          service_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          amount?: number
          billing_cycle?: "monthly" | "annual"
          client_id: string
          created_at?: string
          due_day?: number
          due_month?: number | null
          id?: string
          position?: number
          service_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          amount?: number
          billing_cycle?: "monthly" | "annual"
          client_id?: string
          created_at?: string
          due_day?: number
          due_month?: number | null
          id?: string
          position?: number
          service_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_recurring_services_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      device_sessions: {
        Row: {
          browser: string
          created_at: string
          device_name: string
          device_type: string
          last_seen_at: string
          operating_system: string
          session_id: string
          user_agent: string
          user_id: string
        }
        Insert: {
          browser: string
          created_at?: string
          device_name: string
          device_type: string
          last_seen_at?: string
          operating_system: string
          session_id: string
          user_agent: string
          user_id: string
        }
        Update: {
          browser?: string
          created_at?: string
          device_name?: string
          device_type?: string
          last_seen_at?: string
          operating_system?: string
          session_id?: string
          user_agent?: string
          user_id?: string
        }
        Relationships: []
      }
      lead_label_assignments: {
        Row: {
          created_at: string
          id: string
          label_id: string
          lead_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label_id: string
          lead_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label_id?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_label_assignments_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "lead_labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_label_assignments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_labels: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          attachments: Json
          closed_at: string | null
          company: string | null
          contact: string | null
          contacted_at: string | null
          created_at: string
          deleted_at: string | null
          estimated_value: number | null
          follow_up_at: string | null
          follow_up_has_time: boolean
          id: string
          last_contact_at: string | null
          loss_reason: string | null
          loss_reason_details: string | null
          name: string
          negotiation_at: string | null
          notes: string | null
          position: number
          proposal_sent_at: string | null
          reminder_offsets_minutes: number[]
          services: string[]
          source: string | null
          stage: Database["public"]["Enums"]["lead_stage"]
          updated_at: string
          user_id: string
          whatsapp: string | null
        }
        Insert: {
          attachments?: Json
          closed_at?: string | null
          company?: string | null
          contact?: string | null
          contacted_at?: string | null
          created_at?: string
          deleted_at?: string | null
          estimated_value?: number | null
          follow_up_at?: string | null
          follow_up_has_time?: boolean
          id?: string
          last_contact_at?: string | null
          loss_reason?: string | null
          loss_reason_details?: string | null
          name: string
          negotiation_at?: string | null
          notes?: string | null
          position?: number
          proposal_sent_at?: string | null
          reminder_offsets_minutes?: number[]
          services?: string[]
          source?: string | null
          stage?: Database["public"]["Enums"]["lead_stage"]
          updated_at?: string
          user_id: string
          whatsapp?: string | null
        }
        Update: {
          attachments?: Json
          closed_at?: string | null
          company?: string | null
          contact?: string | null
          contacted_at?: string | null
          created_at?: string
          deleted_at?: string | null
          estimated_value?: number | null
          follow_up_at?: string | null
          follow_up_has_time?: boolean
          id?: string
          last_contact_at?: string | null
          loss_reason?: string | null
          loss_reason_details?: string | null
          name?: string
          negotiation_at?: string | null
          notes?: string | null
          position?: number
          proposal_sent_at?: string | null
          reminder_offsets_minutes?: number[]
          services?: string[]
          source?: string | null
          stage?: Database["public"]["Enums"]["lead_stage"]
          updated_at?: string
          user_id?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      notes: {
        Row: {
          content: string
          created_at: string
          deleted_at: string | null
          id: string
          pinned: boolean
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          pinned?: boolean
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          pinned?: boolean
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          client_id: string | null
          contract_url: string | null
          created_at: string
          description: string
          due_date: string
          id: string
          paid_at: string | null
          payment_type: string
          recurring_billing_cycle: "monthly" | "annual"
          recurring_service_id: string | null
          reference_month: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          client_id?: string | null
          contract_url?: string | null
          created_at?: string
          description: string
          due_date: string
          id?: string
          paid_at?: string | null
          payment_type?: string
          recurring_billing_cycle?: "monthly" | "annual"
          recurring_service_id?: string | null
          reference_month?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          client_id?: string | null
          contract_url?: string | null
          created_at?: string
          description?: string
          due_date?: string
          id?: string
          paid_at?: string | null
          payment_type?: string
          recurring_billing_cycle?: "monthly" | "annual"
          recurring_service_id?: string | null
          reference_month?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_recurring_service_id_fkey"
            columns: ["recurring_service_id"]
            isOneToOne: false
            referencedRelation: "client_recurring_services"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          color: string | null
          created_at: string
          id: string
          label: string
          position: number
          stage_key: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          label: string
          position?: number
          stage_key: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          label?: string
          position?: number
          stage_key?: string
          user_id?: string
        }
        Relationships: []
      }
      push_notification_deliveries: {
        Row: {
          delivered_at: string
          id: string
          notification_key: string
          subscription_id: string
          user_id: string
        }
        Insert: {
          delivered_at?: string
          id?: string
          notification_key: string
          subscription_id: string
          user_id: string
        }
        Update: {
          delivered_at?: string
          id?: string
          notification_key?: string
          subscription_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_notification_deliveries_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "web_push_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      task_cards: {
        Row: {
          attachments: Json
          checklist: Json
          client_id: string | null
          column_id: string
          completed: boolean
          created_at: string
          deleted_at: string | null
          description: string | null
          due_date: string | null
          due_has_time: boolean
          id: string
          labels: string[]
          position: number
          priority: string | null
          reminder_offsets_minutes: number[]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attachments?: Json
          checklist?: Json
          client_id?: string | null
          column_id: string
          completed?: boolean
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          due_has_time?: boolean
          id?: string
          labels?: string[]
          position?: number
          priority?: string | null
          reminder_offsets_minutes?: number[]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attachments?: Json
          checklist?: Json
          client_id?: string | null
          column_id?: string
          completed?: boolean
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          due_has_time?: boolean
          id?: string
          labels?: string[]
          position?: number
          priority?: string | null
          reminder_offsets_minutes?: number[]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_cards_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_cards_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "task_columns"
            referencedColumns: ["id"]
          },
        ]
      }
      task_label_assignments: {
        Row: {
          created_at: string
          id: string
          label_id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label_id: string
          task_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_label_assignments_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "task_labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_label_assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      task_labels: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      task_columns: {
        Row: {
          color: string | null
          created_at: string
          id: string
          name: string
          position: number
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          name: string
          position?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          position?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      todos: {
        Row: {
          content: string
          created_at: string
          done: boolean
          id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          done?: boolean
          id?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          done?: boolean
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      trashed_attachments: {
        Row: {
          attachment: Json
          deleted_at: string
          id: string
          owner_id: string
          owner_type: string
          user_id: string
        }
        Insert: {
          attachment: Json
          deleted_at?: string
          id?: string
          owner_id: string
          owner_type: string
          user_id: string
        }
        Update: {
          attachment?: Json
          deleted_at?: string
          id?: string
          owner_id?: string
          owner_type?: string
          user_id?: string
        }
        Relationships: []
      }
      web_push_subscriptions: {
        Row: {
          active: boolean
          auth_key: string
          created_at: string
          device_name: string
          endpoint: string
          id: string
          p256dh: string
          session_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          auth_key: string
          created_at?: string
          device_name: string
          endpoint: string
          id?: string
          p256dh: string
          session_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          auth_key?: string
          created_at?: string
          device_name?: string
          endpoint?: string
          id?: string
          p256dh?: string
          session_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_push_subscriptions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "device_sessions"
            referencedColumns: ["session_id"]
          },
        ]
      }
      user_settings: {
        Row: {
          created_at: string
          default_lead_stage: string
          default_task_column_id: string | null
          default_task_priority: string | null
          notify_due_soon: boolean
          notify_leads: boolean
          notify_overdue: boolean
          notify_tasks: boolean
          sidebar_collapsed: boolean
          theme: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_lead_stage?: string
          default_task_column_id?: string | null
          default_task_priority?: string | null
          notify_due_soon?: boolean
          notify_leads?: boolean
          notify_overdue?: boolean
          notify_tasks?: boolean
          sidebar_collapsed?: boolean
          theme?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_lead_stage?: string
          default_task_column_id?: string | null
          default_task_priority?: string | null
          notify_due_soon?: boolean
          notify_leads?: boolean
          notify_overdue?: boolean
          notify_tasks?: boolean
          sidebar_collapsed?: boolean
          theme?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_default_task_column_id_fkey"
            columns: ["default_task_column_id"]
            isOneToOne: false
            referencedRelation: "task_columns"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_monthly_payments: {
        Args: { p_items: Json; p_reference_month: string }
        Returns: number
      }
      delete_task_column_safely: {
        Args: { p_column_id: string }
        Returns: number
      }
      delete_web_push_subscription: {
        Args: { p_endpoint: string }
        Returns: boolean
      }
      list_user_sessions: {
        Args: Record<PropertyKey, never>
        Returns: {
          browser: string | null
          created_at: string | null
          device_name: string | null
          device_type: string | null
          is_current: boolean
          last_seen_at: string | null
          operating_system: string | null
          push_enabled: boolean
          refreshed_at: string | null
          session_id: string
          updated_at: string | null
          user_agent: string | null
        }[]
      }
      register_device_session: {
        Args: {
          p_browser: string
          p_device_name: string
          p_device_type: string
          p_operating_system: string
          p_session_id: string
          p_user_agent: string
        }
        Returns: undefined
      }
      replace_client_recurring_services: {
        Args: { p_client_id: string; p_items: Json }
        Returns: number
      }
      save_client_with_recurring_services: {
        Args: { p_client: Json; p_client_id: string | null; p_items: Json }
        Returns: string
      }
      save_client_with_billing_cycles: {
        Args: { p_client: Json; p_client_id: string | null; p_items: Json }
        Returns: string
      }
      move_all_task_cards: {
        Args: {
          p_source_column_id: string
          p_target_column_id: string
        }
        Returns: number
      }
      restore_trashed_attachment: {
        Args: { p_trash_id: string }
        Returns: boolean
      }
      trash_attachment: {
        Args: {
          p_attachment: Json
          p_owner_id: string
          p_owner_type: string
        }
        Returns: string
      }
      trash_all_task_cards: {
        Args: { p_column_id: string }
        Returns: number
      }
      revoke_user_session: {
        Args: { p_session_id: string }
        Returns: boolean
      }
      upsert_web_push_subscription: {
        Args: {
          p_auth_key: string
          p_device_name: string
          p_endpoint: string
          p_p256dh: string
          p_session_id: string
        }
        Returns: string
      }
    }
    Enums: {
      client_status: "ativo" | "pausado" | "ex_cliente"
      lead_stage:
        | "novo"
        | "contatado"
        | "proposta"
        | "negociacao"
        | "ganho"
        | "perdido"
      payment_status: "pendente" | "pago" | "atrasado"
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
      client_status: ["ativo", "pausado", "ex_cliente"],
      lead_stage: [
        "novo",
        "contatado",
        "proposta",
        "negociacao",
        "ganho",
        "perdido",
      ],
      payment_status: ["pendente", "pago", "atrasado"],
    },
  },
} as const
