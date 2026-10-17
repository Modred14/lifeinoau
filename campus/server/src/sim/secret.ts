const DEFAULT_DRAW_SECRET = "campus-life-local-draw-secret";
const ENV_KEY = "DRAW_SECRET";

let override: string | undefined;

export function drawSecret(): string {
  return override ?? (process.env[ENV_KEY] || DEFAULT_DRAW_SECRET);
}

export function setDrawSecret(value: string | undefined) {
  override = value;
}
