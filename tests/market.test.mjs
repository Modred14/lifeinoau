// tests/market.test.mjs
import * as M from "../lib/market.js";
console.log("same week twice identical:",M.price("INDEX",20)===M.price("INDEX",20),"| week 21 differs:",M.price("INDEX",21)!==M.price("INDEX",20));
const p1=M.price("MEME",30);process.env.MARKET_SEED="another-secret";M.clearMarketCache();console.log("different secret -> different market:",M.price("MEME",30)!==p1);delete process.env.MARKET_SEED;M.clearMarketCache();
console.log("units/value round-trip: N50,000 at price N137.42 ->",M.valueOf(M.unitsFor(5_000_000n,13742n),13742n)/100n,"naira back (floor, never more)");
const cnt={BOOM:0,STEADY:0,SLUMP:0,CRASH:0};for(let w=1;w<=20000;w++)cnt[M.marketNews(w).regime]++;console.log("regime mix over 20k weeks:",Object.entries(cnt).map(([k,v])=>k+" "+(v/200).toFixed(0)+"%").join(", "),"(design 15/55/22/8)");
// buy-and-hold over 60 weeks across many independent markets, 1% fee each way
const q=(a,p)=>a[Math.floor(p*(a.length-1))];
for(const key of Object.keys(M.PRODUCTS)){const out=[];for(let s=0;s<2500;s++){process.env.MARKET_SEED="sim"+s;M.clearMarketCache();const buy=M.priceKobo(key,1),sell=M.priceKobo(key,61);const units=M.unitsFor(10_000_000n*99n/100n,buy);out.push(Number(M.valueOf(units,sell)*99n/100n)/10_000_000)}
  out.sort((a,b)=>a-b);const loss=out.filter(x=>x<1).length/out.length,bust=out.filter(x=>x<0.5).length/out.length,ten=out.filter(x=>x>10).length/out.length;
  console.log(`${key.padEnd(6)} ${M.PRODUCTS[key].risk.padEnd(6)} median x${q(out,.5).toFixed(2)} | 10th x${q(out,.1).toFixed(2)} 90th x${q(out,.9).toFixed(2)} | ended below start ${(loss*100).toFixed(0)}% | lost over half ${(bust*100).toFixed(0)}% | mean x${(out.reduce((a,b)=>a+b,0)/out.length).toFixed(2)}`)}
delete process.env.MARKET_SEED;
