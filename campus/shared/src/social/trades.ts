import type { StallStyle } from "../interior/stalls";

export type SpecialId = "risky" | "hot" | "palm";

export interface SpecialTrade {
  id: SpecialId;
  label: string;
  price: number;
  food: number;
  fun: number;
  style: StallStyle;
  goods: number;
  open: number;
  close: number;
}

const at = (hour: number, minute = 0) => hour * 60 + minute;

export const SPECIAL_TRADES: Record<SpecialId, SpecialTrade> = {
  risky: { id: "risky", label: "Risky: night food till 3:00", price: 300, food: 34, fun: 4, style: "kiosk", goods: 7, open: at(22), close: at(4) },
  hot: { id: "hot", label: "As E Dey Hot: puff-puff & buns", price: 150, food: 18, fun: 5, style: "table", goods: 2, open: at(16), close: at(21) },
  palm: { id: "palm", label: "Palm wine, one calabash", price: 200, food: 4, fun: 14, style: "cooler", goods: 5, open: at(20), close: at(23) },
};

export const ORDINARY_HOURS = { open: at(6), close: at(22) } as const;

export const TOUCHLINE_LABEL = "Touchline bench";
export const GYRATION_LABEL = "Gyration circle";
export const FORECOURT_LABEL = "Forecourt games";

export function withinHours(minute: number, open: number, close: number): boolean {
  return open <= close ? minute >= open && minute < close : minute >= open || minute < close;
}
