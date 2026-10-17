import { useEffect, useRef } from "react";
import { OUTFIT_GROUPS, SKIN_TONES } from "@campuslife/shared/avatar";
import { GameIcon } from "../GameIcon";
import { ItemCard } from "./ItemCard";
import { Swatches } from "./Swatches";
import { outfitImage, partImage, SKIN_NAMES } from "./model";
import type { WardrobeState } from "./useWardrobe";

export function WardrobeOptions({ state, thumbnails }: { state: WardrobeState; thumbnails: Record<string, string> }) {
  const panel = useRef<HTMLDivElement>(null);
  const { look, tab, setTab, group, setGroup, update, chooseOutfit, selectedOutfit, visibleOutfits, options, part } = state;
  useEffect(() => {
    if (panel.current) panel.current.scrollTop = 0;
  }, [tab, group]);

  return (
    <div ref={panel} className="creator-options" id="look-options" role="tabpanel" aria-labelledby={`look-tab-${tab}`} tabIndex={0}>
      {tab === "body" && (
        <>
          <div className="wardrobe-section-title"><h3>Choose your body</h3><span>01 / 06</span></div>
          <div className="wardrobe-body-grid">
            {(["m", "f"] as const).map((body) => (
              <button key={body} className={`wardrobe-body-card${look.body === body ? " selected" : ""}`} aria-pressed={look.body === body} onClick={() => update({ body })}>
                <img src={thumbnails[`body-${body}`] ?? `/campus/wardrobe/parts/${body}-body.webp`} alt="" />
                <span>{body === "m" ? "Masculine" : "Feminine"}</span>
                {look.body === body && <GameIcon name="check" className="wardrobe-check" />}
              </button>
            ))}
          </div>
          <h3>Skin tone <span>{SKIN_NAMES[look.skin]}</span></h3>
          <Swatches colors={SKIN_TONES} names={SKIN_NAMES} value={look.skin} onChange={(skin) => update({ skin })} />
          <button className="wardrobe-next" onClick={() => setTab("outfits")}><GameIcon name="wardrobe" />Choose a student outfit<GameIcon name="arrow" /></button>
        </>
      )}
      {tab === "outfits" && (
        <>
          <div className="wardrobe-section-title"><h3>Student outfits</h3><span>{visibleOutfits.length} looks</span></div>
          <div className="wardrobe-filters" role="group" aria-label="Outfit categories">
            {OUTFIT_GROUPS.map((value) => <button key={value} className={value === group ? "selected" : ""} aria-pressed={value === group} onClick={() => setGroup(value)}>{value}</button>)}
          </div>
          <div className="wardrobe-items wardrobe-outfits">
            {visibleOutfits.map((outfit) => (
              <ItemCard key={outfit.id} label={outfit.label} image={outfitImage(look.body, outfit.id)} selected={selectedOutfit?.id === outfit.id} onClick={() => chooseOutfit(outfit.id)} />
            ))}
          </div>
        </>
      )}
      {part && (
        <>
          <div className="wardrobe-section-title"><h3>{part.title}</h3><span>{options.length} styles</span></div>
          <div className={`wardrobe-items wardrobe-parts wardrobe-parts-${part.slot}`}>
            {options.map((option) => <ItemCard key={option.id} label={option.parts[part.slot]} image={thumbnails[`${look.body}-${part.slot}-${option.id}`] ?? partImage(look.body, part.slot, option.id)} selected={look[part.slot] === option.id} onClick={() => update({ [part.slot]: option.id })} />)}
          </div>
          <h3>{tab === "hair" ? "Hair colour" : "Colour"}<span>{part.names[look[part.color]]}</span></h3>
          <Swatches colors={part.colors} names={part.names} value={look[part.color]} onChange={(color) => update({ [part.color]: color })} />
        </>
      )}
    </div>
  );
}
