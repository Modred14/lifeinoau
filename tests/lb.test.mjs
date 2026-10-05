// tests/lb.test.mjs
import {getBoard,rankRows,clearBoardCache,BOARDS} from "../lib/leaderboards.js";
let calls=0; const ch=(n,c)=>({name:n,class:c,graduated:false,faculty:{name:"Science"}});
const row=(n,c,cash,biz)=>({name:n,class:c,graduated:false,faculty:"Science",nw:cash+biz,cash,biz,inv:0n});
const db={$queryRaw:async()=>{calls++;return[row("Tunde","NEPO",840000000n,0n),row("Ada","MAPO",310000000n,300000000n),row("Chi","LAPO",610000000n,0n),row("Femi","MAPO",5000n,0n)]}};
console.log("ranks with ties:",rankRows([{value:"9"},{value:"5"},{value:"5"},{value:"1"}]).map(r=>r.rank).join(","));
const t0=1_000_000; let b=await getBoard(db,"forbes",t0);
console.log("forbes:",b.rows.map(r=>`${r.rank}.${r.name}=N${(BigInt(r.value)/100n).toLocaleString()}`).join(" | "));
await getBoard(db,"forbes",t0+30_000); console.log("30s later: db calls =",calls,"(cached)");
await getBoard(db,"forbes",t0+61_000); console.log("61s later: db calls =",calls,"(refreshed)");
console.log('forbes breakdown for Ada:',JSON.stringify({cash:b.rows[1].cash,business:b.rows[1].business}));
console.log("unknown board:",await getBoard(db,"nope"));
