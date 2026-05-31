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
          grant_reason: string | null
          granted_by: string
          id: string
          provider_id: string
          revoked_at: string | null
          tier: Database["public"]["Enums"]["app_tier"]
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          grant_reason?: string | null
          granted_by: string
          id?: string
          provider_id: string
          revoked_at?: string | null
          tier: Database["public"]["Enums"]["app_tier"]
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          grant_reason?: string | null
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
          beacon_point: unknown
          brokerage: string | null
          city: string
          consent_at: string
          consent_given: boolean
          consent_text: string
          contacted_at: string | null
          country: string
          created_at: string
          disposition: Database["public"]["Enums"]["beacon_disposition"] | null
          disposition_set_at: string | null
          disposition_set_by: string | null
          doorway_payload: Json | null
          email: string
          essential_services: Database["public"]["Enums"]["marketplace_specialty"][]
          exclusive_provider_id: string | null
          exclusive_until: string | null
          expires_at: string
          geocoded_at: string | null
          id: string
          lat: number | null
          leaked_at: string | null
          lng: number | null
          match_token: string
          matched_at: string | null
          matched_provider_id: string | null
          name: string | null
          preferable_services: Database["public"]["Enums"]["marketplace_specialty"][]
          pro_visibility_until: string | null
          property_id: string | null
          region: string | null
          service_match_notified_at: string | null
          source: string
          source_ip: string | null
          status: Database["public"]["Enums"]["beacon_status"]
          updated_at: string
          user_agent: string | null
          zip: string | null
        }
        Insert: {
          beacon_point?: unknown
          brokerage?: string | null
          city: string
          consent_at?: string
          consent_given: boolean
          consent_text: string
          contacted_at?: string | null
          country?: string
          created_at?: string
          disposition?: Database["public"]["Enums"]["beacon_disposition"] | null
          disposition_set_at?: string | null
          disposition_set_by?: string | null
          doorway_payload?: Json | null
          email: string
          essential_services?: Database["public"]["Enums"]["marketplace_specialty"][]
          exclusive_provider_id?: string | null
          exclusive_until?: string | null
          expires_at?: string
          geocoded_at?: string | null
          id?: string
          lat?: number | null
          leaked_at?: string | null
          lng?: number | null
          match_token?: string
          matched_at?: string | null
          matched_provider_id?: string | null
          name?: string | null
          preferable_services?: Database["public"]["Enums"]["marketplace_specialty"][]
          pro_visibility_until?: string | null
          property_id?: string | null
          region?: string | null
          service_match_notified_at?: string | null
          source?: string
          source_ip?: string | null
          status?: Database["public"]["Enums"]["beacon_status"]
          updated_at?: string
          user_agent?: string | null
          zip?: string | null
        }
        Update: {
          beacon_point?: unknown
          brokerage?: string | null
          city?: string
          consent_at?: string
          consent_given?: boolean
          consent_text?: string
          contacted_at?: string | null
          country?: string
          created_at?: string
          disposition?: Database["public"]["Enums"]["beacon_disposition"] | null
          disposition_set_at?: string | null
          disposition_set_by?: string | null
          doorway_payload?: Json | null
          email?: string
          essential_services?: Database["public"]["Enums"]["marketplace_specialty"][]
          exclusive_provider_id?: string | null
          exclusive_until?: string | null
          expires_at?: string
          geocoded_at?: string | null
          id?: string
          lat?: number | null
          leaked_at?: string | null
          lng?: number | null
          match_token?: string
          matched_at?: string | null
          matched_provider_id?: string | null
          name?: string | null
          preferable_services?: Database["public"]["Enums"]["marketplace_specialty"][]
          pro_visibility_until?: string | null
          property_id?: string | null
          region?: string | null
          service_match_notified_at?: string | null
          source?: string
          source_ip?: string | null
          status?: Database["public"]["Enums"]["beacon_status"]
          updated_at?: string
          user_agent?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_beacons_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
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
      beacon_match_pool: {
        Row: {
          attempted_at: string | null
          beacon_id: string
          created_at: string
          provider_id: string
          rank: number
        }
        Insert: {
          attempted_at?: string | null
          beacon_id: string
          created_at?: string
          provider_id: string
          rank: number
        }
        Update: {
          attempted_at?: string | null
          beacon_id?: string
          created_at?: string
          provider_id?: string
          rank?: number
        }
        Relationships: [
          {
            foreignKeyName: "beacon_match_pool_beacon_id_fkey"
            columns: ["beacon_id"]
            isOneToOne: false
            referencedRelation: "agent_beacons"
            referencedColumns: ["id"]
          },
        ]
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
          calling_card_cta_label: string | null
          calling_card_headline: string | null
          calling_card_logo_url: string | null
          calling_card_studio_name: string | null
          country: string
          created_at: string
          custom_domain: string | null
          directory_contact_email: string | null
          directory_phone: string | null
          directory_website_url: string | null
          favicon_url: string | null
          flat_price_per_model_cents: number | null
          ga_tracking_id: string | null
          gate_label: string
          geocoded_at: string | null
          hero_bg_opacity: number
          hero_bg_url: string | null
          hero_lines: Json | null
          hud_bg_color: string
          id: string
          instant_payout_fee_bps: number
          is_directory_public: boolean
          latitude: number | null
          logo_shape: string
          logo_url: string | null
          longitude: number | null
          model_threshold: number | null
          primary_city: string | null
          provider_id: string
          region: string | null
          service_center: unknown
          service_polygon: unknown
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
          calling_card_cta_label?: string | null
          calling_card_headline?: string | null
          calling_card_logo_url?: string | null
          calling_card_studio_name?: string | null
          country?: string
          created_at?: string
          custom_domain?: string | null
          directory_contact_email?: string | null
          directory_phone?: string | null
          directory_website_url?: string | null
          favicon_url?: string | null
          flat_price_per_model_cents?: number | null
          ga_tracking_id?: string | null
          gate_label?: string
          geocoded_at?: string | null
          hero_bg_opacity?: number
          hero_bg_url?: string | null
          hero_lines?: Json | null
          hud_bg_color?: string
          id?: string
          instant_payout_fee_bps?: number
          is_directory_public?: boolean
          latitude?: number | null
          logo_shape?: string
          logo_url?: string | null
          longitude?: number | null
          model_threshold?: number | null
          primary_city?: string | null
          provider_id: string
          region?: string | null
          service_center?: unknown
          service_polygon?: unknown
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
          calling_card_cta_label?: string | null
          calling_card_headline?: string | null
          calling_card_logo_url?: string | null
          calling_card_studio_name?: string | null
          country?: string
          created_at?: string
          custom_domain?: string | null
          directory_contact_email?: string | null
          directory_phone?: string | null
          directory_website_url?: string | null
          favicon_url?: string | null
          flat_price_per_model_cents?: number | null
          ga_tracking_id?: string | null
          gate_label?: string
          geocoded_at?: string | null
          hero_bg_opacity?: number
          hero_bg_url?: string | null
          hero_lines?: Json | null
          hud_bg_color?: string
          id?: string
          instant_payout_fee_bps?: number
          is_directory_public?: boolean
          latitude?: number | null
          logo_shape?: string
          logo_url?: string | null
          longitude?: number | null
          model_threshold?: number | null
          primary_city?: string | null
          provider_id?: string
          region?: string | null
          service_center?: unknown
          service_polygon?: unknown
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
          acquisition_source: string
          client_id: string
          created_at: string
          id: string
          is_free: boolean
          provider_id: string
        }
        Insert: {
          acquisition_source?: string
          client_id: string
          created_at?: string
          id?: string
          is_free?: boolean
          provider_id: string
        }
        Update: {
          acquisition_source?: string
          client_id?: string
          created_at?: string
          id?: string
          is_free?: boolean
          provider_id?: string
        }
        Relationships: []
      }
      custom_qas: {
        Row: {
          answer: string
          created_at: string
          embedding: string | null
          id: string
          property_uuid: string
          provider_id: string
          question: string
          saved_model_id: string
          updated_at: string
        }
        Insert: {
          answer: string
          created_at?: string
          embedding?: string | null
          id?: string
          property_uuid: string
          provider_id: string
          question: string
          saved_model_id: string
          updated_at?: string
        }
        Update: {
          answer?: string
          created_at?: string
          embedding?: string | null
          id?: string
          property_uuid?: string
          provider_id?: string
          question?: string
          saved_model_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      doorway_candidates: {
        Row: {
          created_at: string
          doorway_payload: Json | null
          notes: string | null
          property_id: string
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          doorway_payload?: Json | null
          notes?: string | null
          property_id: string
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          doorway_payload?: Json | null
          notes?: string | null
          property_id?: string
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "doorway_candidates_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
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
      ephemeral_assets: {
        Row: {
          bucket_id: string
          created_at: string
          expires_at: string
          file_path: string
          file_size_bytes: number | null
          id: string
          mime_type: string | null
          purpose: string
          user_id: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          expires_at?: string
          file_path: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          purpose?: string
          user_id: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          expires_at?: string
          file_path?: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          purpose?: string
          user_id?: string
        }
        Relationships: []
      }
      invitations: {
        Row: {
          acquisition_source: string
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
          acquisition_source?: string
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
          acquisition_source?: string
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
      marketplace_outreach: {
        Row: {
          agent_flagged_at: string | null
          agent_flagged_spam: boolean
          beacon_id: string
          body: string | null
          created_at: string
          email_send_log_id: string | null
          feedback_token: string
          id: string
          penalty_applied_at: string | null
          provider_id: string
          sent_at: string
          subject: string
        }
        Insert: {
          agent_flagged_at?: string | null
          agent_flagged_spam?: boolean
          beacon_id: string
          body?: string | null
          created_at?: string
          email_send_log_id?: string | null
          feedback_token?: string
          id?: string
          penalty_applied_at?: string | null
          provider_id: string
          sent_at?: string
          subject: string
        }
        Update: {
          agent_flagged_at?: string | null
          agent_flagged_spam?: boolean
          beacon_id?: string
          body?: string | null
          created_at?: string
          email_send_log_id?: string | null
          feedback_token?: string
          id?: string
          penalty_applied_at?: string | null
          provider_id?: string
          sent_at?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_outreach_beacon_id_fkey"
            columns: ["beacon_id"]
            isOneToOne: true
            referencedRelation: "agent_beacons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_outreach_email_send_log_id_fkey"
            columns: ["email_send_log_id"]
            isOneToOne: false
            referencedRelation: "email_send_log"
            referencedColumns: ["id"]
          },
        ]
      }
      netlify_connections: {
        Row: {
          access_token: string
          created_at: string
          netlify_user_email: string | null
          netlify_user_full_name: string | null
          netlify_user_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          netlify_user_email?: string | null
          netlify_user_full_name?: string | null
          netlify_user_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          netlify_user_email?: string | null
          netlify_user_full_name?: string | null
          netlify_user_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      netlify_oauth_states: {
        Row: {
          created_at: string
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          state: string
          user_id: string
        }
        Update: {
          created_at?: string
          state?: string
          user_id?: string
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
      platform_fee_ledger: {
        Row: {
          acquisition_source: string
          checkout_path: string | null
          client_id: string | null
          collected_at: string | null
          failed_reason: string | null
          fee_schedule_id: string
          id: string
          model_count: number
          notes: string | null
          occurred_at: string
          platform_fee_cents: number
          provider_id: string | null
          refunded_at: string | null
          saved_model_id: string | null
          status: string
          stripe_application_fee_id: string | null
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
        }
        Insert: {
          acquisition_source: string
          checkout_path?: string | null
          client_id?: string | null
          collected_at?: string | null
          failed_reason?: string | null
          fee_schedule_id: string
          id?: string
          model_count: number
          notes?: string | null
          occurred_at?: string
          platform_fee_cents: number
          provider_id?: string | null
          refunded_at?: string | null
          saved_model_id?: string | null
          status?: string
          stripe_application_fee_id?: string | null
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
        }
        Update: {
          acquisition_source?: string
          checkout_path?: string | null
          client_id?: string | null
          collected_at?: string | null
          failed_reason?: string | null
          fee_schedule_id?: string
          id?: string
          model_count?: number
          notes?: string | null
          occurred_at?: string
          platform_fee_cents?: number
          provider_id?: string | null
          refunded_at?: string | null
          saved_model_id?: string | null
          status?: string
          stripe_application_fee_id?: string | null
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_fee_ledger_fee_schedule_id_fkey"
            columns: ["fee_schedule_id"]
            isOneToOne: false
            referencedRelation: "platform_fee_schedule"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_fee_ledger_saved_model_id_fkey"
            columns: ["saved_model_id"]
            isOneToOne: false
            referencedRelation: "saved_models"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_fee_schedule: {
        Row: {
          created_at: string
          effective_from: string
          effective_until: string | null
          fee_cents: number
          id: string
          model_count: number
          source: string
        }
        Insert: {
          created_at?: string
          effective_from?: string
          effective_until?: string | null
          fee_cents: number
          id?: string
          model_count: number
          source: string
        }
        Update: {
          created_at?: string
          effective_from?: string
          effective_until?: string | null
          fee_cents?: number
          id?: string
          model_count?: number
          source?: string
        }
        Relationships: []
      }
      presentation_tokens: {
        Row: {
          created_at: string
          id: string
          issued_at: string
          payload: Json
          revoked_at: string | null
          rotated_from: string | null
          saved_model_id: string
          token_hash: string
        }
        Insert: {
          created_at?: string
          id?: string
          issued_at?: string
          payload: Json
          revoked_at?: string | null
          rotated_from?: string | null
          saved_model_id: string
          token_hash: string
        }
        Update: {
          created_at?: string
          id?: string
          issued_at?: string
          payload?: Json
          revoked_at?: string | null
          rotated_from?: string | null
          saved_model_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "presentation_tokens_rotated_from_fkey"
            columns: ["rotated_from"]
            isOneToOne: false
            referencedRelation: "presentation_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presentation_tokens_saved_model_id_fkey"
            columns: ["saved_model_id"]
            isOneToOne: false
            referencedRelation: "saved_models"
            referencedColumns: ["id"]
          },
        ]
      }
      processed_webhook_events: {
        Row: {
          env: string
          event_id: string
          event_type: string
          processed_at: string
          source: string
        }
        Insert: {
          env: string
          event_id: string
          event_type: string
          processed_at?: string
          source?: string
        }
        Update: {
          env?: string
          event_id?: string
          event_type?: string
          processed_at?: string
          source?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company: string | null
          created_at: string
          display_name: string | null
          favicon_url: string | null
          floor_plan_free_passes_used: number
          ga_tracking_id: string | null
          id: string
          logo_url: string | null
          phone: string | null
          provider_id: string | null
          social_links: Json
          title_role: string | null
          updated_at: string
          user_id: string
          welcome_note: string | null
        }
        Insert: {
          avatar_url?: string | null
          company?: string | null
          created_at?: string
          display_name?: string | null
          favicon_url?: string | null
          floor_plan_free_passes_used?: number
          ga_tracking_id?: string | null
          id?: string
          logo_url?: string | null
          phone?: string | null
          provider_id?: string | null
          social_links?: Json
          title_role?: string | null
          updated_at?: string
          user_id: string
          welcome_note?: string | null
        }
        Update: {
          avatar_url?: string | null
          company?: string | null
          created_at?: string
          display_name?: string | null
          favicon_url?: string | null
          floor_plan_free_passes_used?: number
          ga_tracking_id?: string | null
          id?: string
          logo_url?: string | null
          phone?: string | null
          provider_id?: string | null
          social_links?: Json
          title_role?: string | null
          updated_at?: string
          user_id?: string
          welcome_note?: string | null
        }
        Relationships: []
      }
      properties: {
        Row: {
          administrative_area: string | null
          business_status: string | null
          country_code: string | null
          created_at: string
          first_seen_at: string
          formatted_address: string | null
          google_place_id: string
          google_types: string[] | null
          hero_summary: string | null
          id: string
          last_seen_at: string
          last_snapshot_id: string | null
          locality: string | null
          name: string
          postal_code: string | null
          price_level: number | null
          primary_category: string | null
          primary_photo_url: string | null
          rating: number | null
          street_name: string | null
          street_number: string | null
          updated_at: string
          user_ratings_total: number | null
        }
        Insert: {
          administrative_area?: string | null
          business_status?: string | null
          country_code?: string | null
          created_at?: string
          first_seen_at?: string
          formatted_address?: string | null
          google_place_id: string
          google_types?: string[] | null
          hero_summary?: string | null
          id?: string
          last_seen_at?: string
          last_snapshot_id?: string | null
          locality?: string | null
          name: string
          postal_code?: string | null
          price_level?: number | null
          primary_category?: string | null
          primary_photo_url?: string | null
          rating?: number | null
          street_name?: string | null
          street_number?: string | null
          updated_at?: string
          user_ratings_total?: number | null
        }
        Update: {
          administrative_area?: string | null
          business_status?: string | null
          country_code?: string | null
          created_at?: string
          first_seen_at?: string
          formatted_address?: string | null
          google_place_id?: string
          google_types?: string[] | null
          hero_summary?: string | null
          id?: string
          last_seen_at?: string
          last_snapshot_id?: string | null
          locality?: string | null
          name?: string
          postal_code?: string | null
          price_level?: number | null
          primary_category?: string | null
          primary_photo_url?: string | null
          rating?: number | null
          street_name?: string | null
          street_number?: string | null
          updated_at?: string
          user_ratings_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_last_snapshot_id_fkey"
            columns: ["last_snapshot_id"]
            isOneToOne: false
            referencedRelation: "operator_failed_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_last_snapshot_id_fkey"
            columns: ["last_snapshot_id"]
            isOneToOne: false
            referencedRelation: "raw_scrape_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      property_contacts: {
        Row: {
          email: string | null
          phone_display: string | null
          phone_e164: string | null
          property_id: string
          updated_at: string
          website_url: string | null
        }
        Insert: {
          email?: string | null
          phone_display?: string | null
          phone_e164?: string | null
          property_id: string
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          email?: string | null
          phone_display?: string | null
          phone_e164?: string | null
          property_id?: string
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_contacts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_enrichment: {
        Row: {
          domain: string | null
          enriched_at: string | null
          enrichment_source: string | null
          estimated_annual_revenue_usd: number | null
          estimated_employees: number | null
          property_id: string
          signals: Json | null
          social_links: Json | null
          tech_stack: string[] | null
          updated_at: string
        }
        Insert: {
          domain?: string | null
          enriched_at?: string | null
          enrichment_source?: string | null
          estimated_annual_revenue_usd?: number | null
          estimated_employees?: number | null
          property_id: string
          signals?: Json | null
          social_links?: Json | null
          tech_stack?: string[] | null
          updated_at?: string
        }
        Update: {
          domain?: string | null
          enriched_at?: string | null
          enrichment_source?: string | null
          estimated_annual_revenue_usd?: number | null
          estimated_employees?: number | null
          property_id?: string
          signals?: Json | null
          social_links?: Json | null
          tech_stack?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_enrichment_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
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
      property_geo: {
        Row: {
          latitude: number
          location: unknown
          longitude: number
          plus_code: string | null
          property_id: string
          timezone: string | null
          updated_at: string
          viewport: Json | null
        }
        Insert: {
          latitude: number
          location?: unknown
          longitude: number
          plus_code?: string | null
          property_id: string
          timezone?: string | null
          updated_at?: string
          viewport?: Json | null
        }
        Update: {
          latitude?: number
          location?: unknown
          longitude?: number
          plus_code?: string | null
          property_id?: string
          timezone?: string | null
          updated_at?: string
          viewport?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "property_geo_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_hours: {
        Row: {
          closes_at: string | null
          day_of_week: number | null
          id: string
          is_24h: boolean
          is_closed: boolean
          opens_at: string | null
          property_id: string
          raw_text: string | null
          special_date: string | null
        }
        Insert: {
          closes_at?: string | null
          day_of_week?: number | null
          id?: string
          is_24h?: boolean
          is_closed?: boolean
          opens_at?: string | null
          property_id: string
          raw_text?: string | null
          special_date?: string | null
        }
        Update: {
          closes_at?: string | null
          day_of_week?: number | null
          id?: string
          is_24h?: boolean
          is_closed?: boolean
          opens_at?: string | null
          property_id?: string
          raw_text?: string | null
          special_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_hours_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_photos: {
        Row: {
          attribution: string | null
          cdn_url: string | null
          created_at: string
          height: number | null
          id: string
          ordinal: number
          property_id: string
          source_photo_ref: string | null
          width: number | null
        }
        Insert: {
          attribution?: string | null
          cdn_url?: string | null
          created_at?: string
          height?: number | null
          id?: string
          ordinal?: number
          property_id: string
          source_photo_ref?: string | null
          width?: number | null
        }
        Update: {
          attribution?: string | null
          cdn_url?: string | null
          created_at?: string
          height?: number | null
          id?: string
          ordinal?: number
          property_id?: string
          source_photo_ref?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "property_photos_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_review_summaries: {
        Row: {
          computed_at: string
          property_id: string
          recent_review_velocity: number | null
          reviews_sample: Json | null
          sentiment_score: number | null
        }
        Insert: {
          computed_at?: string
          property_id: string
          recent_review_velocity?: number | null
          reviews_sample?: Json | null
          sentiment_score?: number | null
        }
        Update: {
          computed_at?: string
          property_id?: string
          recent_review_velocity?: number | null
          reviews_sample?: Json | null
          sentiment_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "property_review_summaries_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_responsiveness: {
        Row: {
          leads_contacted: number
          leads_expired: number
          leads_received: number
          leads_won: number
          provider_id: string
          score: number
          updated_at: string
        }
        Insert: {
          leads_contacted?: number
          leads_expired?: number
          leads_received?: number
          leads_won?: number
          provider_id: string
          score?: number
          updated_at?: string
        }
        Update: {
          leads_contacted?: number
          leads_expired?: number
          leads_received?: number
          leads_won?: number
          provider_id?: string
          score?: number
          updated_at?: string
        }
        Relationships: []
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
      raw_scrape_snapshots: {
        Row: {
          created_at: string
          id: string
          processed_at: string | null
          processing_error: string | null
          query_context: Json | null
          raw_payload: Json
          scrape_run_id: string
          scraped_at: string
          source: string
          source_place_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          processed_at?: string | null
          processing_error?: string | null
          query_context?: Json | null
          raw_payload: Json
          scrape_run_id: string
          scraped_at?: string
          source: string
          source_place_id: string
        }
        Update: {
          created_at?: string
          id?: string
          processed_at?: string | null
          processing_error?: string | null
          query_context?: Json | null
          raw_payload?: Json
          scrape_run_id?: string
          scraped_at?: string
          source?: string
          source_place_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_scrape_snapshots_scrape_run_id_fkey"
            columns: ["scrape_run_id"]
            isOneToOne: false
            referencedRelation: "scrape_runs"
            referencedColumns: ["id"]
          },
        ]
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
          retail_waived: boolean
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
          retail_waived?: boolean
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
          retail_waived?: boolean
          status?: Database["public"]["Enums"]["model_status"]
          tour_config?: Json
          updated_at?: string
        }
        Relationships: []
      }
      scrape_runs: {
        Row: {
          completed_at: string | null
          error: string | null
          id: string
          initiated_by: string | null
          query_params: Json | null
          scraper_version: string | null
          started_at: string
          status: string
          total_snapshots: number
        }
        Insert: {
          completed_at?: string | null
          error?: string | null
          id?: string
          initiated_by?: string | null
          query_params?: Json | null
          scraper_version?: string | null
          started_at?: string
          status?: string
          total_snapshots?: number
        }
        Update: {
          completed_at?: string | null
          error?: string | null
          id?: string
          initiated_by?: string | null
          query_params?: Json | null
          scraper_version?: string | null
          started_at?: string
          status?: string
          total_snapshots?: number
        }
        Relationships: []
      }
      service_match_interest_events: {
        Row: {
          beacon_id: string
          created_at: string
          event_type: string
          id: string
          metadata: Json
          provider_id: string
        }
        Insert: {
          beacon_id: string
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          provider_id: string
        }
        Update: {
          beacon_id?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          provider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_match_interest_events_beacon_id_fkey"
            columns: ["beacon_id"]
            isOneToOne: false
            referencedRelation: "agent_beacons"
            referencedColumns: ["id"]
          },
        ]
      }
      site_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
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
      supply_gap_signals: {
        Row: {
          city: string | null
          created_at: string
          essential_services: Database["public"]["Enums"]["marketplace_specialty"][]
          id: string
          notified_at: string | null
          region: string | null
          resolved_at: string | null
          source_engine: string
          work_order_id: string | null
          zip: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          essential_services?: Database["public"]["Enums"]["marketplace_specialty"][]
          id?: string
          notified_at?: string | null
          region?: string | null
          resolved_at?: string | null
          source_engine: string
          work_order_id?: string | null
          zip?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string
          essential_services?: Database["public"]["Enums"]["marketplace_specialty"][]
          id?: string
          notified_at?: string | null
          region?: string | null
          resolved_at?: string | null
          source_engine?: string
          work_order_id?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supply_gap_signals_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: true
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
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
      work_order_invites: {
        Row: {
          available_score_delta_at: string | null
          created_at: string
          email_sent_at: string | null
          expired_penalty_applied_at: string | null
          id: string
          provider_id: string
          provider_note: string | null
          push_sent_at: string | null
          rank_at_invite: number | null
          respond_by: string
          responded_at: string | null
          response_status: Database["public"]["Enums"]["work_order_invite_status"]
          updated_at: string
          work_order_id: string
        }
        Insert: {
          available_score_delta_at?: string | null
          created_at?: string
          email_sent_at?: string | null
          expired_penalty_applied_at?: string | null
          id?: string
          provider_id: string
          provider_note?: string | null
          push_sent_at?: string | null
          rank_at_invite?: number | null
          respond_by: string
          responded_at?: string | null
          response_status?: Database["public"]["Enums"]["work_order_invite_status"]
          updated_at?: string
          work_order_id: string
        }
        Update: {
          available_score_delta_at?: string | null
          created_at?: string
          email_sent_at?: string | null
          expired_penalty_applied_at?: string | null
          id?: string
          provider_id?: string
          provider_note?: string | null
          push_sent_at?: string | null
          rank_at_invite?: number | null
          respond_by?: string
          responded_at?: string | null
          response_status?: Database["public"]["Enums"]["work_order_invite_status"]
          updated_at?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_invites_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_order_ratings: {
        Row: {
          agent_user_id: string
          created_at: string
          email_sent_at: string | null
          feedback_text: string | null
          id: string
          provider_id: string
          rating_token: string
          score_delta_applied_at: string | null
          stars: number | null
          submitted_at: string | null
          work_order_id: string
        }
        Insert: {
          agent_user_id: string
          created_at?: string
          email_sent_at?: string | null
          feedback_text?: string | null
          id?: string
          provider_id: string
          rating_token?: string
          score_delta_applied_at?: string | null
          stars?: number | null
          submitted_at?: string | null
          work_order_id: string
        }
        Update: {
          agent_user_id?: string
          created_at?: string
          email_sent_at?: string | null
          feedback_text?: string | null
          id?: string
          provider_id?: string
          rating_token?: string
          score_delta_applied_at?: string | null
          stars?: number | null
          submitted_at?: string | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_ratings_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: true
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_orders: {
        Row: {
          address_line1: string
          address_line2: string | null
          agent_user_id: string
          available_from: string
          available_to: string
          cancelled_at: string | null
          city: string
          completion:
            | Database["public"]["Enums"]["work_order_completion"]
            | null
          completion_at: string | null
          confirmed_at: string | null
          confirmed_provider_id: string | null
          created_at: string
          essential_services: Database["public"]["Enums"]["marketplace_specialty"][]
          expires_at: string
          id: string
          lat: number | null
          lng: number | null
          notes: string | null
          pii_released_at: string | null
          preferable_services: Database["public"]["Enums"]["marketplace_specialty"][]
          priority_window_until: string | null
          property_type: string
          region: string | null
          size_band: string
          source_beacon_id: string | null
          status: Database["public"]["Enums"]["work_order_status"]
          updated_at: string
          wo_point: unknown
          zip: string | null
        }
        Insert: {
          address_line1: string
          address_line2?: string | null
          agent_user_id: string
          available_from: string
          available_to: string
          cancelled_at?: string | null
          city: string
          completion?:
            | Database["public"]["Enums"]["work_order_completion"]
            | null
          completion_at?: string | null
          confirmed_at?: string | null
          confirmed_provider_id?: string | null
          created_at?: string
          essential_services?: Database["public"]["Enums"]["marketplace_specialty"][]
          expires_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          notes?: string | null
          pii_released_at?: string | null
          preferable_services?: Database["public"]["Enums"]["marketplace_specialty"][]
          priority_window_until?: string | null
          property_type: string
          region?: string | null
          size_band: string
          source_beacon_id?: string | null
          status?: Database["public"]["Enums"]["work_order_status"]
          updated_at?: string
          wo_point?: unknown
          zip?: string | null
        }
        Update: {
          address_line1?: string
          address_line2?: string | null
          agent_user_id?: string
          available_from?: string
          available_to?: string
          cancelled_at?: string | null
          city?: string
          completion?:
            | Database["public"]["Enums"]["work_order_completion"]
            | null
          completion_at?: string | null
          confirmed_at?: string | null
          confirmed_provider_id?: string | null
          created_at?: string
          essential_services?: Database["public"]["Enums"]["marketplace_specialty"][]
          expires_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          notes?: string | null
          pii_released_at?: string | null
          preferable_services?: Database["public"]["Enums"]["marketplace_specialty"][]
          priority_window_until?: string | null
          property_type?: string
          region?: string | null
          size_band?: string
          source_beacon_id?: string | null
          status?: Database["public"]["Enums"]["work_order_status"]
          updated_at?: string
          wo_point?: unknown
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_source_beacon_id_fkey"
            columns: ["source_beacon_id"]
            isOneToOne: false
            referencedRelation: "agent_beacons"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
      operator_doorway_candidates: {
        Row: {
          category: string | null
          created_at: string | null
          doorway_payload: Json | null
          google_place_id: string | null
          hero_summary: string | null
          locality: string | null
          name: string | null
          notes: string | null
          property_id: string | null
          region: string | null
          reviewed_by: string | null
          status: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doorway_candidates_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_failed_snapshots: {
        Row: {
          id: string | null
          initiated_by: string | null
          processed_at: string | null
          processing_error: string | null
          scrape_run_id: string | null
          scraped_at: string | null
          source: string | null
          source_place_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_scrape_snapshots_scrape_run_id_fkey"
            columns: ["scrape_run_id"]
            isOneToOne: false
            referencedRelation: "scrape_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_open_supply_gaps: {
        Row: {
          city: string | null
          created_at: string | null
          essential_services:
            | Database["public"]["Enums"]["marketplace_specialty"][]
            | null
          id: string | null
          notified_at: string | null
          region: string | null
          source_engine: string | null
          work_order_id: string | null
          zip: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string | null
          essential_services?:
            | Database["public"]["Enums"]["marketplace_specialty"][]
            | null
          id?: string | null
          notified_at?: string | null
          region?: string | null
          source_engine?: string | null
          work_order_id?: string | null
          zip?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string | null
          essential_services?:
            | Database["public"]["Enums"]["marketplace_specialty"][]
            | null
          id?: string | null
          notified_at?: string | null
          region?: string | null
          source_engine?: string | null
          work_order_id?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supply_gap_signals_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: true
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _compose_hero_summary: {
        Args: { p_property_id: string }
        Returns: string
      }
      _count_eligible_pros_for_beacon: {
        Args: { p_beacon_id: string }
        Returns: number
      }
      _count_eligible_pros_for_work_order: {
        Args: { p_work_order_id: string }
        Returns: number
      }
      _extract_address_component: {
        Args: {
          p_components: Json
          p_type_filter: string
          p_use_short?: boolean
        }
        Returns: string
      }
      _is_provider_serving_beacon: {
        Args: { p_beacon_id: string; p_provider_id: string }
        Returns: boolean
      }
      _is_provider_serving_work_order: {
        Args: { p_provider_id: string; p_work_order_id: string }
        Returns: boolean
      }
      _normalize_phone_e164: { Args: { p_intl: string }; Returns: string }
      _parse_google_time: { Args: { p_t: string }; Returns: string }
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _provider_can_receive_leads: {
        Args: { p_provider_id: string }
        Returns: boolean
      }
      _resolve_platform_fee_cents: {
        Args: { p_model_count: number; p_source: string }
        Returns: number
      }
      _safe_integer: { Args: { p_v: Json }; Returns: number }
      _safe_numeric: { Args: { p_v: Json }; Returns: number }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _update_responsiveness_score: {
        Args: { p_counter?: string; p_delta: number; p_provider_id: string }
        Returns: undefined
      }
      accept_invitation_self: {
        Args: { _token: string }
        Returns: {
          provider_id: string
        }[]
      }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      admin_get_user_emails_by_ids: {
        Args: { _ids: string[] }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      admin_get_user_id_by_email: { Args: { _email: string }; Returns: string }
      admin_grant_tier: {
        Args: {
          _expires_at: string
          _provider_id: string
          _tier: Database["public"]["Enums"]["app_tier"]
        }
        Returns: string
      }
      admin_revoke_grant: { Args: { _grant_id: string }; Returns: undefined }
      apply_no_disposition_penalties: { Args: never; Returns: number }
      apply_outreach_feedback: {
        Args: { p_feedback_token: string }
        Returns: boolean
      }
      cancel_work_order: { Args: { p_work_order_id: string }; Returns: boolean }
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
      claim_pending_beacon_matches: {
        Args: { p_limit?: number }
        Returns: {
          beacon_city: string
          beacon_email: string
          beacon_id: string
          beacon_name: string
          beacon_region: string
          exclusive_until: string
          provider_brand_name: string
          provider_custom_domain: string
          provider_email: string
          provider_id: string
          provider_slug: string
          provider_tier: Database["public"]["Enums"]["app_tier"]
        }[]
      }
      cleanup_old_outreach_bodies: { Args: never; Returns: number }
      cleanup_seed_msps: { Args: never; Returns: number }
      compose_doorway_payload: {
        Args: { p_property_id: string }
        Returns: Json
      }
      compute_priority_window_for_beacon: {
        Args: { p_beacon_id: string }
        Returns: string
      }
      confirm_work_order_msp: {
        Args: { p_provider_id: string; p_work_order_id: string }
        Returns: boolean
      }
      consume_floor_plan_pass: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: {
          allowed: boolean
          lifetime_limit: number
          used: number
        }[]
      }
      decline_invitation: { Args: { _token: string }; Returns: boolean }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      detect_directory_supply_gaps: {
        Args: { p_lookback?: string }
        Returns: number
      }
      detect_doorway_candidates: { Args: { p_limit?: number }; Returns: number }
      disablelongtransactions: { Args: never; Returns: string }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      expire_unanswered_invites: { Args: never; Returns: number }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      get_effective_tier: {
        Args: { _provider_id: string }
        Returns: Database["public"]["Enums"]["app_tier"]
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
      get_my_marketplace_standing: { Args: never; Returns: string }
      get_my_matched_beacons: {
        Args: never
        Returns: {
          brokerage: string
          city: string
          contacted_at: string
          created_at: string
          disposition: Database["public"]["Enums"]["beacon_disposition"]
          email: string
          exclusive_until: string
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
      get_my_service_polygon: { Args: never; Returns: Json }
      get_my_work_order_invites: {
        Args: never
        Returns: {
          address_line1: string
          address_line2: string
          agent_email: string
          agent_name: string
          agent_phone: string
          available_from: string
          available_to: string
          city: string
          completion: Database["public"]["Enums"]["work_order_completion"]
          completion_at: string
          created_at: string
          essential_services: Database["public"]["Enums"]["marketplace_specialty"][]
          invite_id: string
          notes: string
          pii_released: boolean
          preferable_services: Database["public"]["Enums"]["marketplace_specialty"][]
          property_type: string
          rank_at_invite: number
          region: string
          respond_by: string
          responded_at: string
          response_status: Database["public"]["Enums"]["work_order_invite_status"]
          size_band: string
          wo_status: Database["public"]["Enums"]["work_order_status"]
          work_order_id: string
          zip: string
        }[]
      }
      get_my_work_orders: {
        Args: never
        Returns: {
          available_count: number
          available_from: string
          available_to: string
          city: string
          completion: Database["public"]["Enums"]["work_order_completion"]
          completion_at: string
          confirmed_brand_name: string
          confirmed_provider_id: string
          created_at: string
          essential_services: Database["public"]["Enums"]["marketplace_specialty"][]
          expired_count: number
          id: string
          invite_count: number
          preferable_services: Database["public"]["Enums"]["marketplace_specialty"][]
          priority_window_until: string
          property_type: string
          region: string
          size_band: string
          status: Database["public"]["Enums"]["work_order_status"]
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
      get_service_match_detail_for_admin: {
        Args: { p_match_token: string }
        Returns: Json
      }
      get_service_match_requests_for_admin: {
        Args: never
        Returns: {
          brokerage: string
          city: string
          created_at: string
          email: string
          essential_services: Database["public"]["Enums"]["marketplace_specialty"][]
          expires_at: string
          id: string
          match_token: string
          name: string
          preferable_services: Database["public"]["Enums"]["marketplace_specialty"][]
          region: string
          status: Database["public"]["Enums"]["beacon_status"]
          zip: string
        }[]
      }
      get_service_match_results: {
        Args: { p_match_token: string }
        Returns: {
          brand_name: string
          directory_contact_email: string
          directory_phone: string
          directory_website_url: string
          logo_url: string
          match_quality: string
          match_score: number
          matched_essential: Database["public"]["Enums"]["marketplace_specialty"][]
          matched_preferable: Database["public"]["Enums"]["marketplace_specialty"][]
          missing_preferable: Database["public"]["Enums"]["marketplace_specialty"][]
          primary_city: string
          provider_id: string
          region: string
          slug: string
          standing_label: string
          standing_score: number
          tier: Database["public"]["Enums"]["app_tier"]
        }[]
      }
      get_service_match_summary: {
        Args: { p_match_token: string }
        Returns: Json
      }
      get_user_tier: {
        Args: { check_env?: string; user_uuid: string }
        Returns: string
      }
      get_work_order_detail_for_agent: {
        Args: { p_work_order_id: string }
        Returns: Json
      }
      gettransactionid: { Args: never; Returns: unknown }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_provider_serving_location: {
        Args: {
          p_city: string
          p_provider_id: string
          p_region: string
          p_zip: string
        }
        Returns: boolean
      }
      issue_studio_preview_token: { Args: { _slug: string }; Returns: string }
      leak_expired_pro_windows: { Args: never; Returns: number }
      longtransactionsenabled: { Args: never; Returns: boolean }
      lookup_outreach_by_token: {
        Args: { p_feedback_token: string }
        Returns: {
          already_flagged: boolean
          brand_name: string
          sent_at: string
        }[]
      }
      lookup_work_order_rating_by_token: {
        Args: { p_rating_token: string }
        Returns: {
          already_submitted: boolean
          completion_at: string
          msp_brand_name: string
        }[]
      }
      mark_work_order_complete: {
        Args: { p_completion: string; p_work_order_id: string }
        Returns: {
          ok: boolean
          rating_token: string
        }[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      process_raw_snapshot: {
        Args: { p_snapshot_id: string }
        Returns: undefined
      }
      process_unprocessed_snapshots: {
        Args: { p_batch_size?: number }
        Returns: {
          failed: number
          processed: number
        }[]
      }
      promote_property_to_beacon: {
        Args: { p_consent_text_override?: string; p_property_id: string }
        Returns: string
      }
      provider_has_paid_access: {
        Args: { _provider_id: string }
        Returns: boolean
      }
      provider_preview_allowed: {
        Args: { _provider_id: string }
        Returns: boolean
      }
      provision_trial_grant: {
        Args: { _tier: Database["public"]["Enums"]["app_tier"] }
        Returns: string
      }
      public_beacon_demand: {
        Args: never
        Returns: {
          city: string
          region: string
          waiting_count: number
        }[]
      }
      purge_expired_ephemeral_assets: { Args: never; Returns: number }
      purge_stale_trial_studios: { Args: never; Returns: number }
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
          preferred_model: string
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
      read_floor_plan_pass_status: {
        Args: never
        Returns: {
          byok_active: boolean
          lifetime_limit: number
          used: number
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
      record_service_match_interest: {
        Args: {
          p_event_type: string
          p_match_token: string
          p_provider_id: string
        }
        Returns: Json
      }
      repool_expired_exclusives_and_enqueue: { Args: never; Returns: number }
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
      respond_to_work_order_invite: {
        Args: {
          p_invite_id: string
          p_provider_note?: string
          p_response: string
        }
        Returns: boolean
      }
      search_msp_directory: {
        Args: {
          p_city?: string
          p_lat?: number
          p_lng?: number
          p_region?: string
          p_zip?: string
        }
        Returns: {
          brand_name: string
          logo_url: string
          match_reason: string
          primary_city: string
          region: string
          slug: string
          specialties: Database["public"]["Enums"]["marketplace_specialty"][]
          tier: Database["public"]["Enums"]["app_tier"]
        }[]
      }
      send_marketplace_outreach: {
        Args: { p_beacon_id: string; p_body: string; p_subject: string }
        Returns: {
          feedback_token: string
          outreach_id: string
        }[]
      }
      set_beacon_disposition: {
        Args: {
          p_beacon_id: string
          p_disposition: Database["public"]["Enums"]["beacon_disposition"]
        }
        Returns: boolean
      }
      set_client_byok_active: {
        Args: { p_active: boolean; p_client_id: string }
        Returns: number
      }
      set_doorway_candidate_status: {
        Args: { p_property_id: string; p_status: string }
        Returns: undefined
      }
      set_my_service_polygon: { Args: { p_geojson?: Json }; Returns: boolean }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      submit_work_order: {
        Args: {
          p_address_line1: string
          p_address_line2: string
          p_available_from: string
          p_available_to: string
          p_city: string
          p_essential_services: Database["public"]["Enums"]["marketplace_specialty"][]
          p_lat?: number
          p_lng?: number
          p_notes?: string
          p_preferable_services: Database["public"]["Enums"]["marketplace_specialty"][]
          p_property_type: string
          p_region: string
          p_selected_provider_ids: string[]
          p_size_band: string
          p_source_beacon_id?: string
          p_zip: string
        }
        Returns: {
          invite_count: number
          priority_window_until: string
          work_order_id: string
        }[]
      }
      submit_work_order_rating: {
        Args: { p_feedback?: string; p_rating_token: string; p_stars: number }
        Returns: boolean
      }
      unlockrows: { Args: { "": string }; Returns: number }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
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
        | "scan-walkthrough-video-clips"
      model_status: "preview" | "pending_payment" | "paid"
      vault_category:
        | "spatial_audio"
        | "visual_hud_filter"
        | "interactive_widget"
        | "custom_iconography"
        | "property_doc"
        | "external_link"
      work_order_completion: "complete" | "incomplete"
      work_order_invite_status:
        | "invited"
        | "available"
        | "not_available"
        | "expired"
        | "not_selected"
        | "withdrawn"
      work_order_status:
        | "pending"
        | "confirmed"
        | "completed"
        | "incomplete"
        | "cancelled"
        | "expired"
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
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
        "scan-walkthrough-video-clips",
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
      work_order_completion: ["complete", "incomplete"],
      work_order_invite_status: [
        "invited",
        "available",
        "not_available",
        "expired",
        "not_selected",
        "withdrawn",
      ],
      work_order_status: [
        "pending",
        "confirmed",
        "completed",
        "incomplete",
        "cancelled",
        "expired",
      ],
    },
  },
} as const
