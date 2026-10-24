// components/admin/Forbes.js — manage who is eligible for the FORBES OAU board. The ranking rule itself is the game's; administrators control eligibility only.
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { useApi, useDebounced, useQueryState, PageHead, Async, Table, Pager, Search, Seg, Person, Badge, Note, Btn, Stat, Empty, kobo, koboShort, ago, int, act } from "./kit";
import { ForbesForm } from "./Actions";

export default function Forbes() {
  const [f, set] = useQueryState({ view: "board", q: "", sort: "", dir: "", page: 1 }), q = useDebounced(f.q), data = useApi("forbes", { ...f, q }), [form, setForm] = useState(null), [busy, setBusy] = useState(false), router = useRouter();
  const d = data.data;
  async function recalc() { setBusy(true); const r = await act("forbes/recalculate", {}, { pending: "Recalculating…", success: "Recalculated from live data." }); setBusy(false); if (!r.failed) data.reload(); }
  return (
    <>
      <PageHead title="Forbes OAU" sub="Remove players from the board, restore them, and see exactly why anyone is where they are.">
        <Btn tone="pri" busy={busy} onClick={recalc}><ArrowsClockwise size={15} />Recalculate now</Btn>
      </PageHead>
      <Note><b>How it works.</b> {d?.rule ?? "Net worth = cash + business capital + investments."} Removing a player only marks them ineligible: their money, businesses and progress are untouched, and no automatic re-ranking can put them back. Restoring reverses it.</Note>
      <div className="grid g3" style={{ marginBottom: 14 }}><Stat label="Eligible players" value={int(d?.eligibleCount ?? 0)} sub={`top ${d?.boardSize ?? 20} are shown to players`} /><Stat label="Removed by admins" value={int(d?.excludedCount ?? 0)} /><Stat label="Board size" value={int(d?.boardSize ?? 20)} /></div>
      <div className="toolbar">
        <Seg value={f.view} onChange={(v) => set({ view: v })} label="View" options={[["board", "On the board"], ["eligible", "All eligible"], ["excluded", "Removed", d?.excludedCount], ["all", "Everyone"]]} />
        <Search value={f.q} onChange={(v) => set({ q: v })} placeholder="Search by username…" />
      </div>
      <Async q={data} rows={8}>{d && <>
        <Table rows={d.rows} rowKey={(r) => r.characterId} loading={data.loading} sort={f.sort || "rank"} dir={f.dir || "desc"} onSort={(sort, dir) => set({ sort, dir })} onRow={(r) => router.push(`/admin/players/${r.characterId}`)}
          empty={<Empty title={f.view === "excluded" ? "Nobody has been removed" : "No players"}>{f.view === "excluded" ? "Players you remove from Forbes will be listed here, with your reason." : "Nothing matches."}</Empty>}
          columns={[
            { key: "rank", label: "Rank", n: true, sort: "rank", render: (r) => r.excluded ? <span className="mut" title="Where they would rank if restored">(#{r.wouldBe})</span> : <b className="num">#{r.rank}</b> },
            { key: "name", label: "Player", sort: "name", render: (r) => <Person name={r.name} sub={`${r.class} · ${r.faculty}`} /> },
            { key: "nw", label: "Net worth", n: true, render: (r) => <span title={kobo(r.nw)}><b>{koboShort(r.nw)}</b></span> },
            { key: "parts", label: "Cash · Business · Investments", n: true, render: (r) => <span className="mut num" title={`${kobo(r.cash)} · ${kobo(r.biz)} · ${kobo(r.inv)}`}>{koboShort(r.cash)} · {koboShort(r.biz)} · {koboShort(r.inv)}</span> },
            { key: "why", label: "Why they are listed", wrap: true, render: (r) => <span><span className="chips" style={{ marginBottom: 4 }}>{r.onBoard && <Badge tone="ok">On the board</Badge>}{r.excluded && <Badge tone="bad">Removed</Badge>}{r.accountStatus === "DELETED" && <Badge plain>Archived</Badge>}</span><small className="mut" title={r.why}>{r.onBoard ? `${r.why.split(". ")[0]}.` : r.why}</small></span> },
            { key: "act", label: "", render: (r) => r.accountStatus === "DELETED" ? null : <Btn size="sm" tone={r.excluded ? "ok" : "danger"} onClick={(e) => { e.stopPropagation(); setForm({ r, restore: r.excluded }); }}>{r.excluded ? "Restore" : "Remove"}</Btn> },
          ]} />
        <Pager d={d} onPage={(page) => set({ page })} noun="players" />
      </>}</Async>
      {form && <ForbesForm p={{ characterId: form.r.characterId, name: form.r.name }} restore={form.restore} onClose={() => setForm(null)} onDone={() => data.reload()} />}
    </>
  );
}
