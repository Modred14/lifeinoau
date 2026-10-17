export interface Vitals {
  food: number;
  energy: number;
}

const safeNeed = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;

export function walkingFactor({ food, energy }: Vitals): number {
  const fed = 0.45 + 0.55 * Math.min(1, safeNeed(food) / 30);
  const rested = 0.5 + 0.5 * Math.min(1, safeNeed(energy) / 25);
  return Math.min(fed, rested);
}

export function vitalityMessage(vitals: Vitals): string | null {
  const food = safeNeed(vitals.food);
  const energy = safeNeed(vitals.energy);
  if (food < 30 && energy < 25) return "You feel weak. Eat something and get some rest.";
  if (food < 30) return "You are hungry and walking slower. Eat something.";
  if (energy < 25) return "You are tired and walking slower. Find a bed to rest.";
  return null;
}
