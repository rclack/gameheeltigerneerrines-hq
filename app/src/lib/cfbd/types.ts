export interface CfbdTeam {
  id: number;
  school: string;
  abbreviation?: string | null;
  color?: string | null;
  alternateColor?: string | null;
  logos: string[];
}
export interface CfbdGame {
  id: number;
  season: number;
  week: number;
  seasonType?: string | null;
  startDate: string;
  status?: string | null;
  completed?: boolean | null;
  neutralSite?: boolean | null;
  homeId?: number | null;
  homeTeam: string;
  homePoints?: number | null;
  awayId?: number | null;
  awayTeam: string;
  awayPoints?: number | null;
}

export interface CfbdRankingEntry {
  rank: number;
  school: string;
}

export interface CfbdPoll {
  poll: string;
  ranks: CfbdRankingEntry[];
}

export interface CfbdRankingWeek {
  season: number;
  seasonType: string;
  week: number;
  polls: CfbdPoll[];
}

export type InternalGameStatus = "scheduled" | "in_progress" | "final" | "postponed" | "canceled";

export interface NormalizedCfbdGame {
  external_id: string;
  season: string;
  provider_week: number;
  week: number;
  game_date: string;
  start_at: string;
  home_external_team_id: string | null;
  home_external_name: string;
  away_external_team_id: string | null;
  away_external_name: string;
  home_score: number | null;
  away_score: number | null;
  status: InternalGameStatus;
  neutral_site: boolean;
  postseason: boolean;
}
