// imoveryou.io server (alpha): floors = rooms, server-side bots, bow draw-back, curve shots, walls, points + skins.
// Run: npm install && npm start.  Test panel: open the game with ?dev=YOUR_KEY (set DEV_KEY env var on Render).
const http=require('http'),fs=require('fs'),path=require('path');
const {WebSocketServer}=require('ws');
const A=2400,TICK=30,DT=1/TICK,PORT=process.env.PORT||3000,DEV_KEY=process.env.DEV_KEY||'devtest';
const PTS={kill:20,bot:5,floor:30};                       // points earned per player kill / bot kill / floor climbed
// Per-player test settings (changed from the test panel, affect only that player).
const DEF={speed:290,maxCharge:.4,minSpd:400,maxSpd:1400,rec:.25,arrowLife:.9,arrowDmg:34,bounceK:1,dashCd:1.6,dashSpd:1500,dashTime:.14,curveWin:1,curveK:1,need:3,lives:5,god:false,selfHit:true};
const LIM={speed:[100,900],maxCharge:[.1,5],minSpd:[100,2000],maxSpd:[200,3000],rec:[0,2],arrowLife:[.2,3],arrowDmg:[1,200],bounceK:[0,1.2],dashCd:[0,5],dashSpd:[300,4000],dashTime:[.05,.6],curveWin:[0,3],curveK:[0,3],need:[1,20],lives:[1,20]};
// Bot difficulty (server-wide). aimErr = aim error in radians, reload = seconds between shots, dmg = damage multiplier.
const PRESETS={easy:{aimErr:.8,speed:90,reload:1.8,sight:450,dash:.1,dmg:.5,floorScale:.3},normal:{aimErr:.6,speed:115,reload:1.1,sight:550,dash:.3,dmg:.75,floorScale:.5},hard:{aimErr:.34,speed:150,reload:.4,sight:650,dash:.6,dmg:1,floorScale:1}};
const BLIM={aimErr:[0,1.5],speed:[40,300],reload:[.25,4],sight:[200,900],dash:[0,1],dmg:[.1,1.5],floorScale:[0,2]};
const BD={...PRESETS.normal};
// ---- static files ----
const PUB=path.join(__dirname,'public'),MIME={'.html':'text/html; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'};
const srv=http.createServer((q,r)=>{
  let u;try{u=decodeURIComponent((q.url||'/').split('?')[0])}catch{r.writeHead(400);return r.end()}
  if(u==='/')u='/index.html';
  const f=path.normalize(path.join(PUB,u));
  if(!f.startsWith(PUB+path.sep)||!MIME[path.extname(f)]){r.writeHead(404);return r.end()}
  fs.readFile(f,(e,d)=>{r.writeHead(e?404:200,{'Content-Type':MIME[path.extname(f)],'Cache-Control':'no-cache'});r.end(e?undefined:d)});
});
const wss=new WebSocketServer({server:srv});
// ---- skins + player profiles (points, owned skins). Stored in data.json: free Render resets it on redeploy; use a database later. ----
let SK=new Map([['classic',{price:0}]]);
try{for(const s of JSON.parse(fs.readFileSync(path.join(PUB,'skins.json'))).skins)SK.set(String(s.id),{price:Math.max(0,+s.price||0)})}catch{}
const DATA=path.join(process.env.DATA_DIR||__dirname,'data.json');
let profiles={};try{profiles=JSON.parse(fs.readFileSync(DATA))}catch{}
let dirty=false;const save=()=>{if(dirty){dirty=false;try{fs.writeFileSync(DATA,JSON.stringify(profiles))}catch{}}};
setInterval(save,10000);process.on('SIGTERM',()=>{save();process.exit(0)});
const prof=p=>profiles[p.token]||(profiles[p.token]={points:0,owned:['classic'],skin:'classic'});
const give=(p,n)=>{if(!p.bot&&p.token){prof(p).points+=n;dirty=true}};
const sendProf=p=>{const x=prof(p);p.ws.send(JSON.stringify({t:'prof',points:x.points,owned:x.owned,skin:x.skin,dev:p.dev}))};
// ---- game ----
const rooms=new Map();let nid=1,lb=[],lbT=0;
const R=(a,b)=>a+Math.random()*(b-a);
const num=(v,d=0,max=1e4)=>Number.isFinite(+v)?Math.max(-max,Math.min(max,+v)):d;
const cl=(v,[lo,hi],d)=>Math.max(lo,Math.min(hi,num(v,d,1e6)));
function wallsFor(f){   // none on floor 1; pinwheel of bars from floor 2; corner pillars from floor 3
  if(f<2)return[];
  const w=[{x:1000,y:1000,w:300,h:40},{x:1360,y:1000,w:40,h:300},{x:1100,y:1360,w:300,h:40},{x:1000,y:1100,w:40,h:300}];
  if(f>=3)for(const [x,y] of [[560,560],[1760,560],[560,1760],[1760,1760]])w.push({x,y,w:80,h:80});
  return w;
}
const hitWall=(w,x,y,m=2)=>w.some(q=>x>=q.x-m&&x<=q.x+q.w+m&&y>=q.y-m&&y<=q.y+q.h+m);
const room=f=>{let r=rooms.get(f);if(!r){r={f,ps:new Map(),ar:[],ev:[],bo:undefined,w:wallsFor(f)};rooms.set(f,r)}return r};
const mkEnt=o=>Object.assign({a:0,ma:0,d:0,fire:false,dcd:0,dash:0,charge:0,charging:false,rec:0,hp:100,kills:0,tk:0,vx:0,vy:0,spd:290,c:{...DEF},floor:0,bot:false,av:0,pa:0,cwl:0,deaths:0,best:1,gi:0,skin:'classic',token:null},o);
function spawnPos(r){for(let i=0;i<60;i++){const x=R(150,A-150),y=R(150,A-150);if(!hitWall(r.w,x,y,50))return[x,y]}return[150,150]}
function pushOut(p,w){
  for(const q of w){
    const cx=Math.max(q.x,Math.min(p.x,q.x+q.w)),cy=Math.max(q.y,Math.min(p.y,q.y+q.h)),dx=p.x-cx,dy=p.y-cy,d=Math.hypot(dx,dy);
    if(d>=18)continue;
    if(d>0){p.x+=dx/d*(18-d);p.y+=dy/d*(18-d)}
    else{const l=p.x-q.x,rr=q.x+q.w-p.x,t=p.y-q.y,b=q.y+q.h-p.y,m=Math.min(l,rr,t,b);
      if(m===l)p.x=q.x-18;else if(m===rr)p.x=q.x+q.w+18;else if(m===t)p.y=q.y-18;else p.y=q.y+q.h+18}
  }
}
function move(p,w){const dx=p.vx*DT,dy=p.vy*DT,n=Math.max(1,Math.ceil(Math.hypot(dx,dy)/10));
  for(let i=0;i<n;i++){p.x=Math.max(18,Math.min(A-18,p.x+dx/n));p.y=Math.max(18,Math.min(A-18,p.y+dy/n));pushOut(p,w)}}
