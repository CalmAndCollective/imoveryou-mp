// imoveryou.io authoritative server: one room per floor. Run: npm install && npm start
const http=require('http'),fs=require('fs'),path=require('path');
const {WebSocketServer}=require('ws');
const A=2400,NEED=5,TICK=30,DT=1/TICK,PORT=process.env.PORT||3000;
const page=path.join(__dirname,'public','index.html');
const srv=http.createServer((q,r)=>fs.readFile(page,(e,d)=>{r.writeHead(e?404:200,{'Content-Type':'text/html; charset=utf-8'});r.end(d)}));
const wss=new WebSocketServer({server:srv});
const rooms=new Map();let nid=1;
const R=(a,b)=>a+Math.random()*(b-a);
const rate=f=>Math.max(.5,1.25-f*.08);           // same shot cooldown rule as the single-player build
const num=(v,d=0,max=1e4)=>Number.isFinite(+v)?Math.max(-max,Math.min(max,+v)):d;
const room=f=>{let r=rooms.get(f);if(!r){r={f,ps:new Map(),ar:[],ev:[]};rooms.set(f,r)}return r};
function place(p,f){
  if(p.floor)rooms.get(p.floor)?.ps.delete(p.id);
  Object.assign(p,{floor:f,x:R(150,A-150),y:R(150,A-150),vx:0,vy:0,hp:100,dash:0,kills:0,cd:0});
  room(f).ps.set(p.id,p);
}
wss.on('connection',ws=>{
  const p={id:nid++,ws,name:'player',hue:Math.round(R(0,360)),a:0,d:0,fire:false,dcd:0,floor:0};
  ws.on('message',m=>{
    if(m.length>200)return;
    let d;try{d=JSON.parse(m)}catch{return}
    if(d.t==='join'&&!p.floor){p.name=String(d.name||'player').slice(0,12);place(p,1)}
    else if(!p.floor)return;
    else if(d.t==='in'){p.a=num(d.a,0,7);p.d=Math.max(0,num(d.d,0));p.fire=!!d.f}
    else if(d.t==='dash'&&p.dcd<=0){p.dash=.14;p.dcd=1.6;p.vx=Math.cos(p.a)*1500;p.vy=Math.sin(p.a)*1500}
  });
  ws.on('close',()=>rooms.get(p.floor)?.ps.delete(p.id));
});
function tick(){
  for(const r of [...rooms.values()]){
    for(const p of r.ps.values()){
      if(p.dash<=0){const s=290*Math.min(1,p.d/90);p.vx=Math.cos(p.a)*s;p.vy=Math.sin(p.a)*s}
      p.dash-=DT;p.dcd-=DT;p.cd-=DT;
      p.x=Math.max(18,Math.min(A-18,p.x+p.vx*DT));p.y=Math.max(18,Math.min(A-18,p.y+p.vy*DT));
      if(p.fire&&p.cd<=0){p.cd=rate(r.f);r.ar.push({x:p.x+Math.cos(p.a)*18,y:p.y+Math.sin(p.a)*18,vx:Math.cos(p.a)*950,vy:Math.sin(p.a)*950,l:.85,o:p.id})}
    }
    for(const a of r.ar){
      a.x+=a.vx*DT;a.y+=a.vy*DT;a.l-=DT;
      if(a.x<0||a.y<0||a.x>A||a.y>A){a.l=0;continue}
      for(const v of r.ps.values()){
        if(v.id===a.o||v.dash>0||Math.hypot(v.x-a.x,v.y-a.y)>=22)continue;
        a.l=0;v.hp-=34;r.ev.push([Math.round(a.x),Math.round(a.y),v.hue,0]);
        if(v.hp<=0){
          r.ev.push([Math.round(v.x),Math.round(v.y),v.hue,1,a.o]);
          const k=r.ps.get(a.o);
          place(v,Math.max(1,r.f-1));            // death: drop one floor (floor 1 stays)
          if(k&&++k.kills>=NEED)place(k,r.f+1);  // 5 kills: climb
        }
        break;
      }
    }
    r.ar=r.ar.filter(a=>a.l>0);
    const P=[...r.ps.values()];
    const pl=P.map(p=>[p.id,Math.round(p.x),Math.round(p.y),+p.a.toFixed(2),p.hp,p.hue,p.dash>0?1:0,p.name]);
    const ar=r.ar.map(a=>[Math.round(a.x),Math.round(a.y),Math.round(a.vx),Math.round(a.vy),a.o]);
    for(const p of P)if(p.ws.readyState===1)p.ws.send(JSON.stringify({t:'s',id:p.id,fl:r.f,k:p.kills,dcd:Math.max(0,+p.dcd.toFixed(2)),p:pl,a:ar,e:r.ev}));
    r.ev=[];
    if(!r.ps.size&&r.f>1)rooms.delete(r.f);
  }
}
setInterval(tick,1000/TICK);
if(require.main===module)srv.listen(PORT,()=>console.log('imoveryou.io on http://localhost:'+PORT));
module.exports={rooms,tick,wss};
