// tools/harness/sheet.mjs
import {createRequire} from "node:module"; const require=createRequire("/home/claude/.npm-global/lib/node_modules/");
const sharp=require("sharp"); import {spawnSync} from "node:child_process";
const looks=JSON.parse(process.argv[2]), cols=+(process.argv[3]||4), W=360,H=560,out=process.argv[4]||"/tmp/harness/sheet.png";
const files=[];
looks.forEach(([look,g,az,dist,ty],i)=>{const f=`/tmp/harness/s${i}.png`;const r=spawnSync("node",["shot.mjs","/tmp/harness","char.html",f,String(W),String(H),"900",`show(${JSON.stringify(look)},'${g}',${az??0.3},${dist??4.6},${ty??0.88})`],{encoding:"utf8"});if(r.status!==0)console.log(r.stderr.slice(0,400));files.push(f)});
const rows=Math.ceil(files.length/cols);
await sharp({create:{width:W*cols,height:H*rows,channels:3,background:"#0b1118"}}).composite(files.map((f,i)=>({input:f,left:(i%cols)*W,top:Math.floor(i/cols)*H}))).png().toFile(out);console.log("sheet",out);
