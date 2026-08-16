export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      leagues: {
        Row: {
          id: string;
          name: string;
          season: string;
          commissioner_id: string;
          owner_count: number;
          teams_per_owner: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          season: string;
          commissioner_id: string;
          owner_count: number;
          teams_per_owner: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          season?: string;
          commissioner_id?: string;
          owner_count?: number;
          teams_per_owner?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      league_members: {
        Row: {
          id: string;
          league_id: string;
          user_id: string;
          role: Database["public"]["Enums"]["league_member_role"];
          team_name: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          user_id: string;
          role?: Database["public"]["Enums"]["league_member_role"];
          team_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          league_id?: string;
          user_id?: string;
          role?: Database["public"]["Enums"]["league_member_role"];
          team_name?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      league_invitations: {
        Row: {
          id: string;
          league_id: string;
          invited_email: string;
          invited_by: string;
          status: Database["public"]["Enums"]["league_invitation_status"];
          invitation_token: string;
          expires_at: string;
          accepted_by: string | null;
          accepted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          invited_email: string;
          invited_by: string;
          status?: Database["public"]["Enums"]["league_invitation_status"];
          invitation_token?: string;
          expires_at?: string;
          accepted_by?: string | null;
          accepted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          league_id?: string;
          invited_email?: string;
          invited_by?: string;
          status?: Database["public"]["Enums"]["league_invitation_status"];
          invitation_token?: string;
          expires_at?: string;
          accepted_by?: string | null;
          accepted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      teams: {
        Row: { id: string; school_name: string; short_name: string; abbreviation: string; conference: string; logo_url: string | null; active: boolean; created_at: string };
        Insert: { id?: string; school_name: string; short_name: string; abbreviation: string; conference: string; logo_url?: string | null; active?: boolean; created_at?: string };
        Update: { id?: string; school_name?: string; short_name?: string; abbreviation?: string; conference?: string; logo_url?: string | null; active?: boolean; created_at?: string };
        Relationships: [];
      };
      drafts: {
        Row: { id: string; league_id: string; status: Database["public"]["Enums"]["draft_status"]; current_round: number; current_pick: number; started_at: string | null; completed_at: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; league_id: string; status?: Database["public"]["Enums"]["draft_status"]; current_round?: number; current_pick?: number; started_at?: string | null; completed_at?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; league_id?: string; status?: Database["public"]["Enums"]["draft_status"]; current_round?: number; current_pick?: number; started_at?: string | null; completed_at?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      draft_slots: {
        Row: { id: string; draft_id: string; league_member_id: string; draft_position: number; created_at: string };
        Insert: { id?: string; draft_id: string; league_member_id: string; draft_position: number; created_at?: string };
        Update: { id?: string; draft_id?: string; league_member_id?: string; draft_position?: number; created_at?: string };
        Relationships: [];
      };
      draft_picks: {
        Row: { id: string; draft_id: string; league_member_id: string; team_id: string; round_number: number; pick_number: number; overall_pick: number; created_at: string };
        Insert: { id?: string; draft_id: string; league_member_id: string; team_id: string; round_number: number; pick_number: number; overall_pick: number; created_at?: string };
        Update: { id?: string; draft_id?: string; league_member_id?: string; team_id?: string; round_number?: number; pick_number?: number; overall_pick?: number; created_at?: string };
        Relationships: [];
      };
      draft_queue_items: {
        Row: { id: string; draft_id: string; league_member_id: string; team_id: string; queue_position: number; created_at: string; updated_at: string };
        Insert: { id?: string; draft_id: string; league_member_id: string; team_id: string; queue_position: number; created_at?: string; updated_at?: string };
        Update: { id?: string; draft_id?: string; league_member_id?: string; team_id?: string; queue_position?: number; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      scoring_rules: {
        Row: { id: string; league_id: string | null; code: string; display_name: string; description: string; category: string; points: number; active: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; league_id?: string | null; code: string; display_name: string; description: string; category: string; points: number; active?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; league_id?: string | null; code?: string; display_name?: string; description?: string; category?: string; points?: number; active?: boolean; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      conference_classifications: {
        Row: { id: string; season: string; conference: string; classification: string; created_at: string; updated_at: string };
        Insert: { id?: string; season: string; conference: string; classification: string; created_at?: string; updated_at?: string };
        Update: { id?: string; season?: string; conference?: string; classification?: string; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      cfb_games: {
        Row: { id: string; league_id: string; external_id: string | null; external_provider: string | null; data_source: string; provider_payload_hash: string | null; provider_synced_at: string | null; manual_override: boolean; season: string; week: number; game_date: string; start_at: string | null; home_team_id: string | null; away_team_id: string | null; home_external_opponent_id: string | null; away_external_opponent_id: string | null; home_score: number | null; away_score: number | null; status: string; neutral_site: boolean; postseason: boolean; scoring_fingerprint: string | null; scored_at: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; league_id: string; external_id?: string | null; external_provider?: string | null; data_source?: string; provider_payload_hash?: string | null; provider_synced_at?: string | null; manual_override?: boolean; season: string; week: number; game_date: string; start_at?: string | null; home_team_id?: string | null; away_team_id?: string | null; home_external_opponent_id?: string | null; away_external_opponent_id?: string | null; home_score?: number | null; away_score?: number | null; status?: string; neutral_site?: boolean; postseason?: boolean; scoring_fingerprint?: string | null; scored_at?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; league_id?: string; external_id?: string | null; external_provider?: string | null; data_source?: string; provider_payload_hash?: string | null; provider_synced_at?: string | null; manual_override?: boolean; season?: string; week?: number; game_date?: string; start_at?: string | null; home_team_id?: string | null; away_team_id?: string | null; home_external_opponent_id?: string | null; away_external_opponent_id?: string | null; home_score?: number | null; away_score?: number | null; status?: string; neutral_site?: boolean; postseason?: boolean; scoring_fingerprint?: string | null; scored_at?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      external_opponents: {
        Row: { id: string; provider: string; external_id: string; display_name: string; classification: "fcs" | "other"; created_at: string; updated_at: string };
        Insert: { id?: string; provider: string; external_id: string; display_name: string; classification: "fcs" | "other"; created_at?: string; updated_at?: string };
        Update: { id?: string; provider?: string; external_id?: string; display_name?: string; classification?: "fcs" | "other"; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      external_team_mappings: {
        Row: { id: string; provider: string; team_id: string; external_team_id: string; external_name: string; created_at: string; updated_at: string };
        Insert: { id?: string; provider: string; team_id: string; external_team_id: string; external_name: string; created_at?: string; updated_at?: string };
        Update: { id?: string; provider?: string; team_id?: string; external_team_id?: string; external_name?: string; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      external_sync_runs: {
        Row: { id: string; league_id: string; provider: string; sync_type: string; season: string; started_at: string; completed_at: string | null; status: string; fetched_count: number; created_count: number; updated_count: number; unchanged_count: number; skipped_count: number; error_count: number; summary: Json; initiated_by: string | null };
        Insert: { id?: string; league_id: string; provider: string; sync_type: string; season: string; started_at?: string; completed_at?: string | null; status?: string; fetched_count?: number; created_count?: number; updated_count?: number; unchanged_count?: number; skipped_count?: number; error_count?: number; summary?: Json; initiated_by?: string | null };
        Update: { id?: string; league_id?: string; provider?: string; sync_type?: string; season?: string; started_at?: string; completed_at?: string | null; status?: string; fetched_count?: number; created_count?: number; updated_count?: number; unchanged_count?: number; skipped_count?: number; error_count?: number; summary?: Json; initiated_by?: string | null };
        Relationships: [];
      };
      team_ranking_snapshots: {
        Row: { id: string; league_id: string; game_id: string | null; team_id: string; season: string; week: number; ranking_source: string; rank: number | null; captured_at: string; created_at: string };
        Insert: { id?: string; league_id: string; game_id?: string | null; team_id: string; season: string; week: number; ranking_source: string; rank?: number | null; captured_at?: string; created_at?: string };
        Update: { id?: string; league_id?: string; game_id?: string | null; team_id?: string; season?: string; week?: number; ranking_source?: string; rank?: number | null; captured_at?: string; created_at?: string };
        Relationships: [];
      };
      scoring_events: {
        Row: { id: string; league_id: string; team_id: string; scoring_rule_id: string; season: string; week: number | null; points: number; event_date: string; source_type: string; source_identifier: string | null; origin: string; idempotency_key: string; notes: string | null; metadata: Json; created_by: string | null; created_at: string; voided_at: string | null; voided_by: string | null; void_reason: string | null };
        Insert: { id?: string; league_id: string; team_id: string; scoring_rule_id: string; season: string; week?: number | null; points: number; event_date: string; source_type: string; source_identifier?: string | null; origin: string; idempotency_key: string; notes?: string | null; metadata?: Json; created_by?: string | null; created_at?: string; voided_at?: string | null; voided_by?: string | null; void_reason?: string | null };
        Update: { id?: string; league_id?: string; team_id?: string; scoring_rule_id?: string; season?: string; week?: number | null; points?: number; event_date?: string; source_type?: string; source_identifier?: string | null; origin?: string; idempotency_key?: string; notes?: string | null; metadata?: Json; created_by?: string | null; created_at?: string; voided_at?: string | null; voided_by?: string | null; void_reason?: string | null };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_league_invitation: {
        Args: { target_league_id: string; target_email: string };
        Returns: Database["public"]["Tables"]["league_invitations"]["Row"];
      };
      revoke_league_invitation: {
        Args: { target_invitation_id: string };
        Returns: boolean;
      };
      accept_league_invitation: {
        Args: { target_token: string };
        Returns: string | null;
      };
      inspect_league_invitation: {
        Args: { target_token: string };
        Returns: Array<{
          invited_email: string;
          invitation_status: Database["public"]["Enums"]["league_invitation_status"];
          expires_at: string;
          league_id: string;
          accepted_by_current_user: boolean;
        }>;
      };
      randomize_draft_order: { Args: { target_league_id: string }; Returns: string };
      set_manual_draft_order: { Args: { target_league_id: string; target_member_ids: string[] }; Returns: string };
      reset_draft: { Args: { target_draft_id: string }; Returns: boolean };
      start_draft: { Args: { target_draft_id: string }; Returns: boolean };
      set_draft_paused: { Args: { target_draft_id: string; should_pause: boolean }; Returns: Database["public"]["Enums"]["draft_status"] };
      submit_draft_pick: { Args: { target_draft_id: string; target_team_id: string }; Returns: Database["public"]["Tables"]["draft_picks"]["Row"] };
      update_my_team_name: { Args: { target_league_id: string; new_team_name: string }; Returns: boolean };
      add_team_to_my_draft_queue: { Args: { target_draft_id: string; target_team_id: string }; Returns: Database["public"]["Tables"]["draft_queue_items"]["Row"] };
      remove_team_from_my_draft_queue: { Args: { target_queue_item_id: string }; Returns: boolean };
      move_team_in_my_draft_queue: { Args: { target_queue_item_id: string; move_direction: number }; Returns: boolean };
      save_cfb_game: {
        Args: { target_game_id: string | null; target_league_id: string; target_season: string; target_week: number; target_game_date: string; target_home_team_id: string; target_away_team_id: string; target_home_score: number | null; target_away_score: number | null; target_status: string; target_neutral_site: boolean; target_postseason: boolean; target_ranking_source: string | null; target_home_rank: number | null; target_away_rank: number | null };
        Returns: Database["public"]["Tables"]["cfb_games"]["Row"];
      };
      process_cfb_game_scoring: { Args: { target_game_id: string }; Returns: number };
      add_manual_scoring_event: {
        Args: { target_league_id: string; target_team_id: string; target_rule_id: string; target_week: number | null; target_event_date: string | null; target_notes: string | null };
        Returns: Database["public"]["Tables"]["scoring_events"]["Row"];
      };
      void_manual_scoring_event: {
        Args: { target_event_id: string; target_reason: string };
        Returns: Database["public"]["Tables"]["scoring_events"]["Row"];
      };
      begin_external_sync: { Args: { target_league_id: string; target_provider: string; target_sync_type: string }; Returns: Database["public"]["Tables"]["external_sync_runs"]["Row"] };
      fail_external_sync: { Args: { target_sync_run_id: string; target_summary: Json }; Returns: Database["public"]["Tables"]["external_sync_runs"]["Row"] };
      save_external_team_mappings: { Args: { target_league_id: string; target_provider: string; target_mappings: Json }; Returns: number };
      apply_external_game_sync: { Args: { target_sync_run_id: string; target_games: Json; target_external_opponents: Json; target_mapping_summary: Json }; Returns: Database["public"]["Tables"]["external_sync_runs"]["Row"] };
      apply_cfb_ranking_snapshot_sync: { Args: { target_sync_run_id: string; target_snapshots: Json; target_missing_count: number }; Returns: Database["public"]["Tables"]["external_sync_runs"]["Row"] };
    };
    Enums: {
      league_member_role: "commissioner" | "owner";
      league_invitation_status: "pending" | "accepted" | "revoked" | "expired";
      draft_status: "not_started" | "live" | "paused" | "complete";
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type League = Database["public"]["Tables"]["leagues"]["Row"];
export type LeagueInsert = Database["public"]["Tables"]["leagues"]["Insert"];
export type LeagueMember = Database["public"]["Tables"]["league_members"]["Row"];
export type LeagueInvitation = Database["public"]["Tables"]["league_invitations"]["Row"];
export type Team = Database["public"]["Tables"]["teams"]["Row"];
export type Draft = Database["public"]["Tables"]["drafts"]["Row"];
export type DraftSlot = Database["public"]["Tables"]["draft_slots"]["Row"];
export type DraftPick = Database["public"]["Tables"]["draft_picks"]["Row"];
export type DraftQueueItem = Database["public"]["Tables"]["draft_queue_items"]["Row"];
export type ScoringRule = Database["public"]["Tables"]["scoring_rules"]["Row"];
export type ConferenceClassification = Database["public"]["Tables"]["conference_classifications"]["Row"];
export type CfbGame = Database["public"]["Tables"]["cfb_games"]["Row"];
export type TeamRankingSnapshot = Database["public"]["Tables"]["team_ranking_snapshots"]["Row"];
export type ScoringEvent = Database["public"]["Tables"]["scoring_events"]["Row"];
export type ExternalTeamMapping = Database["public"]["Tables"]["external_team_mappings"]["Row"];
export type ExternalOpponent = Database["public"]["Tables"]["external_opponents"]["Row"];
export type ExternalSyncRun = Database["public"]["Tables"]["external_sync_runs"]["Row"];
