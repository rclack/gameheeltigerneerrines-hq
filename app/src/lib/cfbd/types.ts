export interface CfbdTeam {
  id: number;
  school: string;
  abbreviation?: string | null;
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

export type InternalGameStatus = "scheduled" | "in_progress" | "final" | "postponed" | "canceled";

export interface NormalizedCfbdGame {
  external_id: string;
  season: string;
  week: number;
  game_date: string;
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
