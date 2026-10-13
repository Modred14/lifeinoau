// components/BuySheet.js
"use client";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
import { CATEGORIES, ITEMS, ITEM_KEYS, inShop } from "@/lib/furniture.js";
import { fmtN } from "@/lib/classes.js";

/** Picture of a piece of furniture, rendered once by the 3D engine. Shows a soft placeholder until it is ready. */
function Thumb({ k }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const { thumbnail } = await import("../lib3d/thumbs.js");
        await new Promise((r) => setTimeout(r, 0));
        if (on) setSrc(thumbnail(k));
      } catch {
        /* no WebGL: the card still works without a picture */
      }
    })();
    return () => {
      on = false;
    };
  }, [k]);
  return (
    <span className="bs-thumb" data-ready={src ? "1" : "0"}>
      {src ? (
        <img src={src} alt="" width={120} height={120} draggable={false} />
      ) : (
        <Icon name="cube" size={30} />
      )}
    </span>
  );
}

/** The catalogue that slides up in Buy mode: categories, then cards you can buy, and your storage (things you own that are not in the room). */
export default function BuySheet({
  items,
  balanceKobo,
  busy,
  onBuy,
  onPlace,
  collapsed,
  onToggle,
}) {
  const stored = items.filter((i) => !i.placed),
    [cat, setCat] = useState("sleep"),
    owned = useMemo(() => {
      const m = {};
      for (const i of items) m[i.key] = (m[i.key] ?? 0) + 1;
      return m;
    }, [items]);
  const tab = cat === "storage" && !stored.length ? "sleep" : cat;
  const bal = BigInt(balanceKobo ?? "0") / 100n,
    list =
      tab === "storage"
        ? []
        : ITEM_KEYS.filter((k) => inShop(k) && ITEMS[k].cat === tab).sort(
            (a, b) => ITEMS[a].price - ITEMS[b].price,
          );
  return (
    <section
      className="bs"
      data-collapsed={collapsed ? "1" : "0"}
      aria-label="Furniture shop"
    >
      <header className="bs-head">
        <div className="bs-title">
          <h2>Catalogue</h2>
          <span className="bs-bal num">Wallet {fmtN(bal)}</span>
        </div>
        <div className="bs-tabs" role="tablist" aria-label="Categories">
          {stored.length > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === "storage"}
              className={tab === "storage" ? "on" : ""}
              onClick={() => setCat("storage")}
            >
              <Icon name="box" size={18} />
              Storage <i>{stored.length}</i>
            </button>
          )}
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={tab === c.id}
              className={tab === c.id ? "on" : ""}
              onClick={() => setCat(c.id)}
            >
              <Icon name={c.icon} size={18} />
              {c.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="bs-hide"
          onClick={onToggle}
          aria-expanded={!collapsed}
        >
          <Icon name={collapsed ? "up" : "down"} size={18} />
          {collapsed ? "Show" : "Hide"}
        </button>
      </header>
      {!collapsed && (
        <div className="bs-row" role="tabpanel">
          {tab === "storage" &&
            stored.map((it) => (
              <article key={it.id} className="bs-card">
                <Thumb k={it.key} />
                <b>{ITEMS[it.key].name}</b>
                <span className="mut bs-sub">
                  In storage. Putting it back is free.
                </span>
                <button
                  type="button"
                  className="go"
                  disabled={busy}
                  onClick={() => onPlace(it.id)}
                >
                  Place in room
                </button>
              </article>
            ))}
          {list.map((k) => {
            const d = ITEMS[k],
              can = bal >= BigInt(d.price),
              need = BigInt(d.price) - bal;
            return (
              <article key={k} className="bs-card" data-poor={can ? "0" : "1"}>
                {owned[k] > 0 && (
                  <span className="bs-own">Owned {owned[k]}</span>
                )}
                <Thumb k={k} />
                <b>{d.name}</b>
                <span className="mut bs-sub">{d.blurb}</span>
                <div className="bs-meta">
                  <span className="bs-score" title="Adds to your room score">
                    <Icon name="sparkle" size={14} />+{d.score}
                  </span>
                  <span className="bs-size">
                    {d.w}×{d.d}
                  </span>
                </div>
                <button
                  type="button"
                  className="go bs-buy"
                  disabled={busy || !can}
                  onClick={() => onBuy(k)}
                >
                  {can ? (
                    <>
                      Buy <b className="num">{fmtN(d.price)}</b>
                    </>
                  ) : (
                    <>
                      Need <b className="num">{fmtN(need)}</b> more
                    </>
                  )}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}