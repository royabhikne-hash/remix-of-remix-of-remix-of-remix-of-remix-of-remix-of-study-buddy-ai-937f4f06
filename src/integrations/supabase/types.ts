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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admins: {
        Row: {
          admin_id: string
          created_at: string
          id: string
          name: string
          password_hash: string
          role: Database["public"]["Enums"]["admin_role"]
        }
        Insert: {
          admin_id: string
          created_at?: string
          id?: string
          name: string
          password_hash: string
          role?: Database["public"]["Enums"]["admin_role"]
        }
        Update: {
          admin_id?: string
          created_at?: string
          id?: string
          name?: string
          password_hash?: string
          role?: Database["public"]["Enums"]["admin_role"]
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          image_url: string | null
          role: string
          session_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          image_url?: string | null
          role: string
          session_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          image_url?: string | null
          role?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "study_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_reports: {
        Row: {
          created_at: string
          created_by: string | null
          created_by_type: string | null
          id: string
          pdf_url: string | null
          report_data: Json
          report_type: string
          sent_at: string | null
          sent_to: string | null
          student_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_by_type?: string | null
          id?: string
          pdf_url?: string | null
          report_data?: Json
          report_type?: string
          sent_at?: string | null
          sent_to?: string | null
          student_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_by_type?: string | null
          id?: string
          pdf_url?: string | null
          report_data?: Json
          report_type?: string
          sent_at?: string | null
          sent_to?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parent_reports_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_attempts: {
        Row: {
          accuracy_percentage: number | null
          answers: Json
          correct_count: number
          created_at: string
          id: string
          questions: Json
          session_id: string
          student_id: string
          total_questions: number
          understanding_result: string | null
        }
        Insert: {
          accuracy_percentage?: number | null
          answers?: Json
          correct_count?: number
          created_at?: string
          id?: string
          questions?: Json
          session_id: string
          student_id: string
          total_questions?: number
          understanding_result?: string | null
        }
        Update: {
          accuracy_percentage?: number | null
          answers?: Json
          correct_count?: number
          created_at?: string
          id?: string
          questions?: Json
          session_id?: string
          student_id?: string
          total_questions?: number
          understanding_result?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quiz_attempts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "study_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_attempts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          contact_whatsapp: string | null
          created_at: string
          district: string | null
          email: string | null
          fee_paid: boolean | null
          id: string
          is_banned: boolean | null
          name: string
          password_hash: string
          school_id: string
          state: string | null
        }
        Insert: {
          contact_whatsapp?: string | null
          created_at?: string
          district?: string | null
          email?: string | null
          fee_paid?: boolean | null
          id?: string
          is_banned?: boolean | null
          name: string
          password_hash: string
          school_id: string
          state?: string | null
        }
        Update: {
          contact_whatsapp?: string | null
          created_at?: string
          district?: string | null
          email?: string | null
          fee_paid?: boolean | null
          id?: string
          is_banned?: boolean | null
          name?: string
          password_hash?: string
          school_id?: string
          state?: string | null
        }
        Relationships: []
      }
      students: {
        Row: {
          age: number
          approved_at: string | null
          approved_by: string | null
          board: Database["public"]["Enums"]["board_type"]
          class: string
          created_at: string
          district: string
          full_name: string
          id: string
          is_approved: boolean
          is_banned: boolean | null
          parent_whatsapp: string
          phone: string
          photo_url: string | null
          rejection_reason: string | null
          school_id: string | null
          state: string
          updated_at: string
          user_id: string
        }
        Insert: {
          age: number
          approved_at?: string | null
          approved_by?: string | null
          board?: Database["public"]["Enums"]["board_type"]
          class: string
          created_at?: string
          district: string
          full_name: string
          id?: string
          is_approved?: boolean
          is_banned?: boolean | null
          parent_whatsapp: string
          phone: string
          photo_url?: string | null
          rejection_reason?: string | null
          school_id?: string | null
          state: string
          updated_at?: string
          user_id: string
        }
        Update: {
          age?: number
          approved_at?: string | null
          approved_by?: string | null
          board?: Database["public"]["Enums"]["board_type"]
          class?: string
          created_at?: string
          district?: string
          full_name?: string
          id?: string
          is_approved?: boolean
          is_banned?: boolean | null
          parent_whatsapp?: string
          phone?: string
          photo_url?: string | null
          rejection_reason?: string | null
          school_id?: string | null
          state?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "students_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      study_sessions: {
        Row: {
          ai_summary: string | null
          created_at: string
          end_time: string | null
          id: string
          improvement_score: number | null
          start_time: string
          strong_areas: string[] | null
          student_id: string
          subject: string | null
          time_spent: number | null
          topic: string
          understanding_level:
            | Database["public"]["Enums"]["understanding_level"]
            | null
          weak_areas: string[] | null
        }
        Insert: {
          ai_summary?: string | null
          created_at?: string
          end_time?: string | null
          id?: string
          improvement_score?: number | null
          start_time?: string
          strong_areas?: string[] | null
          student_id: string
          subject?: string | null
          time_spent?: number | null
          topic?: string
          understanding_level?:
            | Database["public"]["Enums"]["understanding_level"]
            | null
          weak_areas?: string[] | null
        }
        Update: {
          ai_summary?: string | null
          created_at?: string
          end_time?: string | null
          id?: string
          improvement_score?: number | null
          start_time?: string
          strong_areas?: string[] | null
          student_id?: string
          subject?: string | null
          time_spent?: number | null
          topic?: string
          understanding_level?:
            | Database["public"]["Enums"]["understanding_level"]
            | null
          weak_areas?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "study_sessions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      admin_role: "super_admin" | "admin"
      board_type: "CBSE" | "ICSE" | "Bihar Board" | "Other"
      improvement_trend: "up" | "down" | "stable"
      understanding_level: "weak" | "average" | "good" | "excellent"
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
      admin_role: ["super_admin", "admin"],
      board_type: ["CBSE", "ICSE", "Bihar Board", "Other"],
      improvement_trend: ["up", "down", "stable"],
      understanding_level: ["weak", "average", "good", "excellent"],
    },
  },
} as const
