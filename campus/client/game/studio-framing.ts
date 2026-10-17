export type StudioFocus = "full" | "hair" | "shoes";

export function studioFraming(focus: StudioFocus, aspect: number, body: "m" | "f") {
  const height = body === "m" ? 1.9 : 1.81;
  const subject = focus === "hair" ? { center: height - 0.28, height: 0.64, width: 0.66 } : focus === "shoes" ? { center: 0.2, height: 0.62, width: 0.74 } : { center: height * 0.46, height: height + 0.3, width: 1.25 };
  const distance = Math.max(subject.height, subject.width / Math.max(0.3, aspect)) / (2 * Math.tan(26 * Math.PI / 360));
  return { center: subject.center, distance, height: subject.height };
}
