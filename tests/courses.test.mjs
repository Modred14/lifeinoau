// tests/courses.test.mjs
import {coursesFor,LECTURERS,hasBoroks,FACULTIES_WITH_COURSES} from "../lib/curriculum.js";
import {resolveCourseAction,resolveCourseExam,surpriseTest,attendanceRate} from "../lib/courses.js";
import {getCourses,courseAction} from "../lib/courseService.js";
import {doAction,sitExam} from "../lib/gameService.js";
import {randomInt} from "node:crypto"; const roll=(a,b)=>randomInt(a,b+1);
// ---------- curriculum ----------
const sci=["Science","Technology","Computer Science","Pharmacy","Agriculture"], non=FACULTIES_WITH_COURSES.filter(f=>!sci.includes(f));
console.log("faculties with courses:",FACULTIES_WITH_COURSES.length,"| each has 4 courses with unique codes:",FACULTIES_WITH_COURSES.every(f=>{const c=coursesFor(f,100,1);return c.length===4&&new Set(c.map(x=>x.code)).size===4}));
console.log("Boroks teaches Mathematics in:",sci.filter(f=>coursesFor(f,100,1).some(x=>x.lecturerKey==="BOROKS"&&x.subject==="Mathematics")).join(", "));
console.log("Boroks appears nowhere else:",non.every(f=>coursesFor(f,100,1).every(x=>x.lecturerKey!=="BOROKS")),"| Boroks is the toughest lecturer:",Math.max(...Object.values(LECTURERS).map(l=>l.difficulty))===LECTURERS.BOROKS.difficulty);
console.log("level 200 codes:",coursesFor("Law",200,1).map(x=>x.code).join(", "),"| deterministic:",JSON.stringify(coursesFor("Arts",300,0.8))===JSON.stringify(coursesFor("Arts",300,0.8)));
console.log("harder faculty raises difficulty:",coursesFor("Science",100,1.3)[0].difficulty,">",coursesFor("Science",100,0.8)[0].difficulty);
// ---------- actions ----------
const c0={energy:60,academics:50,luck:50,happiness:60,popularity:10,suspicion:0};
let p=resolveCourseAction(c0,"attend",null,5).progress; console.log("attend: attended",p.attended,"prep",p.prep,"| again same week:",resolveCourseAction(c0,"attend",p,5).error,"| next week ok:",!resolveCourseAction(c0,"attend",p,6).error);
let q=resolveCourseAction(c0,"study",null,5).progress; console.log("study: prep",q.prep,"| twice same week:",resolveCourseAction(c0,"study",q,5).error);
let big={...q,prep:95,lastStudyWeek:4};console.log("prep capped at 100:",resolveCourseAction(c0,"study",big,5).progress.prep,"| tired:",resolveCourseAction({...c0,energy:5},"attend",null,5).error,"| ability unchanged by effort:",resolveCourseAction(c0,"study",null,5).stats.academics===undefined);
// ---------- effort decides exam results ----------
const courses=coursesFor("Science",100,1.1),mean=(att,prep,n=3000)=>{const prog=Object.fromEntries(courses.map(x=>[x.code,{attended:att,prep}]));let t=0;for(let i=0;i<n;i++)t+=resolveCourseExam({...c0,energy:80},courses,prog,6,false,roll).score;return t/n};
console.log("average exam score at week 6 (academics 50):",[["no effort",0,0],["light",3,20],["balanced",5,45],["full",6,70]].map(([l,a,pr])=>`${l} ${mean(a,pr).toFixed(0)}`).join(" | "));
const cheat=(n=3000)=>{let caught=0,t=0;const prog=Object.fromEntries(courses.map(x=>[x.code,{attended:4,prep:40}]));for(let i=0;i<n;i++){const r=resolveCourseExam({...c0,energy:80},courses,prog,6,true,roll);caught+=r.caught;t+=r.score}return{caught:(caught/n*100).toFixed(0)+"%",avg:(t/n).toFixed(0)}};console.log("cheating (suspicion 0): caught",cheat().caught,"| average score",cheat().avg);
const st=(att,prep)=>{let t=0;for(let i=0;i<4000;i++){const r=surpriseTest(c0,courses[0],{attended:att,prep},6,roll);if(r.score<0||r.score>20)throw new Error("out of range");t+=r.score}return (t/4000).toFixed(1)};
console.log("surprise test /20 with Boroks: unprepared",st(0,0),"| prepared",st(6,70));
// ---------- service against a fake database ----------
const week=6,C={id:"c1",userId:"u1",hostel:"Awo",expelled:false,graduated:false,suspendedUntilWeek:0,jailedUntil:null,level:100,joinedWeek:1,sessionStartWeek:1,lastTickWeek:week,personalities:[],energy:100,happiness:50,popularity:10,suspicion:0,health:80,academics:50,luck:50,strikes:0,faculty:{name:"Science",difficulty:1.1},account:{id:"p",kind:"PLAYER",balance:0n}};
const PR=[],AL=[],ER=[];let id=1n;
const tx={$queryRaw:async()=>[],gameClock:{findUnique:async()=>({startedAt:new Date(Date.now()-(week-1)*864e5-1000)})},
 character:{findUnique:async()=>({...C}),update:async({data})=>Object.assign(C,data)},
 actionLog:{create:async({data})=>{if(AL.find(a=>a.requestId==data.requestId)){const e=new Error("dup");e.code="P2002";throw e}AL.push(data)}},
 courseProgress:{findMany:async()=>PR,findFirst:async({where})=>PR.find(r=>r.code==where.code&&r.sessionStartWeek==where.sessionStartWeek)??null,create:async({data})=>{PR.push({id:id++,...data})},update:async({where,data})=>Object.assign(PR.find(r=>r.id==where.id),data)},
 examResult:{create:async({data})=>{ER.push(data)}}};
