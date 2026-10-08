// tools/harness/ui.mjs
import {createRequire} from "node:module"; const require=createRequire("/home/claude/.npm-global/lib/node_modules/");
const {chromium}=require("playwright");
const [scenario,path,out,W="390",H="844",...clicks]=process.argv.slice(2);
const look={skin:"chestnut",hair:"braids",outfit:"owambe",fabric:"ankara",accent:"gold"};
const char={name:"tolu_ife",gender:"F",look,faculty:"Science",class:"MAPO",hostel:"Moremi",personalities:["Extrovert","Party Animal"],level:200,health:82,energy:64,happiness:70,academics:52,popularity:34,suspicion:6,strikes:0,expelled:false,graduated:false};
const J=(o,s=200)=>({status:s,contentType:"application/json",body:JSON.stringify(o)});
const meta={faculties:["College of Health Sciences","Administration","Agriculture","Arts","Computer Science","Education","Environmental Design & Management","Law","Pharmacy","Science","Social Sciences","Technology"].map((name,i)=>({id:i+1,name})),personalities:[],week:12,headline:"Panic selling shakes the market"};
const game={week:12,hostels:null,academics:{cgpa:3.2,standing:"Second Class Upper",weeksLeftInSession:5,nextExamWeek:18,satThisWeek:false,recent:[]},floorZero:null,notifications:[{id:"1",kind:"ACHIEVEMENT",body:"Achievement unlocked: First Million"}],character:char,balanceKobo:"1245000000",calledThisWeek:false};
const courses={week:12,level:200,faculty:"Science",energy:64,weeksElapsed:7,sessionWeeks:12,nextExamWeek:18,examToday:false,costs:{attend:12,study:15},courses:[["MTH 201","Mathematics II","Boroks","Feared",1.5],["PHY 202","Physics II","Dr. Gist","Popular",1.0],["CHM 203","Chemistry II","Madam Red Pen","Fair but firm",1.2],["BIO 204","Biology II","Dr. Soft Landing","Loved",0.8]].map(([code,title,n,rep,d],i)=>({code,title,slot:"Tue 10AM",difficulty:d,lecturer:{name:n,personality:"Loud, strict, and proud of how many people fail",style:"Races through the board and erases before you can copy",reputation:rep},attended:5-i,prep:60-i*15,attendancePct:90-i*12,attendedThisWeek:i===0,studiedThisWeek:false}))};
const routes={"/api/meta":()=>J(meta),"/api/state":()=>scenario==="game"?J(game):J({error:"Create a character first."},404),"/api/courses":()=>J(courses)};
const b=await chromium.launch({args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--no-sandbox"]});
const ctx=await b.newContext({viewport:{width:+W,height:+H},deviceScaleFactor:1,reducedMotion:"no-preference"}); const p=await ctx.newPage(); const logs=[];
p.on("console",m=>{if(["error","warning"].includes(m.type()))logs.push(m.type()+": "+m.text().slice(0,160))}); p.on("pageerror",e=>logs.push("PAGEERROR: "+e.message.slice(0,200)));
await p.route("**/api/**",r=>{const u=new URL(r.request().url());const h=routes[u.pathname];r.fulfill(h?h():J({error:"mock"},404))});
await p.goto("http://localhost:3100"+path,{waitUntil:"domcontentloaded",timeout:120000}); await p.waitForTimeout(4500);
for(const c of clicks){ try{ if(c.startsWith("wait:")) await p.waitForTimeout(+c.slice(5)); else if(c.startsWith("fill:")){const i=c.indexOf("::");await p.fill(c.slice(5,i),c.slice(i+2))} else await p.click(c,{timeout:4000}); await p.waitForTimeout(900);}catch(e){logs.push("CLICKFAIL "+c)} }
await p.screenshot({path:out}); console.log("saved",out,"| issues:",logs.filter(l=>!/Download the React DevTools|favicon|Failed to load resource.*(404|401)/.test(l)).slice(0,8)); await b.close();
