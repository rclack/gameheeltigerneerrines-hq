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
      randomize_draft_order: { Args: { target_league_id: string }; Returns: string };
      reset_draft: { Args: { target_draft_id: string }; Returns: boolean };
      start_draft: { Args: { target_draft_id: string }; Returns: boolean };
      set_draft_paused: { Args: { target_draft_id: string; should_pause: boolean }; Returns: Database["public"]["Enums"]["draft_status"] };
      submit_draft_pick: { Args: { target_draft_id: string; target_team_id: string }; Returns: Database["public"]["Tables"]["draft_picks"]["Row"] };
      update_my_team_name: { Args: { target_league_id: string; new_team_name: string }; Returns: boolean };
      add_team_to_my_draft_queue: { Args: { target_draft_id: string; target_team_id: string }; Returns: Database["public"]["Tables"]["draft_queue_items"]["Row"] };
      remove_team_from_my_draft_queue: { Args: { target_queue_item_id: string }; Returns: boolean };
      move_team_in_my_draft_queue: { Args: { target_queue_item_id: string; move_direction: number }; Returns: boolean };
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
