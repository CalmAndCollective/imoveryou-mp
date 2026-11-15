// imoveryou.io server (alpha): one room per floor, server-side bots, bow draw-back, dev test panel.
// Run: npm install && npm start.  Dev panel: open the game with ?dev=YOUR_KEY (set DEV_KEY env var on Render).
const http=require('http'),fs=require('fs'),path=require('path');
const {WebSocketServer}=require('ws');
const A=2400,NEED=3,TICK=30,DT=1/TICK,PORT=process.env.PORT||3000,DEV_KEY=process.env.DEV_KEY||'devtest';
const DEF={speed:290,maxCharge:.4,minSpd:400,maxSpd:1400,dashCd:1.6,curveWin:1,curveK:1,god:false};
const LIM={speed:[100,900],maxCharge:[.1,5],minSpd:[100,2000],maxSpd:[200,3000],dashCd:[0,5],curveWin:[0,3],curveK:[0,3]};
const page=path.join(__dirname,'public','index.html');
const srv=http.createServer((q,r)=>fs.readFile(page,(e,d)=>{r.writeHead(e?404:200,{'Content-Type':'text/html; charset=utf-8'});r.end(d)}));
const wss=new WebSocketServer({server:srv});
const rooms=new Map();let nid=1;
const R=(a,b)=>a+Math.random()*(b-a);
const num=(v,d=0,max=1e4)=>Number.isFinite(+v)?Math.max(-max,Math.min(max,+v)):d;
// walls: none on floor 1; a pinwheel of bars around the centre from floor 2; corner pillars added from floor 3
function wallsFor(f){
  if(f<2)return[];
  const w=[{x:1000,y:1000,w:300,h:40},{x:1360,y:1000,w:40,h:300},{x:1100,y:1360,w:300,h:40},{x:1000,y:1100,w:40,h:300}];
  if(f>=3)for(const [x,y] of [[560,560],[1760,560],[560,1760],[1760,1760]])w.push({x,y,w:80,h:80});
  return w;
}
const hitWall=(w,x,y,m=2)=>w.some(q=>x>=q.x-m&&x<=q.x+q.w+m&&y>=q.y-m&&y<=q.y+q.h+m);
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
function wallStep(a,r,h){   // billiard bounce: flip the velocity component that hit the wall, keep the speed
  if(a.w){const c=Math.cos(a.w*h),s=Math.sin(a.w*h),x=a.vx;a.vx=x*c-a.vy*s;a.vy=x*s+a.vy*c}
  const px=a.x,py=a.y;let nx=px+a.vx*h,ny=py+a.vy*h;
  const bx=hitWall(r.w,nx,py),by=hitWall(r.w,px,ny);
  if(bx||by){if(bx){a.vx=-a.vx;nx=px}if(by){a.vy=-a.vy;ny=py}r.ev.push([Math.round(px),Math.round(py),40,2])}
  else if(hitWall(r.w,nx,ny)){a.vx=-a.vx;a.vy=-a.vy;nx=px;ny=py;r.ev.push([Math.round(px),Math.round(py),40,2])}
  a.x=nx;a.y=ny;a.l-=h;
}
function muzzle(p,r){const x=p.x+Math.cos(p.a)*18,y=p.y+Math.sin(p.a)*18;return hitWall(r.w,x,y)?[p.x,p.y]:[x,y]}
const room=f=>{let r=rooms.get(f);if(!r){r={f,ps:new Map(),ar:[],ev:[],bo:undefined,w:wallsFor(f)};rooms.set(f,r)}return r};
const mkEnt=o=>Object.assign({a:0,ma:0,d:0,fire:false,dcd:0,dash:0,charge:0,charging:false,rec:0,hp:100,kills:0,vx:0,vy:0,spd:290,c:{...DEF},floor:0,bot:false,av:0,pa:0,cwl:0,deaths:0,best:1,gi:0},o);
const seg=(px,py,x1,y1,x2,y2)=>{const dx=x2-x1,dy=y2-y1,l=dx*dx+dy*dy;let t=l?((px-x1)*dx+(py-y1)*dy)/l:0;t=Math.max(0,Math.min(1,t));return Math.hypot(px-(x1+dx*t),py-(y1+dy*t))};
function place(p,f){
  if(p.floor)rooms.get(p.floor)?.ps.delete(p.id);
  const r=room(f),[sx,sy]=spawnPos(r);
  Object.assign(p,{floor:f,x:sx,y:sy,vx:0,vy:0,hp:100,dash:0,kills:0,charge:0,charging:false,rec:0});
  p.best=Math.max(p.best,f);r.ps.set(p.id,p);
}
function spawnBot(r){const [sx,sy]=spawnPos(r);const b=mkEnt({id:nid++,name:'Bot',hue:Math.round(R(0,360)),bot:true,floor:r.f,x:sx,y:sy,wt:0,want:1,err:0});r.ps.set(b.id,b)}
function doDash(p){if(p.dcd>0)return;p.dash=.14;p.dcd=p.c.dashCd;p.cwl=p.c.curveWin;p.vx=Math.cos(p.ma)*1500;p.vy=Math.sin(p.ma)*1500}
function loose(p,r){
  const c=p.c,lo=Math.min(c.minSpd,c.maxSpd),hi=Math.max(c.minSpd,c.maxSpd),s=lo+(hi-lo)*Math.min(1,p.charge/c.maxCharge);
  // curve shot: dash, then flick your aim and release inside the window. Turn rate follows how fast the aim was swung.
  let w=0;if(!p.bot&&p.cwl>0&&Math.abs(p.av)>2){w=Math.max(-2.2,Math.min(2.2,p.av*.12*c.curveK));p.cwl=0}
  const m=muzzle(p,r);r.ar.push({x:m[0],y:m[1],vx:Math.cos(p.a)*s,vy:Math.sin(p.a)*s,l:.9,o:p.id,w});
}
function botAI(b,r){
  let t=null,bd=650;
  for(const o of r.ps.values()){if(o===b)continue;const d=Math.hypot(o.x-b.x,o.y-b.y);if(d<bd){bd=d;t=o}}
  b.spd=150+r.f*8;
  if(t){
    const ta=Math.atan2(t.y-b.y,t.x-b.x),acc=Math.max(.05,.34-r.f*.04);
    if(!b.charging)b.err=R(-acc,acc);
    b.a=ta+b.err;
    const dir=bd>280?1:-.3,side=Math.sin(Date.now()/700+b.hue)*.8;
    b.ma=Math.atan2(Math.sin(ta)*dir+Math.cos(ta)*side,Math.cos(ta)*dir-Math.sin(ta)*side);b.d=90;
    if(b.fire&&b.charge>=b.want)b.fire=false;
    else if(!b.fire&&!b.charging&&b.rec<=0){b.fire=true;b.want=R(.3,1)*b.c.maxCharge}
    if(b.hp<50&&Math.random()<DT*.6)doDash(b);
  }else{
    b.fire=false;b.wt-=DT;if(b.wt<=0){b.wt=R(1,3);b.ma=R(0,6.28);b.a=b.ma}b.d=60;
  }
}
wss.on('connection',ws=>{
  const p=mkEnt({id:nid++,ws,name:'player',hue:Math.round(R(0,360)),dev:false});
  ws.on('message',m=>{
    if(m.length>240)return;
    let d;try{d=JSON.parse(m)}catch{return}
    if(d.t==='join'&&!p.floor){
      p.name=String(d.name||'player').slice(0,12);p.dev=String(d.key||'')===DEV_KEY;p.deaths=0;p.best=1;p.kills=0;
      ws.send(JSON.stringify({t:'hello',dev:p.dev}));place(p,1);
    }
    else if(!p.floor)return;
    else if(d.t==='in'){const na=num(d.a,0,7);if(!p.gi){p.gi=1;p.pa=na}p.a=na;p.ma=na;p.d=Math.max(0,num(d.d,0));p.fire=!!d.f}
    else if(d.t==='dash')doDash(p);
    else if(d.t==='cfg'&&p.dev){if(d.k==='god')p.c.god=!!d.v;else if(LIM[d.k])p.c[d.k]=Math.max(LIM[d.k][0],Math.min(LIM[d.k][1],num(d.v,DEF[d.k])))}
    else if(d.t==='floor'&&p.dev)place(p,Math.max(1,Math.min(99,Math.round(num(d.v,1)))));
    else if(d.t==='bots'&&p.dev){const n=Math.round(num(d.v,-1,100));room(p.floor).bo=n<0?undefined:Math.min(40,n)}
  });
  ws.on('close',()=>rooms.get(p.floor)?.ps.delete(p.id));
});
function tick(){
  for(const r of [...rooms.values()]){
    const humans=[...r.ps.values()].filter(p=>!p.bot).length;
    if(!humans){rooms.delete(r.f);continue}
    const target=r.bo??Math.min(4+2*r.f,16);
    const bots=[...r.ps.values()].filter(p=>p.bot);
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
      else if(p.charging&&!p.fire){loose(p,r);p.charging=false;p.charge=0;p.rec=.25}
    }
    for(const a of r.ar){
     const n=Math.max(1,Math.ceil(Math.hypot(a.vx,a.vy)*DT/8)),h=DT/n;
     for(let st=0;st<n&&a.l>0;st++){
      const px=a.x,py=a.y;wallStep(a,r,h);
      if(a.x<0||a.y<0||a.x>A||a.y>A){a.l=0;break}
      for(const v of r.ps.values()){
        if(v.id===a.o||v.dash>0||seg(v.x,v.y,px,py,a.x,a.y)>=22)continue;
        a.l=0;
        if(v.c.god){r.ev.push([Math.round(a.x),Math.round(a.y),v.hue,0]);break}
        v.hp-=34;r.ev.push([Math.round(a.x),Math.round(a.y),v.hue,0]);
        if(v.hp<=0){
          r.ev.push([Math.round(v.x),Math.round(v.y),v.hue,1,a.o]);
          const k=r.ps.get(a.o);
          if(v.bot)r.ps.delete(v.id);
          else if(++v.deaths>=5){r.ps.delete(v.id);v.floor=0;v.fire=false;if(v.ws.readyState===1)v.ws.send(JSON.stringify({t:'over',best:v.best}))}   // 5 knockouts: back to the home screen
          else place(v,Math.max(1,r.f-1));   // human death: drop a floor (floor 1 stays)
          if(k&&!k.bot&&++k.kills>=NEED)place(k,r.f+1);                  // 5 kills: climb
        }
        break;
      }
     }
    }
    r.ar=r.ar.filter(a=>a.l>0);
    const P=[...r.ps.values()];
    const pl=P.map(p=>[p.id,Math.round(p.x),Math.round(p.y),+p.a.toFixed(2),p.hp,p.hue,p.dash>0?1:0,p.name,p.charging?+(p.charge/p.c.maxCharge).toFixed(2):0,p.bot?1:0]);
    const wl=r.w.map(q=>[q.x,q.y,q.w,q.h]);const ar=r.ar.map(a=>[Math.round(a.x),Math.round(a.y),Math.round(a.vx),Math.round(a.vy),a.o,a.w?1:0]);
    for(const p of P)if(!p.bot&&p.ws.readyState===1)p.ws.send(JSON.stringify({t:'s',id:p.id,fl:r.f,k:p.kills,dcd:Math.max(0,+p.dcd.toFixed(2)),dm:p.c.dashCd,lv:5-p.deaths,cw:+Math.max(0,p.cwl).toFixed(2),w:wl,p:pl,a:ar,e:r.ev}));
    r.ev=[];
  }
}
setInterval(tick,1000/TICK);
if(require.main===module)srv.listen(PORT,()=>console.log('imoveryou.io on http://localhost:'+PORT));
module.exports={rooms,tick,wss};
