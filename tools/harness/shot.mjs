// tools/harness/shot.mjs
import {createRequire} from "node:module"; const require=createRequire("/home/claude/.npm-global/lib/node_modules/");
const {chromium}=require("playwright"); import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const root=process.argv[2]||"/tmp/harness", page_=process.argv[3]||"smoke.html", out=process.argv[4]||"/tmp/harness/out.png", W=+(process.argv[5]||900), H=+(process.argv[6]||600), wait=+(process.argv[7]||1500), act=process.argv[8];
const mime={".html":"text/html",".js":"text/javascript",".mjs":"text/javascript",".css":"text/css",".png":"image/png",".json":"application/json"};
const roots=[root,"/mnt/user-data/outputs/oau-life-backend"];
const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split("?")[0]);for(const b of roots){const f=path.join(b,u);if(f.startsWith(b)&&fs.existsSync(f)&&fs.statSync(f).isFile()){r.writeHead(200,{"content-type":mime[path.extname(f)]||"application/octet-stream"});return fs.createReadStream(f).pipe(r)}}r.writeHead(404);r.end("nf "+u)}).listen(0);
const port=srv.address().port;
const b=await chromium.launch({args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--no-sandbox"]});
const p=await b.newPage({viewport:{width:W,height:H}}); const logs=[];
p.on("console",m=>logs.push(m.type()+": "+m.text())); p.on("pageerror",e=>logs.push("PAGEERROR: "+e.message)); p.on("requestfailed",r=>logs.push("REQFAIL: "+r.url()));
await p.goto(`http://localhost:${port}/${page_}`); await p.waitForTimeout(wait);
if(act){ await p.evaluate(act); await p.waitForTimeout(600); }
await p.screenshot({path:out}); console.log("saved",out,"| errors:",logs.filter(l=>/error|PAGEERROR|REQFAIL/i.test(l)).slice(0,6)); await b.close(); srv.close();
