export interface UnionTab<T extends string> {
  id: T;
  label: string;
}

export function UnionTabs<T extends string>({ tabs, active, label, onPick }: { tabs: readonly UnionTab<T>[]; active: T; label: string; onPick: (id: T) => void }) {
  return (
    <div className="un-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button key={tab.id} type="button" role="tab" aria-selected={tab.id === active} className={tab.id === active ? "ph-btn" : "ph-btn ph-btn-quiet"} onClick={() => onPick(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}
