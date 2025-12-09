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
    PostgrestVersion: "12.2.12 (cd3cf9e)"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_address: unknown
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
          ip_address?: unknown
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
          ip_address?: unknown
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
      contact_messages: {
        Row: {
          created_at: string
          email: string
          id: string
          message: string
          name: string
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      crypto_invoices: {
        Row: {
          amount_fiat: number | null
          amount_sats: number | null
          created_at: string
          fiat_currency: string | null
          id: string
          invoice_id: string
          method: string | null
          paid_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount_fiat?: number | null
          amount_sats?: number | null
          created_at?: string
          fiat_currency?: string | null
          id?: string
          invoice_id: string
          method?: string | null
          paid_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount_fiat?: number | null
          amount_sats?: number | null
          created_at?: string
          fiat_currency?: string | null
          id?: string
          invoice_id?: string
          method?: string | null
          paid_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      crypto_wallets: {
        Row: {
          asset: string
          available_sats: number
          balance_sats: number
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          asset?: string
          available_sats?: number
          balance_sats?: number
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          asset?: string
          available_sats?: number
          balance_sats?: number
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      dispute_messages: {
        Row: {
          created_at: string
          dispute_id: string
          id: string
          is_internal: boolean | null
          message: string
          sender_id: string
        }
        Insert: {
          created_at?: string
          dispute_id: string
          id?: string
          is_internal?: boolean | null
          message: string
          sender_id: string
        }
        Update: {
          created_at?: string
          dispute_id?: string
          id?: string
          is_internal?: boolean | null
          message?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispute_messages_dispute_id_fkey"
            columns: ["dispute_id"]
            isOneToOne: false
            referencedRelation: "transaction_disputes"
            referencedColumns: ["id"]
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
      invoices: {
        Row: {
          amount: number
          created_at: string
          currency: string
          due_date: string | null
          id: string
          invoice_number: string | null
          paid_at: string | null
          paypal_order_id: string | null
          status: string
          subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          paid_at?: string | null
          paypal_order_id?: string | null
          status?: string
          subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          paid_at?: string | null
          paypal_order_id?: string | null
          status?: string
          subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
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
      marketplace_transactions: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          gross_amount: number
          id: string
          net_amount: number
          payer_user_id: string
          paypal_order_id: string | null
          platform_fee: number
          receiver_user_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          gross_amount: number
          id?: string
          net_amount: number
          payer_user_id: string
          paypal_order_id?: string | null
          platform_fee?: number
          receiver_user_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          gross_amount?: number
          id?: string
          net_amount?: number
          payer_user_id?: string
          paypal_order_id?: string | null
          platform_fee?: number
          receiver_user_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      merchant_accounts: {
        Row: {
          address: Json
          api_key: string | null
          api_key_masked: string | null
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
          webhook_secret_masked: string | null
          webhook_url: string | null
        }
        Insert: {
          address: Json
          api_key?: string | null
          api_key_masked?: string | null
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
          webhook_secret_masked?: string | null
          webhook_url?: string | null
        }
        Update: {
          address?: Json
          api_key?: string | null
          api_key_masked?: string | null
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
          webhook_secret_masked?: string | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      newsletter_subscriptions: {
        Row: {
          created_at: string
          email: string
          id: string
          status: string
          subscribed_at: string
          unsubscribed_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          status?: string
          subscribed_at?: string
          unsubscribed_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          status?: string
          subscribed_at?: string
          unsubscribed_at?: string | null
          updated_at?: string
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
      role_audit: {
        Row: {
          approved: boolean | null
          changed_by: string | null
          created_at: string
          id: string
          new_role: string | null
          old_role: string | null
          reason: string | null
          user_id: string
        }
        Insert: {
          approved?: boolean | null
          changed_by?: string | null
          created_at?: string
          id?: string
          new_role?: string | null
          old_role?: string | null
          reason?: string | null
          user_id: string
        }
        Update: {
          approved?: boolean | null
          changed_by?: string | null
          created_at?: string
          id?: string
          new_role?: string | null
          old_role?: string | null
          reason?: string | null
          user_id?: string
        }
        Relationships: []
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
      security_events: {
        Row: {
          created_at: string
          event_data: Json | null
          event_type: string
          id: string
          ip_address: unknown
          risk_score: number | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_data?: Json | null
          event_type: string
          id?: string
          ip_address?: unknown
          risk_score?: number | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_data?: Json | null
          event_type?: string
          id?: string
          ip_address?: unknown
          risk_score?: number | null
          user_agent?: string | null
          user_id?: string | null
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
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          paypal_plan_id: string | null
          paypal_subscription_id: string | null
          status: string
          subscription_tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          paypal_plan_id?: string | null
          paypal_subscription_id?: string | null
          status?: string
          subscription_tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          paypal_plan_id?: string | null
          paypal_subscription_id?: string | null
          status?: string
          subscription_tier?: string
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
      transaction_disputes: {
        Row: {
          created_at: string
          description: string
          dispute_type: string
          evidence_urls: string[] | null
          id: string
          refund_amount: number | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          transaction_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description: string
          dispute_type: string
          evidence_urls?: string[] | null
          id?: string
          refund_amount?: number | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          transaction_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          dispute_type?: string
          evidence_urls?: string[] | null
          id?: string
          refund_amount?: number | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          transaction_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_transaction"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["uuid_id"]
          },
        ]
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
      used_totp_tokens: {
        Row: {
          created_at: string
          id: string
          token: string
          used_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          token: string
          used_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          token?: string
          used_at?: string
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
          ip_address: unknown
          last_activity: string
          session_token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_info?: Json | null
          expires_at: string
          id?: string
          ip_address?: unknown
          last_activity?: string
          session_token: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_info?: Json | null
          expires_at?: string
          id?: string
          ip_address?: unknown
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
      wallet_reconciliations: {
        Row: {
          calculated_balance: number
          created_at: string
          difference: number
          id: string
          metadata: Json | null
          notes: string | null
          performed_by: string | null
          reconciliation_type: string
          recorded_balance: number
          status: string
          transaction_count: number
          wallet_id: string
        }
        Insert: {
          calculated_balance: number
          created_at?: string
          difference: number
          id?: string
          metadata?: Json | null
          notes?: string | null
          performed_by?: string | null
          reconciliation_type: string
          recorded_balance: number
          status?: string
          transaction_count?: number
          wallet_id: string
        }
        Update: {
          calculated_balance?: number
          created_at?: string
          difference?: number
          id?: string
          metadata?: Json | null
          notes?: string | null
          performed_by?: string | null
          reconciliation_type?: string
          recorded_balance?: number
          status?: string
          transaction_count?: number
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_reconciliations_wallet_id_fkey"
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
          webhook_secret: string
        }
        Insert: {
          business_id: string
          created_at?: string | null
          events?: Json
          id?: string
          updated_at?: string | null
          url: string
          webhook_secret?: string
        }
        Update: {
          business_id?: string
          created_at?: string | null
          events?: Json
          id?: string
          updated_at?: string | null
          url?: string
          webhook_secret?: string
        }
        Relationships: []
      }
    }
    Views: {
      merchant_accounts_safe: {
        Row: {
          address: Json | null
          api_key_masked: string | null
          business_name: string | null
          business_type: string | null
          contact_info: Json | null
          created_at: string | null
          id: string | null
          registration_number: string | null
          status: string | null
          tax_id: string | null
          updated_at: string | null
          user_id: string | null
          verification_documents: Json | null
          webhook_secret_masked: string | null
          webhook_url: string | null
        }
        Insert: {
          address?: Json | null
          api_key_masked?: string | null
          business_name?: string | null
          business_type?: string | null
          contact_info?: Json | null
          created_at?: string | null
          id?: string | null
          registration_number?: string | null
          status?: string | null
          tax_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          verification_documents?: Json | null
          webhook_secret_masked?: string | null
          webhook_url?: string | null
        }
        Update: {
          address?: Json | null
          api_key_masked?: string | null
          business_name?: string | null
          business_type?: string | null
          contact_info?: Json | null
          created_at?: string | null
          id?: string | null
          registration_number?: string | null
          status?: string | null
          tax_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          verification_documents?: Json | null
          webhook_secret_masked?: string | null
          webhook_url?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      calculate_wallet_balance: {
        Args: { p_wallet_id: string }
        Returns: {
          calculated_balance: number
          last_transaction_date: string
          transaction_count: number
        }[]
      }
      check_advanced_rate_limit: {
        Args: {
          p_action: string
          p_identifier: string
          p_ip_address?: unknown
          p_max_attempts?: number
          p_window_minutes?: number
        }
        Returns: boolean
      }
      check_usage_limit: {
        Args: { p_amount?: number; p_limit_type: string; p_user_id: string }
        Returns: boolean
      }
      cleanup_expired_sessions: { Args: never; Returns: undefined }
      cleanup_old_totp_tokens: { Args: never; Returns: undefined }
      decrypt_card_data: { Args: { encrypted_data: Json }; Returns: Json }
      encrypt_card_data: {
        Args: { card_number: string; cvv: string }
        Returns: Json
      }
      encrypt_merchant_secret: {
        Args: { secret_text: string }
        Returns: string
      }
      enforce_session_security: { Args: never; Returns: undefined }
      fix_wallet_balance: {
        Args: { p_notes?: string; p_performed_by?: string; p_wallet_id: string }
        Returns: boolean
      }
      generate_invoice_number: { Args: never; Returns: string }
      get_merchant_api_key: { Args: { merchant_id: string }; Returns: string }
      get_monthly_transaction_data: {
        Args: { p_user_id: string }
        Returns: {
          amount: number
          month: string
          transaction_count: number
        }[]
      }
      get_recent_transactions: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: {
          amount: number
          created_at: string
          currency: string
          direction: string
          id: number
          recipient_name: string
          status: string
        }[]
      }
      get_spending_by_category: {
        Args: { p_user_id: string }
        Returns: {
          amount: number
          category: string
        }[]
      }
      get_tier_features: {
        Args: { p_tier: string }
        Returns: {
          category: string
          description: string
          feature_id: string
          name: string
        }[]
      }
      get_user_rewards: {
        Args: { p_user_id: string }
        Returns: {
          lifetime_points: number
          next_tier_threshold: number
          points_to_next_tier: number
          tier: string
          total_points: number
        }[]
      }
      get_user_tier: { Args: { p_user_id: string }; Returns: string }
      get_user_transaction_stats: {
        Args: { p_user_id: string }
        Returns: {
          monthly_amount: number
          monthly_transactions: number
          total_transactions: number
        }[]
      }
      get_user_wallet_balance: { Args: { p_user_id: string }; Returns: number }
      has_role: {
        Args: {
          required_role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Returns: boolean
      }
      increment_crypto_balance: {
        Args: { p_amount_sats: number; p_asset: string; p_user_id: string }
        Returns: undefined
      }
      increment_usage: {
        Args: {
          p_amount?: number
          p_usage_type: string
          p_user_id: string
          p_user_tier: string
        }
        Returns: undefined
      }
      increment_wallet_balance: {
        Args: { p_amount: number; p_user_id: string }
        Returns: undefined
      }
      log_card_access_attempt: {
        Args: {
          p_access_type: string
          p_card_id: string
          p_ip_address?: unknown
          p_user_agent?: string
          p_user_id: string
        }
        Returns: boolean
      }
      log_enhanced_security_event: {
        Args: {
          p_event_data?: Json
          p_event_type: string
          p_ip_address?: unknown
          p_risk_score?: number
          p_user_agent?: string
          p_user_id: string
        }
        Returns: undefined
      }
      log_security_event: {
        Args: {
          p_event_data?: Json
          p_event_type: string
          p_ip_address?: unknown
          p_risk_score?: number
          p_user_agent?: string
          p_user_id: string
        }
        Returns: undefined
      }
      mask_api_key: { Args: { api_key: string }; Returns: string }
      reconcile_all_wallets: {
        Args: never
        Returns: {
          difference: number
          has_discrepancy: boolean
          reconciliation_id: string
          user_id: string
          wallet_id: string
        }[]
      }
      reconcile_wallet: {
        Args: {
          p_notes?: string
          p_performed_by?: string
          p_reconciliation_type?: string
          p_wallet_id: string
        }
        Returns: string
      }
      run_security_maintenance: { Args: never; Returns: undefined }
      secure_encrypt_card_data: {
        Args: { card_number: string; cvv: string }
        Returns: Json
      }
      user_has_feature_access: {
        Args: { p_feature_id: string; p_user_id: string }
        Returns: boolean
      }
      validate_role_change: {
        Args: {
          p_changed_by: string
          p_new_role: string
          p_reason?: string
          p_user_id: string
        }
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