const db={...tx,$transaction:async f=>f(tx)};let n=0;const rq=()=>"req-"+String(++n).padStart(8,"0");
const t=async(label,fn)=>{try{const r=await fn();console.log("OK  ",label,r?.note??(r?.duplicate?"(duplicate ignored)":""))}catch(e){console.log("DENY",label,"->",e.status??"ERR",e.message)}};
const g0=await getCourses(db,"u1");console.log("\ncourses view:",g0.courses.map(x=>x.code+" "+x.lecturer.name).join(" | "),"| week",g0.weeksElapsed,"of",g0.sessionWeeks,"| exam today:",g0.examToday);
const mth=g0.courses[0].code;
await t("attend MTH lecture",()=>courseAction(db,"u1",{action:"attend",code:mth,requestId:rq()}));
await t("attend the same course again this week",()=>courseAction(db,"u1",{action:"attend",code:mth,requestId:rq()}));
const same=rq();await t("study",()=>courseAction(db,"u1",{action:"study",code:mth,requestId:same}));const e1=C.energy;await t("replay that study request",()=>courseAction(db,"u1",{action:"study",code:mth,requestId:same}));console.log("     energy unchanged by replay:",C.energy===e1,"| progress rows:",PR.length,"attended",PR[0].attended,"prep",PR[0].prep);
await t("a course that is not yours",()=>courseAction(db,"u1",{action:"attend",code:"LAW 101",requestId:rq()}));
await t("old generic 'study' action is refused",()=>doAction(db,"u1","study",rq()));
await t("old generic 'class' action is refused",()=>doAction(db,"u1","class",rq()));
// the exam really reads your progress rows
const runExam=async(rows)=>{PR.length=0;rows.forEach((r,i)=>PR.push({id:BigInt(i+1),sessionStartWeek:1,...r}));let tot=0,k=60,detail=0;for(let i=0;i<k;i++){C.energy=90;AL.length=0;ER.length=0;const r=await sitExam(db,"u1",false,rq());tot+=r.score;detail=r.perCourse?.length??0}return{avg:tot/k,detail}};
const lazy=await runExam([]), keen=await runExam(g0.courses.map(x=>({code:x.code,attended:6,prep:70})));
console.log("exam through the real service, average score: no effort",lazy.avg.toFixed(0),"| full effort",keen.avg.toFixed(0),"| per-course scores stored:",keen.detail,"| effort matters:",keen.avg>lazy.avg+15);
