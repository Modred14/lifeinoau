import { GameIcon } from "../GameIcon";
import { WARDROBE_TABS, type WardrobeTab } from "./model";

export function WardrobeTabs({ value, onChange }: { value: WardrobeTab; onChange: (tab: WardrobeTab) => void }) {
  return (
    <div className="tabs wardrobe-tabs" role="tablist" aria-label="Customize your student">
      {WARDROBE_TABS.map((tab, index) => (
        <button
          key={tab.id}
          id={`look-tab-${tab.id}`}
          role="tab"
          aria-selected={value === tab.id}
          aria-controls="look-options"
          tabIndex={value === tab.id ? 0 : -1}
          className={value === tab.id ? "tab active" : "tab"}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            const next = event.key === "ArrowRight" ? (index + 1) % WARDROBE_TABS.length : event.key === "ArrowLeft" ? (index + WARDROBE_TABS.length - 1) % WARDROBE_TABS.length : event.key === "Home" ? 0 : event.key === "End" ? WARDROBE_TABS.length - 1 : -1;
            if (next < 0) return;
            event.preventDefault();
            const target = WARDROBE_TABS[next].id;
            onChange(target);
            document.getElementById(`look-tab-${target}`)?.focus();
          }}
        >
          <GameIcon name={tab.icon} />{tab.label}
        </button>
      ))}
    </div>
  );
}
