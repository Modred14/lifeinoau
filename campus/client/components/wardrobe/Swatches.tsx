import { GameIcon } from "../GameIcon";

const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;
const lightSwatch = (color: number) => {
  const channels = [color >> 16, (color >> 8) & 255, color & 255].map((value) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 > 0.179;
};

export function Swatches({ colors, names, value, onChange }: { colors: readonly number[]; names: readonly string[]; value: number; onChange: (index: number) => void }) {
  return (
    <div className="swatches wardrobe-swatches" role="group" aria-label="Colour choices">
      {colors.map((color, index) => (
        <button key={color} className={index === value ? "swatch active" : "swatch"} style={{ background: hex(color) }} onClick={() => onChange(index)} aria-label={names[index]} title={names[index]} aria-pressed={index === value}>
          {index === value && <GameIcon name="check" style={{ color: lightSwatch(color) ? "#20291d" : "#f4f2df" }} />}
        </button>
      ))}
    </div>
  );
}