function place(p,f){
  if(p.floor)rooms.get(p.floor)?.ps.delete(p.id);
  const r=room(f),[sx,sy]=spawnPos(r);
  Object.assign(p,{floor:f,x:sx,y:sy,vx:0,vy:0,hp:100,dash:0,kills:0,charge:0,charging:false,rec:0});
  p.best=Math.max(p.best,f);r.ps.set(p.id,p);
}
function spawnBot(r){const [sx,sy]=spawnPos(r);const b=mkEnt({id:nid++,name:'Bot',skin:'bot',hue:Math.round(R(0,360)),bot:true,floor:r.f,x:sx,y:sy,wt:0,want:1,err:0});r.ps.set(b.id,b)}
function doDash(p){if(p.dcd>0)return;p.dash=p.c.dashTime;p.dcd=p.c.dashCd;p.cwl=p.c.curveWin;p.vx=Math.cos(p.ma)*p.c.dashSpd;p.vy=Math.sin(p.ma)*p.c.dashSpd}
function muzzle(p,r){const x=p.x+Math.cos(p.a)*18,y=p.y+Math.sin(p.a)*18;return hitWall(r.w,x,y)?[p.x,p.y]:[x,y]}
function loose(p,r){
  const c=p.c,lo=Math.min(c.minSpd,c.maxSpd),hi=Math.max(c.minSpd,c.maxSpd),s=lo+(hi-lo)*Math.min(1,p.charge/c.maxCharge);
  // curve shot: dash, then flick your aim and release inside the window; turn rate follows how fast the aim was swung
  let w=0;if(!p.bot&&p.cwl>0&&Math.abs(p.av)>2){w=Math.max(-2.2,Math.min(2.2,p.av*.12*c.curveK));p.cwl=0}
  const m=muzzle(p,r);
  r.ar.push({x:m[0],y:m[1],vx:Math.cos(p.a)*s,vy:Math.sin(p.a)*s,l:c.arrowLife,o:p.id,w,d:c.arrowDmg*(p.bot?BD.dmg:1),k:c.bounceK,sh:c.selfHit,b:0});
}
function wallStep(a,r,h){   // billiard bounce: flip the velocity component that hit the wall
  if(a.w){const c=Math.cos(a.w*h),s=Math.sin(a.w*h),x=a.vx;a.vx=x*c-a.vy*s;a.vy=x*s+a.vy*c}
  const px=a.x,py=a.y;let nx=px+a.vx*h,ny=py+a.vy*h;
  const bx=hitWall(r.w,nx,py),by=hitWall(r.w,px,ny);let bounced=false;
  if(bx||by){if(bx){a.vx=-a.vx;nx=px}if(by){a.vy=-a.vy;ny=py}bounced=true}
  else if(hitWall(r.w,nx,ny)){a.vx=-a.vx;a.vy=-a.vy;nx=px;ny=py;bounced=true}
  if(bounced){a.b++;a.vx*=a.k;a.vy*=a.k;r.ev.push([Math.round(px),Math.round(py),40,2])}
  a.x=nx;a.y=ny;a.l-=h;
}
function botAI(b,r){
  let t=null,bd=BD.sight;
  for(const o of r.ps.values()){if(o===b)continue;const d=Math.hypot(o.x-b.x,o.y-b.y);if(d<bd){bd=d;t=o}}
  b.spd=BD.speed+r.f*8*BD.floorScale;
  if(t){
    const ta=Math.atan2(t.y-b.y,t.x-b.x),acc=Math.max(.04,BD.aimErr-r.f*.04*BD.floorScale);
    if(!b.charging)b.err=R(-acc,acc);
    b.a=ta+b.err;
    const dir=bd>280?1:-.3,side=Math.sin(Date.now()/700+b.hue)*.8;
    b.ma=Math.atan2(Math.sin(ta)*dir+Math.cos(ta)*side,Math.cos(ta)*dir-Math.sin(ta)*side);b.d=90;
    if(b.fire&&b.charge>=b.want)b.fire=false;
    else if(!b.fire&&!b.charging&&b.rec<=0){b.fire=true;b.want=R(.3,1)*b.c.maxCharge}
    if(b.hp<50&&Math.random()<DT*BD.dash)doDash(b);
  }else{b.fire=false;b.wt-=DT;if(b.wt<=0){b.wt=R(1,3);b.ma=R(0,6.28);b.a=b.ma}b.d=60}
}
wss.on('connection',ws=>{
  const p=mkEnt({id:nid++,ws,name:'player',hue:Math.round(R(0,360)),dev:false});ws.p=p;
  ws.on('message',m=>{
    if(m.length>300)return;
    let d;try{d=JSON.parse(m)}catch{return}
    if(d.t==='auth'){
      const t=String(d.token||'');if(p.token||!/^[\w-]{16,64}$/.test(t))return;
      p.token=t;p.dev=String(d.key||'')===DEV_KEY;p.skin=prof(p).skin;sendProf(p);
      if(p.dev)ws.send(JSON.stringify({t:'bd',v:BD}));return;
    }
    if(!p.token)return;
    if(d.t==='join'){if(p.floor)return;p.name=String(d.name||'player').slice(0,12);p.skin=prof(p).skin;p.deaths=0;p.best=1;p.kills=0;p.tk=0;place(p,1);return}
    if(d.t==='buy'){const s=SK.get(String(d.id)),x=prof(p);if(!s||x.owned.includes(String(d.id))||x.points<s.price)return;x.points-=s.price;x.owned.push(String(d.id));dirty=true;sendProf(p);return}
    if(d.t==='equip'){const x=prof(p),id=String(d.id);if(!x.owned.includes(id))return;x.skin=id;p.skin=id;dirty=true;sendProf(p);return}
    if(!p.floor)return;
    if(d.t==='in'){const na=num(d.a,0,7);if(!p.gi){p.gi=1;p.pa=na}p.a=na;p.ma=d.m===undefined?na:num(d.m,0,7);p.d=Math.max(0,num(d.d,0));p.fire=!!d.f}
    else if(d.t==='dash')doDash(p);
    else if(!p.dev)return;
    else if(d.t==='cfg'){if(d.k==='god'||d.k==='selfHit')p.c[d.k]=!!d.v;else if(LIM[d.k])p.c[d.k]=cl(d.v,LIM[d.k],DEF[d.k])}
    else if(d.t==='floor')place(p,Math.max(1,Math.min(99,Math.round(num(d.v,1)))));
    else if(d.t==='bots'){const n=Math.round(num(d.v,-1,100));room(p.floor).bo=n<0?undefined:Math.min(40,n)}
    else if(d.t==='bd'||d.t==='bdpreset'){
      if(d.t==='bd'&&Object.hasOwn(BLIM,d.k))BD[d.k]=cl(d.v,BLIM[d.k],BD[d.k]);
      if(d.t==='bdpreset'&&Object.hasOwn(PRESETS,d.v))Object.assign(BD,PRESETS[d.v]);
      for(const c of wss.clients||[])if(c.p?.dev&&c.readyState===1)c.send(JSON.stringify({t:'bd',v:BD}));
    }
  });
  ws.on('close',()=>rooms.get(p.floor)?.ps.delete(p.id));
});
function tick(){
  if(++lbT%10===0)lb=[...rooms.values()].flatMap(r=>[...r.ps.values()].filter(p=>!p.bot)).sort((a,b)=>b.tk-a.tk||b.floor-a.floor).slice(0,5).map(p=>[p.id,p.name,p.tk,p.floor]);
  for(const r of [...rooms.values()]){
    if(![...r.ps.values()].some(p=>!p.bot)){rooms.delete(r.f);continue}
    const target=r.bo??Math.min(4+2*r.f,16),bots=[...r.ps.values()].filter(p=>p.bot);
    for(let n=bots.length;n<target;n++)spawnBot(r);
    for(let n=bots.length;n>target;n--)r.ps.delete(bots.pop().id);
    for(const p of r.ps.values()){
      if(p.bot)botAI(p,r);
      if(!p.bot){let da=p.a-p.pa;da=Math.atan2(Math.sin(da),Math.cos(da))/DT;p.pa=p.a;p.av=Math.abs(da)>Math.abs(p.av)?da:p.av*Math.exp(-DT/.25);p.av=Math.max(-40,Math.min(40,p.av))}
      p.cwl-=DT;
      if(p.dash<=0){const s=(p.bot?p.spd:p.c.speed)*Math.min(1,p.d/90);p.vx=Math.cos(p.ma)*s;p.vy=Math.sin(p.ma)*s}
      p.dash-=DT;p.dcd-=DT;p.rec-=DT;
      move(p,r.w);
      if(p.fire&&p.rec<=0){p.charging=true;p.charge=Math.min(p.c.maxCharge,p.charge+DT)}
      else if(p.charging&&!p.fire){loose(p,r);p.charging=false;p.charge=0;p.rec=p.bot?BD.reload:p.c.rec}
    }
    for(const a of r.ar){
     const n=Math.max(1,Math.ceil(Math.hypot(a.vx,a.vy)*DT/8)),h=DT/n;
     for(let st=0;st<n&&a.l>0;st++){
      const px=a.x,py=a.y;wallStep(a,r,h);
      if(a.x<0||a.y<0||a.x>A||a.y>A){a.l=0;break}
      for(const v of r.ps.values()){
        if((v.id===a.o&&!(a.b&&a.sh))||v.dash>0||seg(v.x,v.y,px,py,a.x,a.y)>=22)continue;   // owner is only hittable by their own bounced arrow
        a.l=0;r.ev.push([Math.round(a.x),Math.round(a.y),v.hue,0]);
        if(v.c.god)break;
        v.hp-=a.d;
        if(v.hp<=0){
          r.ev.push([Math.round(v.x),Math.round(v.y),v.hue,1,a.o]);
          const k=r.ps.get(a.o),credit=k&&k!==v&&!k.bot;
          if(credit){k.tk++;give(k,v.bot?PTS.bot:PTS.kill)}
          if(v.bot)r.ps.delete(v.id);
          else if(++v.deaths>=v.c.lives){r.ps.delete(v.id);v.floor=0;v.fire=false;if(v.ws.readyState===1)v.ws.send(JSON.stringify({t:'over',best:v.best,tk:v.tk,lives:v.c.lives}))}   // out of lives: home screen
          else place(v,Math.max(1,r.f-1));                                                    // knocked out: drop a floor
          if(credit&&++k.kills>=k.c.need){give(k,PTS.floor);place(k,r.f+1)}                    // climb
        }
        break;
      }
     }
    }
    r.ar=r.ar.filter(a=>a.l>0);
    const P=[...r.ps.values()];
    const pl=P.map(p=>[p.id,Math.round(p.x),Math.round(p.y),+p.a.toFixed(2),p.hp,p.hue,p.dash>0?1:0,p.name,p.charging?+(p.charge/p.c.maxCharge).toFixed(2):0,p.bot?1:0,p.skin]);
    const wl=r.w.map(q=>[q.x,q.y,q.w,q.h]),ar=r.ar.map(a=>[Math.round(a.x),Math.round(a.y),Math.round(a.vx),Math.round(a.vy),a.o,a.w?1:0]);
    for(const p of P)if(!p.bot&&p.ws.readyState===1)p.ws.send(JSON.stringify({t:'s',id:p.id,fl:r.f,k:p.kills,nd:p.c.need,lv:p.c.lives-p.deaths,pt:prof(p).points,dcd:Math.max(0,+p.dcd.toFixed(2)),dm:p.c.dashCd,cw:+Math.max(0,p.cwl).toFixed(2),lb,w:wl,p:pl,a:ar,e:r.ev}));
    r.ev=[];
  }
}
function seg(px,py,x1,y1,x2,y2){const dx=x2-x1,dy=y2-y1,l=dx*dx+dy*dy;let t=l?((px-x1)*dx+(py-y1)*dy)/l:0;t=Math.max(0,Math.min(1,t));return Math.hypot(px-(x1+dx*t),py-(y1+dy*t))}
setInterval(tick,1000/TICK);
if(require.main===module)srv.listen(PORT,()=>console.log('imoveryou.io on http://localhost:'+PORT));
module.exports={rooms,tick,wss,srv,BD,profiles};
