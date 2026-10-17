export type BannerTone = "campaign" | "show" | "notice" | "advert" | "faith" | "sport";

export interface BannerArt {
  id: string;
  tone: BannerTone;
  title: string;
  lines: string[];
  footer?: string;
  color: number;
  ink: number;
  accent: number;
  weight: number;
  near?: number;
}
