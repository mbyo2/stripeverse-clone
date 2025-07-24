export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instanciate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.12 (cd3cf9e)"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_address: unknown | null
          new_values: Json | null
          old_values: Json | null
          record_id: string
          table_name: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip_address?: unknown | null
          new_values?: Json | null
          old_values?: Json | null
          record_id: string
          table_name: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip_address?: unknown | null
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string
          table_name?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      beta_feedback: {
        Row: {
          app_version: string
          created_at: string
          description: string
          device_info: Json
          email: string | null
          id: string
          screenshot_included: boolean | null
          severity: string | null
          title: string
          type: string
        }
        Insert: {
          app_version: string
          created_at?: string
          description: string
          device_info: Json
          email?: string | null
          id?: string
          screenshot_included?: boolean | null
          severity?: string | null
          title: string
          type: string
        }
        Update: {
          app_version?: string
          created_at?: string
          description?: string
          device_info?: Json
          email?: string | null
          id?: string
          screenshot_included?: boolean | null
          severity?: string | null
          title?: string
          type?: string
        }
        Relationships: []
      }
      compliance_checks: {
        Row: {
          check_type: string
          created_at: string
          details: Json | null
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          risk_score: number | null
          status: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          check_type: string
          created_at?: string
          details?: Json | null
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_score?: number | null
          status: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          check_type?: string
          created_at?: string
          details?: Json | null
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_score?: number | null
          status?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_checks_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["uuid_id"]
          },
        ]
      }
      exchange_rates: {
        Row: {
          created_at: string
          from_currency: string
          id: string
          rate: number
          source: string
          to_currency: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          from_currency: string
          id?: string
          rate: number
          source?: string
          to_currency: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          from_currency?: string
          id?: string
          rate?: number
          source?: string
          to_currency?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: []
      }
      features: {
        Row: {
          category: string
          created_at: string
          description: string
          feature_id: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          description: string
          feature_id: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          feature_id?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      kyc_verifications: {
        Row: {
          address: string | null
          address_doc_url: string | null
          created_at: string | null
          date_of_birth: string | null
          first_name: string | null
          id: number
          id_back_url: string | null
          id_front_url: string | null
          id_number: string | null
          id_type: string | null
          last_name: string | null
          level: string
          metadata: Json | null
          selfie_url: string | null
          updated_at: string | null
          user_id: string | null
          verified_at: string | null
        }
        Insert: {
          address?: string | null
          address_doc_url?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          first_name?: string | null
          id?: number
          id_back_url?: string | null
          id_front_url?: string | null
          id_number?: string | null
          id_type?: string | null
          last_name?: string | null
          level?: string
          metadata?: Json | null
          selfie_url?: string | null
          updated_at?: string | null
          user_id?: string | null
          verified_at?: string | null
        }
        Update: {
          address?: string | null
          address_doc_url?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          first_name?: string | null
          id?: number
          id_back_url?: string | null
          id_front_url?: string | null
          id_number?: string | null
          id_type?: string | null
          last_name?: string | null
          level?: string
          metadata?: Json | null
          selfie_url?: string | null
          updated_at?: string | null
          user_id?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      merchant_accounts: {
        Row: {
          address: Json
          api_key: string | null
          business_name: string
          business_type: string
          contact_info: Json
          created_at: string
          id: string
          registration_number: string | null
          status: string
          tax_id: string | null
          updated_at: string
          user_id: string
          verification_documents: Json | null
          webhook_secret: string | null
          webhook_url: string | null
        }
        Insert: {
          address: Json
          api_key?: string | null
          business_name: string
          business_type: string
          contact_info: Json
          created_at?: string
          id?: string
          registration_number?: string | null
          status?: string
          tax_id?: string | null
          updated_at?: string
          user_id: string
          verification_documents?: Json | null
          webhook_secret?: string | null
          webhook_url?: string | null
        }
        Update: {
          address?: Json
          api_key?: string | null
          business_name?: string
          business_type?: string
          contact_info?: Json
          created_at?: string
          id?: string
          registration_number?: string | null
          status?: string
          tax_id?: string | null
          updated_at?: string
          user_id?: string
          verification_documents?: Json | null
          webhook_secret?: string | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string
          email_marketing: boolean
          email_news: boolean
          email_security: boolean
          email_transactions: boolean
          push_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email_marketing?: boolean
          email_news?: boolean
          email_security?: boolean
          email_transactions?: boolean
          push_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email_marketing?: boolean
          email_news?: boolean
          email_security?: boolean
          email_transactions?: boolean
          push_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          read?: boolean
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      payment_methods: {
        Row: {
          account_name: string | null
          account_number: string | null
          created_at: string
          id: string
          is_primary: boolean | null
          is_verified: boolean | null
          metadata: Json | null
          provider: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean | null
          is_verified?: boolean | null
          metadata?: Json | null
          provider: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean | null
          is_verified?: boolean | null
          metadata?: Json | null
          provider?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pricing_tiers: {
        Row: {
          created_at: string
          currency: string
          description: string
          display_name: string
          features: Json
          id: string
          is_active: boolean
          is_popular: boolean
          max_transaction_amount: number | null
          price: number
          sort_order: number
          tier_name: string
          transaction_fee_fixed: number
          transaction_fee_percentage: number
          updated_at: string
          virtual_cards_limit: number | null
        }
        Insert: {
          created_at?: string
          currency?: string
          description: string
          display_name: string
          features?: Json
          id?: string
          is_active?: boolean
          is_popular?: boolean
          max_transaction_amount?: number | null
          price?: number
          sort_order?: number
          tier_name: string
          transaction_fee_fixed?: number
          transaction_fee_percentage?: number
          updated_at?: string
          virtual_cards_limit?: number | null
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string
          display_name?: string
          features?: Json
          id?: string
          is_active?: boolean
          is_popular?: boolean
          max_transaction_amount?: number | null
          price?: number
          sort_order?: number
          tier_name?: string
          transaction_fee_fixed?: number
          transaction_fee_percentage?: number
          updated_at?: string
          virtual_cards_limit?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          first_name: string | null
          id: string
          last_name: string | null
          phone: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          phone?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          action: string
          attempts: number
          created_at: string
          id: string
          identifier: string
          window_start: string
        }
        Insert: {
          action: string
          attempts?: number
          created_at?: string
          id?: string
          identifier: string
          window_start?: string
        }
        Update: {
          action?: string
          attempts?: number
          created_at?: string
          id?: string
          identifier?: string
          window_start?: string
        }
        Relationships: []
      }
      reward_transactions: {
        Row: {
          action_type: string
          created_at: string
          description: string | null
          id: string
          points_earned: number | null
          points_spent: number | null
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          action_type: string
          created_at?: string
          description?: string | null
          id?: string
          points_earned?: number | null
          points_spent?: number | null
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          action_type?: string
          created_at?: string
          description?: string | null
          id?: string
          points_earned?: number | null
          points_spent?: number | null
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_transactions_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["uuid_id"]
          },
        ]
      }
      role_requests: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          requested_role: Database["public"]["Enums"]["app_role"]
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          requested_role: Database["public"]["Enums"]["app_role"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          requested_role?: Database["public"]["Enums"]["app_role"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscribers: {
        Row: {
          auto_renewal: boolean
          created_at: string
          email: string
          id: string
          payment_method_id: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_end: string | null
          subscription_start: string | null
          subscription_status: string
          subscription_tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_renewal?: boolean
          created_at?: string
          email: string
          id?: string
          payment_method_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_end?: string | null
          subscription_start?: string | null
          subscription_status?: string
          subscription_tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_renewal?: boolean
          created_at?: string
          email?: string
          id?: string
          payment_method_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_end?: string | null
          subscription_start?: string | null
          subscription_status?: string
          subscription_tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscription_invoices: {
        Row: {
          amount: number
          billing_period_end: string
          billing_period_start: string
          created_at: string
          currency: string
          id: string
          invoice_url: string | null
          status: string
          stripe_invoice_id: string | null
          subscription_tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          billing_period_end: string
          billing_period_start: string
          created_at?: string
          currency?: string
          id?: string
          invoice_url?: string | null
          status?: string
          stripe_invoice_id?: string | null
          subscription_tier: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          billing_period_end?: string
          billing_period_start?: string
          created_at?: string
          currency?: string
          id?: string
          invoice_url?: string | null
          status?: string
          stripe_invoice_id?: string | null
          subscription_tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscription_usage: {
        Row: {
          api_calls: number
          cards_created: number
          created_at: string
          id: string
          last_reset: string
          month_year: string
          subscription_tier: string
          transactions_amount: number
          transactions_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          api_calls?: number
          cards_created?: number
          created_at?: string
          id?: string
          last_reset?: string
          month_year: string
          subscription_tier: string
          transactions_amount?: number
          transactions_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          api_calls?: number
          cards_created?: number
          created_at?: string
          id?: string
          last_reset?: string
          month_year?: string
          subscription_tier?: string
          transactions_amount?: number
          transactions_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tier_features: {
        Row: {
          created_at: string
          feature_id: string
          id: string
          tier: string
        }
        Insert: {
          created_at?: string
          feature_id: string
          id?: string
          tier: string
        }
        Update: {
          created_at?: string
          feature_id?: string
          id?: string
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "tier_features_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["feature_id"]
          },
        ]
      }
      tier_limits: {
        Row: {
          api_calls_per_hour: number | null
          created_at: string
          features: Json
          id: string
          monthly_transaction_amount: number | null
          monthly_transactions: number | null
          tier: string
          updated_at: string
          virtual_cards_limit: number | null
        }
        Insert: {
          api_calls_per_hour?: number | null
          created_at?: string
          features?: Json
          id?: string
          monthly_transaction_amount?: number | null
          monthly_transactions?: number | null
          tier: string
          updated_at?: string
          virtual_cards_limit?: number | null
        }
        Update: {
          api_calls_per_hour?: number | null
          created_at?: string
          features?: Json
          id?: string
          monthly_transaction_amount?: number | null
          monthly_transactions?: number | null
          tier?: string
          updated_at?: string
          virtual_cards_limit?: number | null
        }
        Relationships: []
      }
      transaction_categories: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          card_id: string | null
          category: string | null
          created_at: string | null
          currency: string
          description: string | null
          direction: string
          exchange_rate: number | null
          external_reference: string | null
          fee_amount: number | null
          id: number
          metadata: Json | null
          payment_method: string
          provider: string | null
          recipient_account: string | null
          recipient_bank: string | null
          recipient_name: string | null
          reference: string | null
          reversal_id: string | null
          status: string
          tags: Json | null
          transaction_id: string | null
          updated_at: string | null
          user_id: string | null
          uuid_id: string
          wallet_id: string | null
        }
        Insert: {
          amount: number
          card_id?: string | null
          category?: string | null
          created_at?: string | null
          currency?: string
          description?: string | null
          direction: string
          exchange_rate?: number | null
          external_reference?: string | null
          fee_amount?: number | null
          id?: number
          metadata?: Json | null
          payment_method: string
          provider?: string | null
          recipient_account?: string | null
          recipient_bank?: string | null
          recipient_name?: string | null
          reference?: string | null
          reversal_id?: string | null
          status: string
          tags?: Json | null
          transaction_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          uuid_id?: string
          wallet_id?: string | null
        }
        Update: {
          amount?: number
          card_id?: string | null
          category?: string | null
          created_at?: string | null
          currency?: string
          description?: string | null
          direction?: string
          exchange_rate?: number | null
          external_reference?: string | null
          fee_amount?: number | null
          id?: number
          metadata?: Json | null
          payment_method?: string
          provider?: string | null
          recipient_account?: string | null
          recipient_bank?: string | null
          recipient_name?: string | null
          reference?: string | null
          reversal_id?: string | null
          status?: string
          tags?: Json | null
          transaction_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          uuid_id?: string
          wallet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "virtual_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_reversal_id_fkey"
            columns: ["reversal_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["uuid_id"]
          },
          {
            foreignKeyName: "transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      two_factor_auth: {
        Row: {
          backup_codes: Json | null
          created_at: string
          enabled: boolean
          secret: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          backup_codes?: Json | null
          created_at?: string
          enabled?: boolean
          secret?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          backup_codes?: Json | null
          created_at?: string
          enabled?: boolean
          secret?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_rewards: {
        Row: {
          created_at: string
          id: string
          lifetime_points: number
          points_redeemed: number
          tier: string
          total_points: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lifetime_points?: number
          points_redeemed?: number
          tier?: string
          total_points?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lifetime_points?: number
          points_redeemed?: number
          tier?: string
          total_points?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          created_at: string
          device_info: Json | null
          expires_at: string
          id: string
          ip_address: unknown | null
          last_activity: string
          session_token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_info?: Json | null
          expires_at: string
          id?: string
          ip_address?: unknown | null
          last_activity?: string
          session_token: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_info?: Json | null
          expires_at?: string
          id?: string
          ip_address?: unknown | null
          last_activity?: string
          session_token?: string
          user_id?: string
        }
        Relationships: []
      }
      virtual_cards: {
        Row: {
          balance: number
          card_number: string
          card_type: string
          created_at: string
          currency: string
          cvv: string
          daily_limit: number | null
          expiry_date: string
          id: string
          international_transactions: boolean | null
          masked_number: string
          monthly_limit: number | null
          name: string
          online_transactions: boolean | null
          provider: string
          status: string
          transaction_limit: number | null
          updated_at: string
          user_id: string
          wallet_id: string
        }
        Insert: {
          balance?: number
          card_number: string
          card_type?: string
          created_at?: string
          currency?: string
          cvv: string
          daily_limit?: number | null
          expiry_date: string
          id?: string
          international_transactions?: boolean | null
          masked_number: string
          monthly_limit?: number | null
          name: string
          online_transactions?: boolean | null
          provider?: string
          status?: string
          transaction_limit?: number | null
          updated_at?: string
          user_id: string
          wallet_id: string
        }
        Update: {
          balance?: number
          card_number?: string
          card_type?: string
          created_at?: string
          currency?: string
          cvv?: string
          daily_limit?: number | null
          expiry_date?: string
          id?: string
          international_transactions?: boolean | null
          masked_number?: string
          monthly_limit?: number | null
          name?: string
          online_transactions?: boolean | null
          provider?: string
          status?: string
          transaction_limit?: number | null
          updated_at?: string
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "virtual_cards_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          balance: number
          created_at: string
          currency: string
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      webhooks: {
        Row: {
          business_id: string
          created_at: string | null
          events: Json
          id: string
          updated_at: string | null
          url: string
        }
        Insert: {
          business_id: string
          created_at?: string | null
          events?: Json
          id?: string
          updated_at?: string | null
          url: string
        }
        Update: {
          business_id?: string
          created_at?: string | null
          events?: Json
          id?: string
          updated_at?: string | null
          url?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_usage_limit: {
        Args: { p_user_id: string; p_limit_type: string; p_amount?: number }
        Returns: boolean
      }
      cleanup_expired_sessions: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      get_monthly_transaction_data: {
        Args: { p_user_id: string }
        Returns: {
          month: string
          amount: number
          transaction_count: number
        }[]
      }
      get_recent_transactions: {
        Args: { p_user_id: string; p_limit?: number }
        Returns: {
          id: number
          direction: string
          recipient_name: string
          amount: number
          currency: string
          created_at: string
          status: string
        }[]
      }
      get_spending_by_category: {
        Args: { p_user_id: string }
        Returns: {
          category: string
          amount: number
        }[]
      }
      get_tier_features: {
        Args: { p_tier: string }
        Returns: {
          feature_id: string
          name: string
          description: string
          category: string
        }[]
      }
      get_user_rewards: {
        Args: { p_user_id: string }
        Returns: {
          total_points: number
          lifetime_points: number
          tier: string
          next_tier_threshold: number
          points_to_next_tier: number
        }[]
      }
      get_user_tier: {
        Args: { p_user_id: string }
        Returns: string
      }
      get_user_transaction_stats: {
        Args: { p_user_id: string }
        Returns: {
          total_transactions: number
          monthly_amount: number
          monthly_transactions: number
        }[]
      }
      get_user_wallet_balance: {
        Args: { p_user_id: string }
        Returns: number
      }
      has_role: {
        Args: {
          user_id: string
          required_role: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      increment_usage: {
        Args: {
          p_user_id: string
          p_user_tier: string
          p_usage_type: string
          p_amount?: number
        }
        Returns: undefined
      }
      increment_wallet_balance: {
        Args: { p_user_id: string; p_amount: number }
        Returns: undefined
      }
      user_has_feature_access: {
        Args: { p_user_id: string; p_feature_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "user" | "business" | "admin" | "beta_tester"
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
      app_role: ["user", "business", "admin", "beta_tester"],
    },
  },
} as const
