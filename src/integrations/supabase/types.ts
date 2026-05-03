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
      admin_grants: {
        Row: {
          created_at: string
          expires_at: string | null
          granted_by: string
          id: string
          provider_id: string
          revoked_at: string | null
          tier: Database["public"]["Enums"]["app_tier"]
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          granted_by: string
          id?: string
          provider_id: string
          revoked_at?: string | null
          tier: Database["public"]["Enums"]["app_tier"]
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          granted_by?: string
          id?: string
          provider_id?: string
          revoked_at?: string | null
          tier?: Database["public"]["Enums"]["app_tier"]
        }
        Relationships: []
      }
      agent_beacons: {
        Row: {
          brokerage: string | null
          city: string
          consent_at: string
          consent_given: boolean
          consent_text: string
          country: string
          created_at: string
          email: string
          expires_at: string
          id: string
          matched_at: string | null
          matched_provider_id: string | null
          name: string | null
          region: string | null
          source_ip: string | null
          status: Database["public"]["Enums"]["beacon_status"]
          updated_at: string
          user_agent: string | null
          zip: string | null
        }
        Insert: {
          brokerage?: string | null
          city: string
          consent_at?: string
          consent_given: boolean
          consent_text: string
          country?: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          matched_at?: string | null
          matched_provider_id?: string | null
          name?: string | null
          region?: string | null
          source_ip?: string | null
          status?: Database["public"]["Enums"]["beacon_status"]
          updated_at?: string
          user_agent?: string | null
          zip?: string | null
        }
        Update: {
          brokerage?: string | null
          city?: string
          consent_at?: string
          consent_given?: boolean
          consent_text?: string
          country?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          matched_at?: string | null
          matched_provider_id?: string | null
          name?: string | null
          region?: string | null
          source_ip?: string | null
          status?: Database["public"]["Enums"]["beacon_status"]
          updated_at?: string
          user_agent?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      ask_quota_counters: {
        Row: {
          byok_active: boolean
          exhausted_email_sent_at: string | null
          free_limit: number
          free_used: number
          property_uuid: string
          saved_model_id: string
          updated_at: string
          warning_email_sent_at: string | null
        }
        Insert: {
          byok_active?: boolean
          exhausted_email_sent_at?: string | null
          free_limit?: number
          free_used?: number
          property_uuid: string
          saved_model_id: string
          updated_at?: string
          warning_email_sent_at?: string | null
        }
        Update: {
          byok_active?: boolean
          exhausted_email_sent_at?: string | null
          free_limit?: number
          free_used?: number
          property_uuid?: string
          saved_model_id?: string
          updated_at?: string
          warning_email_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ask_quota_counters_saved_model_id_fkey"
            columns: ["saved_model_id"]
            isOneToOne: false
            referencedRelation: "saved_models"
            referencedColumns: ["id"]
          },
        ]
      }
      ask_quota_events: {
        Row: {
          created_at: string
          id: string
          idempotency_key: string
          outcome: string
          property_uuid: string
          reason: string | null
          saved_model_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          idempotency_key: string
          outcome: string
          property_uuid: string
          reason?: string | null
          saved_model_id: string
        }
        Update: {
          created_at?: string
          id?: string
          idempotency_key?: string
          outcome?: string
          property_uuid?: string
          reason?: string | null
          saved_model_id?: string
        }
        Relationships: []
      }
      beacon_notifications: {
        Row: {
          beacon_id: string
          created_at: string
          email_send_log_id: string | null
          id: string
          kind: string
          provider_id: string
        }
        Insert: {
          beacon_id: string
          created_at?: string
          email_send_log_id?: string | null
          id?: string
          kind: string
          provider_id: string
        }
        Update: {
          beacon_id?: string
          created_at?: string
          email_send_log_id?: string | null
          id?: string
          kind?: string
          provider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "beacon_notifications_beacon_id_fkey"
            columns: ["beacon_id"]
            isOneToOne: false
            referencedRelation: "agent_beacons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beacon_notifications_email_send_log_id_fkey"
            columns: ["email_send_log_id"]
            isOneToOne: false
            referencedRelation: "email_send_log"
            referencedColumns: ["id"]
          },
        ]
      }
      branding_settings: {
        Row: {
          accent_color: string
          additional_model_fee_cents: number | null
          base_price_cents: number | null
          brand_name: string
          country: string
          created_at: string
          custom_domain: string | null
          favicon_url: string | null
          flat_price_per_model_cents: number | null
          ga_tracking_id: string | null
          gate_label: string
          hero_bg_opacity: number
          hero_bg_url: string | null
          hud_bg_color: string
          id: string
          instant_payout_fee_bps: number
          is_directory_public: boolean
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          model_threshold: number | null
          primary_city: string | null
          provider_id: string
          region: string | null
          service_radius_miles: number | null
          service_zips: string[]
          slug: string | null
          specialties: Database["public"]["Enums"]["marketplace_specialty"][]
          stripe_connect_id: string | null
          stripe_onboarding_complete: boolean | null
          tier: Database["public"]["Enums"]["app_tier"]
          tier3_price_cents: number | null
          updated_at: string
          use_flat_pricing: boolean
        }
        Insert: {
          accent_color?: string
          additional_model_fee_cents?: number | null
          base_price_cents?: number | null
          brand_name?: string
          country?: string
          created_at?: string
          custom_domain?: string | null
          favicon_url?: string | null
          flat_price_per_model_cents?: number | null
          ga_tracking_id?: string | null
          gate_label?: string
          hero_bg_opacity?: number
          hero_bg_url?: string | null
          hud_bg_color?: string
          id?: string
          instant_payout_fee_bps?: number
          is_directory_public?: boolean
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          model_threshold?: number | null
          primary_city?: string | null
          provider_id: string
          region?: string | null
          service_radius_miles?: number | null
          service_zips?: string[]
          slug?: string | null
          specialties?: Database["public"]["Enums"]["marketplace_specialty"][]
          stripe_connect_id?: string | null
          stripe_onboarding_complete?: boolean | null
          tier?: Database["public"]["Enums"]["app_tier"]
          tier3_price_cents?: number | null
          updated_at?: string
          use_flat_pricing?: boolean
        }
        Update: {
          accent_color?: string
          additional_model_fee_cents?: number | null
          base_price_cents?: number | null
          brand_name?: string
          country?: string
          created_at?: string
          custom_domain?: string | null
          favicon_url?: string | null
          flat_price_per_model_cents?: number | null
          ga_tracking_id?: string | null
          gate_label?: string
          hero_bg_opacity?: number
          hero_bg_url?: string | null
          hud_bg_color?: string
          id?: string
          instant_payout_fee_bps?: number
          is_directory_public?: boolean
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          model_threshold?: number | null
          primary_city?: string | null
          provider_id?: string
          region?: string | null
          service_radius_miles?: number | null
          service_zips?: string[]
          slug?: string | null
          specialties?: Database["public"]["Enums"]["marketplace_specialty"][]
          stripe_connect_id?: string | null
          stripe_onboarding_complete?: boolean | null
          tier?: Database["public"]["Enums"]["app_tier"]
          tier3_price_cents?: number | null
          updated_at?: string
          use_flat_pricing?: boolean
        }
        Relationships: []
      }
      client_byok_keys: {
        Row: {
          active: boolean
          ciphertext: string
          client_id: string
          created_at: string
          fingerprint: string
          id: string
          iv: string
          rotated_at: string | null
          validated_at: string | null
          validation_error: string | null
          vendor: string
        }
        Insert: {
          active?: boolean
          ciphertext: string
          client_id: string
          created_at?: string
          fingerprint: string
          id?: string
          iv: string
          rotated_at?: string | null
          validated_at?: string | null
          validation_error?: string | null
          vendor: string
        }
        Update: {
          active?: boolean
          ciphertext?: string
          client_id?: string
          created_at?: string
          fingerprint?: string
          id?: string
          iv?: string
          rotated_at?: string | null
          validated_at?: string | null
          validation_error?: string | null
          vendor?: string
        }
        Relationships: []
      }
      client_providers: {
        Row: {
          client_id: string
          created_at: string
          id: string
          is_free: boolean
          provider_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          is_free?: boolean
          provider_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          is_free?: boolean
          provider_id?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      invitations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          is_free: boolean
          provider_id: string
          status: Database["public"]["Enums"]["invitation_status"]
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          is_free?: boolean
          provider_id: string
          status?: Database["public"]["Enums"]["invitation_status"]
          token?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          is_free?: boolean
          provider_id?: string
          status?: Database["public"]["Enums"]["invitation_status"]
          token?: string
          updated_at?: string
        }
        Relationships: []
      }
      licenses: {
        Row: {
          created_at: string
          id: string
          license_expiry: string | null
          license_status: Database["public"]["Enums"]["license_status"]
          stripe_subscription_id: string | null
          studio_id: string
          tier: Database["public"]["Enums"]["app_tier"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          license_expiry?: string | null
          license_status?: Database["public"]["Enums"]["license_status"]
          stripe_subscription_id?: string | null
          studio_id?: string
          tier?: Database["public"]["Enums"]["app_tier"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          license_expiry?: string | null
          license_status?: Database["public"]["Enums"]["license_status"]
          stripe_subscription_id?: string | null
          studio_id?: string
          tier?: Database["public"]["Enums"]["app_tier"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      lus_freezes: {
        Row: {
          frozen_at: string
          frozen_by: string
          property_uuid: string
          reason: string | null
        }
        Insert: {
          frozen_at?: string
          frozen_by: string
          property_uuid: string
          reason?: string | null
        }
        Update: {
          frozen_at?: string
          frozen_by?: string
          property_uuid?: string
          reason?: string | null
        }
        Relationships: []
      }
      order_notifications: {
        Row: {
          client_id: string
          created_at: string
          id: string
          model_id: string
          provider_id: string
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          model_id: string
          provider_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          model_id?: string
          provider_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_notifications_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "saved_models"
            referencedColumns: ["id"]
          },
        ]
      }
      page_visits: {
        Row: {
          id: string
          provider_id: string
          referrer: string | null
          slug: string
          user_agent: string | null
          visited_at: string
        }
        Insert: {
          id?: string
          provider_id: string
          referrer?: string | null
          slug: string
          user_agent?: string | null
          visited_at?: string
        }
        Update: {
          id?: string
          provider_id?: string
          referrer?: string | null
          slug?: string
          user_agent?: string | null
          visited_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          provider_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          provider_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          provider_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      property_extractions: {
        Row: {
          candidate_fields: Json | null
          canonical_qas: Json | null
          chunks: Json
          embedding: string | null
          extracted_at: string
          extractor: string
          extractor_version: string
          field_provenance: Json | null
          fields: Json
          id: string
          intelligence_health: Json | null
          property_uuid: string
          saved_model_id: string | null
          template_id: string
          vault_asset_id: string
        }
        Insert: {
          candidate_fields?: Json | null
          canonical_qas?: Json | null
          chunks: Json
          embedding?: string | null
          extracted_at?: string
          extractor: string
          extractor_version: string
          field_provenance?: Json | null
          fields: Json
          id?: string
          intelligence_health?: Json | null
          property_uuid: string
          saved_model_id?: string | null
          template_id: string
          vault_asset_id: string
        }
        Update: {
          candidate_fields?: Json | null
          canonical_qas?: Json | null
          chunks?: Json
          embedding?: string | null
          extracted_at?: string
          extractor?: string
          extractor_version?: string
          field_provenance?: Json | null
          fields?: Json
          id?: string
          intelligence_health?: Json | null
          property_uuid?: string
          saved_model_id?: string | null
          template_id?: string
          vault_asset_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_extractions_saved_model_id_fkey"
            columns: ["saved_model_id"]
            isOneToOne: false
            referencedRelation: "saved_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_extractions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "vault_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_extractions_vault_asset_id_fkey"
            columns: ["vault_asset_id"]
            isOneToOne: false
            referencedRelation: "vault_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          environment: string
          id: string
          price_id: string
          product_id: string
          status: string
          stripe_customer_id: string | null
          stripe_session_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          environment?: string
          id?: string
          price_id: string
          product_id: string
          status?: string
          stripe_customer_id?: string | null
          stripe_session_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          environment?: string
          id?: string
          price_id?: string
          product_id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_session_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sandbox_demos: {
        Row: {
          agent: Json
          behaviors: Json
          brand_overrides: Json
          created_at: string
          id: string
          is_published: boolean
          properties: Json
          provider_id: string
          updated_at: string
        }
        Insert: {
          agent?: Json
          behaviors?: Json
          brand_overrides?: Json
          created_at?: string
          id?: string
          is_published?: boolean
          properties?: Json
          provider_id: string
          updated_at?: string
        }
        Update: {
          agent?: Json
          behaviors?: Json
          brand_overrides?: Json
          created_at?: string
          id?: string
          is_published?: boolean
          properties?: Json
          provider_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      saved_models: {
        Row: {
          amount_cents: number | null
          client_id: string
          created_at: string
          id: string
          is_released: boolean
          model_count: number | null
          name: string
          properties: Json
          provider_id: string
          status: Database["public"]["Enums"]["model_status"]
          tour_config: Json
          updated_at: string
        }
        Insert: {
          amount_cents?: number | null
          client_id: string
          created_at?: string
          id?: string
          is_released?: boolean
          model_count?: number | null
          name?: string
          properties?: Json
          provider_id: string
          status?: Database["public"]["Enums"]["model_status"]
          tour_config?: Json
          updated_at?: string
        }
        Update: {
          amount_cents?: number | null
          client_id?: string
          created_at?: string
          id?: string
          is_released?: boolean
          model_count?: number | null
          name?: string
          properties?: Json
          provider_id?: string
          status?: Database["public"]["Enums"]["model_status"]
          tour_config?: Json
          updated_at?: string
        }
        Relationships: []
      }
      studio_preview_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          provider_id: string
          slug: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          provider_id: string
          slug: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          provider_id?: string
          slug?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vault_assets: {
        Row: {
          asset_url: string
          category_type: Database["public"]["Enums"]["vault_category"]
          created_at: string
          description: string | null
          embedding_backfilled_at: string | null
          embedding_status: string | null
          file_size_bytes: number | null
          id: string
          is_active: boolean
          label: string
          mime_type: string | null
          provider_id: string
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          asset_url: string
          category_type: Database["public"]["Enums"]["vault_category"]
          created_at?: string
          description?: string | null
          embedding_backfilled_at?: string | null
          embedding_status?: string | null
          file_size_bytes?: number | null
          id?: string
          is_active?: boolean
          label: string
          mime_type?: string | null
          provider_id: string
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          asset_url?: string
          category_type?: Database["public"]["Enums"]["vault_category"]
          created_at?: string
          description?: string | null
          embedding_backfilled_at?: string | null
          embedding_status?: string | null
          file_size_bytes?: number | null
          id?: string
          is_active?: boolean
          label?: string
          mime_type?: string | null
          provider_id?: string
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      vault_templates: {
        Row: {
          created_at: string
          doc_kind: string
          extractor: string
          field_schema: Json
          id: string
          is_active: boolean
          label: string
          provider_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          doc_kind: string
          extractor?: string
          field_schema: Json
          id?: string
          is_active?: boolean
          label: string
          provider_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          doc_kind?: string
          extractor?: string
          field_schema?: Json
          id?: string
          is_active?: boolean
          label?: string
          provider_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation_self: {
        Args: { _token: string }
        Returns: {
          provider_id: string
        }[]
      }
      claim_ask_exhaustion_email: {
        Args: { p_property_uuid: string; p_saved_model_id: string }
        Returns: {
          byok_active: boolean
          exhausted_email_sent_at: string
          free_limit: number
          free_used: number
          property_uuid: string
          saved_model_id: string
          warning_email_sent_at: string
        }[]
      }
      claim_ask_warning_email: {
        Args: {
          p_property_uuid: string
          p_saved_model_id: string
          p_threshold?: number
        }
        Returns: {
          byok_active: boolean
          free_limit: number
          free_used: number
          property_uuid: string
          saved_model_id: string
          warning_email_sent_at: string
        }[]
      }
      decline_invitation: { Args: { _token: string }; Returns: boolean }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_invitation_by_token: {
        Args: { _token: string }
        Returns: {
          email: string
          expires_at: string
          is_free: boolean
          provider_id: string
          status: Database["public"]["Enums"]["invitation_status"]
        }[]
      }
      get_license_info: {
        Args: { user_uuid: string }
        Returns: {
          license_expiry: string
          license_status: Database["public"]["Enums"]["license_status"]
          studio_id: string
          tier: Database["public"]["Enums"]["app_tier"]
        }[]
      }
      get_my_matched_beacons: {
        Args: never
        Returns: {
          brokerage: string
          city: string
          contacted_at: string | null
          created_at: string
          disposition: Database["public"]["Enums"]["beacon_disposition"] | null
          email: string
          exclusive_until: string | null
          has_outreach: boolean
          id: string
          is_currently_exclusive: boolean
          is_leaked: boolean
          name: string
          region: string
          status: Database["public"]["Enums"]["beacon_status"]
          zip: string
        }[]
      }
      get_provider_license: {
        Args: { client_uuid: string }
        Returns: {
          license_expiry: string
          license_status: Database["public"]["Enums"]["license_status"]
          provider_id: string
          studio_id: string
          tier: Database["public"]["Enums"]["app_tier"]
        }[]
      }
      get_providers_for_admin: {
        Args: never
        Returns: {
          email: string
          provider_id: string
          start_date: string
        }[]
      }
      get_user_tier: {
        Args: { check_env?: string; user_uuid: string }
        Returns: string
      }
      get_my_service_polygon: {
        Args: never
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      issue_studio_preview_token: { Args: { _slug: string }; Returns: string }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      provider_has_paid_access: {
        Args: { _provider_id: string }
        Returns: boolean
      }
      public_beacon_demand: {
        Args: never
        Returns: {
          city: string
          region: string
          waiting_count: number
        }[]
      }
      read_ask_quota_counter: {
        Args: { p_property_uuid: string; p_saved_model_id: string }
        Returns: {
          byok_active: boolean
          exhausted_email_sent_at: string
          free_limit: number
          free_used: number
          warning_email_sent_at: string
        }[]
      }
      read_byok_status: {
        Args: { p_vendor?: string }
        Returns: {
          active: boolean
          created_at: string
          fingerprint: string
          has_key: boolean
          validated_at: string
          validation_error: string
          vendor: string
        }[]
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      record_ask_quota_event: {
        Args: {
          p_idempotency_key: string
          p_outcome: string
          p_property_uuid: string
          p_reason?: string
          p_saved_model_id: string
        }
        Returns: {
          byok_active: boolean
          exhausted_email_sent_at: string
          free_limit: number
          free_used: number
          warning_email_sent_at: string
          was_new: boolean
        }[]
      }
      resolve_studio_access: {
        Args: { _provider_id: string }
        Returns: {
          invitation_status: string
          is_free: boolean
          linked: boolean
          payouts_ready: boolean
          pricing_configured: boolean
          provider_brand_name: string
          viewer_matches_provider: boolean
          viewer_role: string
        }[]
      }
      set_my_service_polygon: {
        Args: { p_geojson?: Json | null }
        Returns: boolean
      }
      search_msp_directory: {
        Args: { p_city?: string; p_zip?: string }
        Returns: {
          brand_name: string
          logo_url: string
          primary_city: string
          region: string
          slug: string
          specialties: Database["public"]["Enums"]["marketplace_specialty"][]
          tier: Database["public"]["Enums"]["app_tier"]
        }[]
      }
      set_client_byok_active: {
        Args: { p_active: boolean; p_client_id: string }
        Returns: number
      }
      verify_studio_preview_token: {
        Args: { _slug: string; _token: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "provider" | "client"
      app_tier: "starter" | "pro"
      beacon_disposition: "won" | "lost" | "unresponsive"
      beacon_status: "waiting" | "matched" | "unsubscribed" | "expired"
      invitation_status: "pending" | "accepted" | "expired" | "declined"
      license_status: "active" | "past_due" | "expired"
      marketplace_specialty:
        | "scan-matterport-pro3"
        | "scan-drone-aerial"
        | "scan-twilight-photography"
        | "scan-floor-plans"
        | "scan-dimensional-measurements"
        | "scan-same-day-turnaround"
        | "vault-sound-library"
        | "vault-portal-filters"
        | "vault-interactive-widgets"
        | "vault-custom-icons"
        | "vault-property-mapper"
        | "ai-lead-generation"
      model_status: "preview" | "pending_payment" | "paid"
      vault_category:
        | "spatial_audio"
        | "visual_hud_filter"
        | "interactive_widget"
        | "custom_iconography"
        | "property_doc"
        | "external_link"
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
      app_role: ["admin", "provider", "client"],
      app_tier: ["starter", "pro"],
      beacon_disposition: ["won", "lost", "unresponsive"],
      beacon_status: ["waiting", "matched", "unsubscribed", "expired"],
      invitation_status: ["pending", "accepted", "expired", "declined"],
      license_status: ["active", "past_due", "expired"],
      marketplace_specialty: [
        "scan-matterport-pro3",
        "scan-drone-aerial",
        "scan-twilight-photography",
        "scan-floor-plans",
        "scan-dimensional-measurements",
        "scan-same-day-turnaround",
        "vault-sound-library",
        "vault-portal-filters",
        "vault-interactive-widgets",
        "vault-custom-icons",
        "vault-property-mapper",
        "ai-lead-generation",
      ],
      model_status: ["preview", "pending_payment", "paid"],
      vault_category: [
        "spatial_audio",
        "visual_hud_filter",
        "interactive_widget",
        "custom_iconography",
        "property_doc",
        "external_link",
      ],
    },
  },
} as const
