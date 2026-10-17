import { GameIcon } from "../GameIcon";

export function ItemCard({ label, image, selected, onClick }: { label: string; image?: string; selected: boolean; onClick: () => void }) {
  return <button className={`wardrobe-item${selected ? " selected" : ""}`} aria-pressed={selected} onClick={onClick}>
    <span className="wardrobe-item-art">{image ? <img src={image} alt="" loading="lazy" /> : <GameIcon name="person" className="studio-card-placeholder" />}</span>
    <span className="wardrobe-item-name">{label}</span>
    {selected && <GameIcon name="check" className="wardrobe-check" />}
  </button>;
}
