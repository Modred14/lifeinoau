// tests/biz.test.mjs
import {TYPES,weekly,settle,upgradeCost,reserveFor,maxBusinesses,MAX_LEVEL} from "../lib/business.js";
import {JOBS,jobLevel,resolveShift,canTake} from "../lib/jobs.js";
import {randomInt} from "node:crypto"; const roll=(a,b)=>randomInt(a,b+1);
const naira=(k)=>Number(k/100n);
function life(type,policy,weeks=60){
  let b={type,level:1,employees:0,reputation:50,capital:BigInt(TYPES[type].cost)*100n,status:"ACTIVE"},cash=0n;
  const keep=BigInt(Math.round(TYPES[type].cost*(policy.keep??0.2)))*100n;
  for(let w=0;w<weeks&&b.status==="ACTIVE";w++){
    if(policy.hire>b.employees&&b.employees<8)b.employees++;
    const s=settle(b,weekly(b,roll));b.capital=s.capital;b.reputation=s.reputation;
    if(s.bankrupt){b.status="CLOSED";break}
    if(policy.upgrade&&b.level<5){const uc=upgradeCost(type,b.level);if(b.capital>=uc+keep){b.capital-=uc;b.level++}continue} // save up, do not withdraw
    if(b.capital>keep){cash+=b.capital-keep;b.capital=keep}
  }
  return {value:cash+(b.status==="ACTIVE"?b.capital:0n),bankrupt:b.status!=="ACTIVE",level:b.level};
}
const run=(lbl,type,policy)=>{const n=4000,v=[];let bk=0,lv=0;for(let i=0;i<n;i++){const r=life(type,policy);v.push(naira(r.value));bk+=r.bankrupt;lv+=r.level}v.sort((a,b)=>a-b);
  console.log(lbl.padEnd(46),"median N"+Math.round(v[n/2]).toLocaleString().padStart(11),"| 10th-90th N"+Math.round(v[n*.1]).toLocaleString()+" - N"+Math.round(v[n*.9]).toLocaleString(),"| bankrupt",(bk/n*100).toFixed(0)+"%","| avg level",(lv/n).toFixed(1))};
console.log("Final value (cash withdrawn + capital) after 60 game weeks, starting capital = purchase price:");
run("Food, 4 staff, withdraw (thin buffer)","FOOD",{hire:4,upgrade:false});
run("Food, 4 staff, save and upgrade","FOOD",{hire:4,upgrade:true});
run("Food, 8 staff, save and upgrade","FOOD",{hire:8,upgrade:true});
run("Tech, 4 staff, thin buffer (greedy)","TECH",{hire:4,upgrade:false});
run("Tech, 4 staff, buffer = 1x price (careful)","TECH",{hire:4,upgrade:false,keep:1.0});
run("Tech, 4 staff, upgrade, buffer 1x","TECH",{hire:4,upgrade:true,keep:1.0});
run("Events, 8 staff, thin buffer (greedy)","EVENTS",{hire:8,upgrade:false});
run("Events, 4 staff, buffer = 1x price (careful)","EVENTS",{hire:4,upgrade:false,keep:1.0});
run("POS (steady), no staff","POS",{hire:0,upgrade:false});
console.log("honest MAPO allowance over 60 weeks for comparison: ~N5,880,000 net of rent");
const f=weekly({type:"FOOD",level:1,employees:0,reputation:50},roll);console.log("sample FOOD week: revenue",naira(f.revenue),"expenses",naira(f.expenses),"net",naira(f.net),f.event??"");
console.log("settle loss bigger than capital -> bankrupt:",settle({capital:1000n,reputation:50},{net:-5000n}).bankrupt,"| ledger loss capped at capital:",settle({capital:1000n,reputation:50},{net:-5000n}).ledger.amount);
console.log("limits: level 100/200/500 allow",[100,200,500].map(maxBusinesses).join("/"),"businesses | upgrade FOOD 1->2 costs N"+naira(upgradeCost("FOOD",1)),"| max level",MAX_LEVEL);
// jobs
const c={energy:80,popularity:10};
console.log("\nvendor level0 vs level10 avg pay:",[0,50].map(xp=>{let s=0;for(let i=0;i<5000;i++)s+=naira(resolveShift(c,JOBS.vendor,xp,roll).payKobo);return "N"+Math.round(s/5000).toLocaleString()}).join(" vs "));
console.log("job levels: 4 shifts",jobLevel(4),"| 5",jobLevel(5),"| 500",jobLevel(500),"(cap 10)");
console.log("gates: tech_bro at 200L",canTake(JOBS.tech_bro,200,"Computer Science"),"| at 300L Law:",canTake(JOBS.tech_bro,300,"Law"),"| at 300L CS:",canTake(JOBS.tech_bro,300,"Computer Science"));
const weekPay=(xp)=>{let s=0;for(let i=0;i<4000;i++){let e=100,t=0;for(let k=0;k<5;k++){const r=resolveShift({energy:e,popularity:0},JOBS.barber,xp,roll);if(r.error)break;e=r.stats.energy;t+=naira(r.payKobo)}s+=t}return Math.round(s/4000)};
console.log("barber, 5 shifts/week at job level 0 / 10: N"+weekPay(0).toLocaleString(),"/ N"+weekPay(50).toLocaleString(),"(energy allows",Math.floor(100/JOBS.barber.energy),"shifts from 100)");
