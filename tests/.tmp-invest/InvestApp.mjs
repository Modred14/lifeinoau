// components/apps/InvestApp.js: lives inside the phone (see components/Phone.js)
// The market is LIVE: the server's prices arrive every second over the WebSocket (or over plain HTTP if that is down, see lib/marketFeed.js).
// Nothing here decides a price. Orders go to the server, which fills them at ITS price at that instant; this screen only says which price the
// player saw (`seenKobo`) so that an order is refused if the market has moved a lot in between.
"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useRef, useState } from "react";
import { call, naira } from "@/lib/client";
import { compactNumber } from "@/lib/money.js";
import { Icon } from "../Icon";
import { toast } from "@/lib/toast";
import { game, run, cash, canAfford, useResource } from "@/lib/gameStore";
import { useMarket, setMarketRange } from "@/lib/marketClient";
import { valueOf } from "@/lib/market";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";
const RISK = {
    LOW: "var(--ok)",
    MEDIUM: "var(--acc)",
    HIGH: "var(--bad)"
};
const MOOD = {
    BOOM: "invest",
    STEADY: "news",
    SLUMP: "down",
    CRASH: "warn"
};
const RANGES = [
    [
        "5m",
        "5 min"
    ],
    [
        "1h",
        "1 hour"
    ],
    [
        "24h",
        "24 hours"
    ]
];
const LINK = {
    live: [
        "Live",
        "var(--ok)"
    ],
    polling: [
        "Live (backup link)",
        "var(--acc)"
    ],
    connecting: [
        "Connecting…",
        "var(--mut)"
    ],
    offline: [
        "Reconnecting…",
        "var(--bad)"
    ]
};
/** A price in naira with kobo: unit prices are small (a few naira), so whole naira would hide most of the movement. */ const px = (kobo)=>"₦" + (Number(kobo) / 100).toLocaleString("en-NG", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
const pct = (x)=>(x >= 0 ? "+" : "") + x.toFixed(2) + "%";
const signed = (kobo)=>(BigInt(kobo) >= 0n ? "+" : "-") + naira((BigInt(kobo) < 0n ? -BigInt(kobo) : BigInt(kobo)).toString());
const tone = (kobo)=>BigInt(kobo) >= 0n ? "ok" : "bad";
function Chart({ values, label }) {
    if (!values || values.length < 2) return /*#__PURE__*/ _jsx("div", {
        className: "mut",
        style: {
            height: 84,
            display: "grid",
            placeItems: "center"
        },
        children: "Loading chart…"
    });
    const w = 300, h = 84, lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1, y = (v)=>h - 4 - (v - lo) / span * (h - 10);
    const pts = values.map((v, i)=>`${(i / (values.length - 1) * w).toFixed(1)},${y(v).toFixed(1)}`), up = values[values.length - 1] >= values[0], c = up ? "var(--ok)" : "var(--bad)";
    return /*#__PURE__*/ _jsxs("svg", {
        viewBox: `0 0 ${w} ${h}`,
        width: "100%",
        height: h,
        preserveAspectRatio: "none",
        role: "img",
        "aria-label": label,
        style: {
            display: "block"
        },
        children: [
            /*#__PURE__*/ _jsx("line", {
                x1: "0",
                x2: w,
                y1: y(values[0]),
                y2: y(values[0]),
                stroke: "var(--mut)",
                strokeOpacity: ".35",
                strokeDasharray: "3 4"
            }),
            /*#__PURE__*/ _jsx("polygon", {
                points: `0,${h} ${pts.join(" ")} ${w},${h}`,
                fill: c,
                fillOpacity: ".12"
            }),
            /*#__PURE__*/ _jsx("polyline", {
                points: pts.join(" "),
                fill: "none",
                stroke: c,
                strokeWidth: "2",
                strokeLinejoin: "round",
                vectorEffect: "non-scaling-stroke"
            })
        ]
    });
}
export default function Invest() {
    // Kept between visits: reopening is instant and refreshes quietly.
    const { d, store, load, loadFailed, router } = useResource("/api/invest");
    const m = useMarket();
    const [amt, setAmt] = useState({});
    const lastDir = useRef({}), lastPrice = useRef({}); // which way each price last moved (the arrow next to it)
    const NGN = (k)=>compactNumber(k / 100n);
    function go(body, seenKobo) {
        const P = d.products.find((p)=>p.key === body.product), fee = BigInt(d.feePercent);
        let effects = [], after;
        if (body.action === "buy") {
            const amount = BigInt(body.amountNaira) * 100n, f = amount * fee / 100n;
            if (!canAfford(amount + f)) return toast.error("You cannot afford that (the 1% fee is added on top).");
            effects = [
                {
                    store: game,
                    patch: cash(-(amount + f))
                }
            ]; // the cost of a buy never depends on the price, so it shows at once (undone if refused)
        }
        // The server's answer is the truth: its portfolio replaces ours, and a sale's cash is added once the real price is known.
        after = (res)=>[
                {
                    store,
                    patch: (x)=>({
                            ...x,
                            holdings: res.portfolio.holdings,
                            totals: res.portfolio.totals,
                            investedKobo: res.portfolio.totals.valueKobo
                        })
                },
                body.action === "sell" && res.netKobo && BigInt(res.netKobo) > 0n && {
                    store: game,
                    patch: cash(res.netKobo)
                }
            ].filter(Boolean);
        return run({
            key: `invest:${body.action}:${body.product}`,
            router,
            sensitive: true,
            pending: body.action === "buy" ? `Buying ${P.name}…` : `Selling ${P.name}…`,
            okLate: (res)=>res.note,
            request: ()=>call("/api/invest", {
                    ...body,
                    seenKobo,
                    requestId: crypto.randomUUID()
                }),
            effects,
            after
        });
    }
    if (!d) return loadFailed ? /*#__PURE__*/ _jsx(LoadError, {
        onRetry: load
    }) : /*#__PURE__*/ _jsx(Loader, {
        label: "Loading markets"
    });
    // ---- everything below is priced with the LIVE price (the page's first answer, until the first tick arrives) ----
    const price = (k)=>BigInt(m.prices[k] ?? d.products.find((p)=>p.key === k)?.priceKobo ?? 0);
    for (const p of d.products){
        const now = Number(price(p.key)), was = lastPrice.current[p.key];
        if (was !== undefined && now !== was) lastDir.current[p.key] = now > was ? "up" : "down";
        lastPrice.current[p.key] = now;
    }
    const rows = d.holdings.map((h)=>{
        const P = d.products.find((p)=>p.key === h.product), v = valueOf(BigInt(h.unitsMicro), price(h.product)), cost = BigInt(h.costKobo), pnl = v - cost;
        return {
            ...h,
            value: v,
            cost,
            pnl,
            pnlPct: cost > 0n ? Number(pnl * 10000n / cost) / 100 : 0,
            locked: Math.max(0, h.lastBuyWeek + P.lock - d.week)
        };
    });
    const value = rows.reduce((t, r)=>t + r.value, 0n), cost = rows.reduce((t, r)=>t + r.cost, 0n), unreal = value - cost;
    const realised = BigInt(d.totals.realisedKobo), fees = BigInt(d.totals.feesKobo), total = unreal + realised - fees;
    const room = BigInt(d.capKobo) - value, held = Object.fromEntries(rows.map((r)=>[
            r.product,
            r
        ]));
    const [linkText, linkColor] = LINK[m.link] ?? LINK.connecting, mood = m.mood ?? d.news;
    return /*#__PURE__*/ _jsxs(_Fragment, {
        children: [
            /*#__PURE__*/ _jsxs("div", {
                className: "top",
                children: [
                    /*#__PURE__*/ _jsx("h2", {
                        children: "Invest"
                    }),
                    /*#__PURE__*/ _jsxs("span", {
                        className: "mut",
                        style: {
                            color: linkColor
                        },
                        role: "status",
                        "aria-live": "polite",
                        children: [
                            "● ",
                            linkText
                        ]
                    }),
                    /*#__PURE__*/ _jsx("a", {
                        href: "/home",
                        children: /*#__PURE__*/ _jsx("button", {
                            children: "Back to game"
                        })
                    })
                ]
            }),
            /*#__PURE__*/ _jsxs("div", {
                className: "card",
                children: [
                    /*#__PURE__*/ _jsxs("b", {
                        children: [
                            /*#__PURE__*/ _jsx(Icon, {
                                name: MOOD[mood?.regime] ?? "news",
                                size: 18
                            }),
                            " ",
                            mood?.headline ?? "The market is open"
                        ]
                    }),
                    /*#__PURE__*/ _jsxs("p", {
                        className: "mut",
                        children: [
                            "The market is open all the time. Prices move every second, up and down, and nothing is guaranteed: some products can double in minutes and lose half just as fast. Invested ",
                            naira(value.toString()),
                            " of your ",
                            naira(d.capKobo),
                            " limit (",
                            naira(room > 0n ? room.toString() : "0"),
                            " left). Fee ",
                            d.feePercent,
                            "% on every buy and sell. Selling inside a lock period costs ",
                            d.earlyPenaltyPercent,
                            "% extra."
                        ]
                    })
                ]
            }),
            /*#__PURE__*/ _jsxs("div", {
                className: "card",
                "aria-label": "Your portfolio",
                children: [
                    /*#__PURE__*/ _jsx("b", {
                        children: "Your portfolio"
                    }),
                    /*#__PURE__*/ _jsxs("div", {
                        className: "top",
                        children: [
                            /*#__PURE__*/ _jsx("span", {
                                children: "Value now"
                            }),
                            /*#__PURE__*/ _jsx("b", {
                                className: "cash",
                                children: naira(value.toString())
                            })
                        ]
                    }),
                    /*#__PURE__*/ _jsxs("div", {
                        className: "top",
                        children: [
                            /*#__PURE__*/ _jsx("span", {
                                className: "mut",
                                children: "Money in (cost)"
                            }),
                            /*#__PURE__*/ _jsx("span", {
                                children: naira(cost.toString())
                            })
                        ]
                    }),
                    /*#__PURE__*/ _jsxs("div", {
                        className: "top",
                        children: [
                            /*#__PURE__*/ _jsx("span", {
                                className: "mut",
                                children: "Unrealised profit / loss"
                            }),
                            /*#__PURE__*/ _jsx("span", {
                                className: tone(unreal.toString()),
                                children: signed(unreal.toString())
                            })
                        ]
                    }),
                    /*#__PURE__*/ _jsxs("div", {
                        className: "top",
                        children: [
                            /*#__PURE__*/ _jsx("span", {
                                className: "mut",
                                children: "Realised profit / loss"
                            }),
                            /*#__PURE__*/ _jsx("span", {
                                className: tone(realised.toString()),
                                children: signed(realised.toString())
                            })
                        ]
                    }),
                    /*#__PURE__*/ _jsxs("div", {
                        className: "top",
                        children: [
                            /*#__PURE__*/ _jsx("span", {
                                className: "mut",
                                children: "Fees and penalties paid"
                            }),
                            /*#__PURE__*/ _jsx("span", {
                                children: naira(fees.toString())
                            })
                        ]
                    }),
                    /*#__PURE__*/ _jsxs("div", {
                        className: "top",
                        children: [
                            /*#__PURE__*/ _jsx("span", {
                                children: /*#__PURE__*/ _jsx("b", {
                                    children: "Total after fees"
                                })
                            }),
                            /*#__PURE__*/ _jsx("b", {
                                className: tone(total.toString()),
                                children: signed(total.toString())
                            })
                        ]
                    })
                ]
            }),
            rows.length > 0 && /*#__PURE__*/ _jsxs("div", {
                className: "card",
                children: [
                    /*#__PURE__*/ _jsx("b", {
                        children: "Your investments"
                    }),
                    rows.map((h)=>/*#__PURE__*/ _jsxs("div", {
                            className: "led",
                            style: {
                                display: "block"
                            },
                            children: [
                                /*#__PURE__*/ _jsxs("div", {
                                    className: "top",
                                    children: [
                                        /*#__PURE__*/ _jsx("span", {
                                            children: /*#__PURE__*/ _jsx("b", {
                                                children: h.name
                                            })
                                        }),
                                        /*#__PURE__*/ _jsx("b", {
                                            children: naira(h.value.toString())
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("p", {
                                    className: "mut",
                                    children: [
                                        "Paid ",
                                        naira(h.cost.toString()),
                                        " ·",
                                        " ",
                                        /*#__PURE__*/ _jsxs("span", {
                                            className: tone(h.pnl.toString()),
                                            children: [
                                                signed(h.pnl.toString()),
                                                " (",
                                                pct(h.pnlPct),
                                                ")"
                                            ]
                                        }),
                                        h.locked > 0 && ` · locked ${h.locked} more week(s): selling now costs ${d.earlyPenaltyPercent}% extra`
                                    ]
                                }),
                                /*#__PURE__*/ _jsx("div", {
                                    className: "row",
                                    children: [
                                        25,
                                        50,
                                        100
                                    ].map((p)=>/*#__PURE__*/ _jsxs("button", {
                                            onClick: ()=>go({
                                                    action: "sell",
                                                    product: h.product,
                                                    percent: p
                                                }, Number(price(h.product))),
                                            children: [
                                                "Sell ",
                                                p === 100 ? "all" : p + "%"
                                            ]
                                        }, p))
                                })
                            ]
                        }, h.product))
                ]
            }),
            /*#__PURE__*/ _jsx("div", {
                className: "row",
                role: "tablist",
                "aria-label": "Chart range",
                style: {
                    margin: "8px 0"
                },
                children: RANGES.map(([key, name])=>/*#__PURE__*/ _jsx("button", {
                        role: "tab",
                        "aria-selected": m.range === key,
                        className: m.range === key ? "go" : "",
                        onClick: ()=>setMarketRange(key),
                        children: name
                    }, key))
            }),
            d.products.map((p)=>{
                const c = m.changes[p.key] ?? p.changes, cur = price(p.key), dir = lastDir.current[p.key];
                const s = m.series[p.key], values = s ? [
                    ...s.values,
                    ...m.range === "5m" ? [] : [
                        Number(cur)
                    ]
                ] : null;
                const n = Number(amt[p.key] ?? 0), payEach = n + Math.floor(n * d.feePercent / 100), units = n >= 1000 && cur > 0n ? Number(BigInt(n) * 100n * 1000000n / cur) / 1e6 : 0;
                return /*#__PURE__*/ _jsxs("div", {
                    className: "card",
                    children: [
                        /*#__PURE__*/ _jsxs("div", {
                            className: "top",
                            children: [
                                /*#__PURE__*/ _jsx("h2", {
                                    children: p.name
                                }),
                                /*#__PURE__*/ _jsx("span", {
                                    className: "msg",
                                    style: {
                                        margin: 0,
                                        padding: "2px 10px",
                                        color: RISK[p.risk],
                                        borderColor: RISK[p.risk]
                                    },
                                    children: p.risk
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsxs("p", {
                            className: "mut",
                            children: [
                                p.blurb,
                                p.lock > 0 && ` Locked ${p.lock} week(s) after each buy.`
                            ]
                        }),
                        /*#__PURE__*/ _jsx("div", {
                            className: "top",
                            children: /*#__PURE__*/ _jsxs("span", {
                                className: "cash",
                                "aria-live": "off",
                                children: [
                                    px(cur),
                                    /*#__PURE__*/ _jsx("span", {
                                        className: "mut",
                                        children: " / unit "
                                    }),
                                    /*#__PURE__*/ _jsx("span", {
                                        className: dir === "up" ? "ok" : dir === "down" ? "bad" : "mut",
                                        "aria-hidden": "true",
                                        children: dir === "up" ? "▲" : dir === "down" ? "▼" : ""
                                    })
                                ]
                            })
                        }),
                        /*#__PURE__*/ _jsx(Chart, {
                            values: values,
                            label: `${p.name} price, last ${RANGES.find((r)=>r[0] === m.range)?.[1]}`
                        }),
                        /*#__PURE__*/ _jsxs("p", {
                            children: [
                                [
                                    [
                                        "5 min",
                                        c.m5
                                    ],
                                    [
                                        "1 hour",
                                        c.h1
                                    ],
                                    [
                                        "24 hours",
                                        c.d1
                                    ]
                                ].map(([name, v])=>/*#__PURE__*/ _jsxs("span", {
                                        className: v >= 0 ? "ok" : "bad",
                                        style: {
                                            marginRight: 12
                                        },
                                        children: [
                                            name,
                                            " ",
                                            pct(v)
                                        ]
                                    }, name)),
                                held[p.key] && /*#__PURE__*/ _jsxs("span", {
                                    className: "mut",
                                    children: [
                                        " · you hold ",
                                        naira(held[p.key].value.toString())
                                    ]
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsxs("div", {
                            className: "row",
                            children: [
                                /*#__PURE__*/ _jsx("input", {
                                    type: "text",
                                    inputMode: "numeric",
                                    placeholder: "Amount in naira",
                                    "aria-label": `Amount to invest in ${p.name}`,
                                    value: amt[p.key] ?? "",
                                    onChange: (e)=>setAmt({
                                            ...amt,
                                            [p.key]: e.target.value.replace(/\D/g, "")
                                        })
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    className: "go",
                                    disabled: n < 1000,
                                    onClick: ()=>{
                                        setAmt({
                                            ...amt,
                                            [p.key]: ""
                                        }); // the box clears at once, like the rest of the screen
                                        go({
                                            action: "buy",
                                            product: p.key,
                                            amountNaira: n
                                        }, Number(cur));
                                    },
                                    children: "Buy"
                                })
                            ]
                        }),
                        n >= 1000 && /*#__PURE__*/ _jsxs("p", {
                            className: "mut",
                            children: [
                                "You pay ₦",
                                payEach.toLocaleString("en-NG"),
                                " including the fee, for about ",
                                units.toLocaleString("en-NG", {
                                    maximumFractionDigits: 4
                                }),
                                " units at the price when the server fills it."
                            ]
                        })
                    ]
                }, p.key);
            })
        ]
    });
}
