/**
 * The README's control plane as one machined channel. The flood narrows through
 * admission and the scheduler to a sluice gate. The gate rules on each intent: deferrals are
 * sent from the gate into the hold bay and return through it only when a person presses
 * release, rejections sink, and admitted work passes under the ledger's stamp onto dry ground.
 */
const { Cam, facing, fit, proj, rrect, prism, fillet, poly, open, seg, solid, put, mk,
  pointer, register, disposer, reducedMotion, bezier, tween, tset, tval } = HL;

// Below this rendered width the main line's header-row callouts cannot reach label size without
// colliding, so the drawing turns portrait with a label column (IsometricDiagram passes `narrow`).
// `resume` carries the hold queue across a rebuild for the other layout; snapshot() supplies it.
function mount({stage,svg,narrow=stage.getBoundingClientRect().width<580,resume,onStageChange=()=>{},onHoldChange=()=>{}}) {
  const mobile=narrow;
  const bag=disposer(), C=mobile?Cam(90,.62,1):Cam(45,.5,1);
  fit(C,[[0,0,0]],200,160);
  const P=proj(C), front=facing(C), origin=P(0,0,0), Z=8;
  // The sign of each world axis toward the viewer drives the painter's sort.
  const toward=[Math.sin(C.az),Math.cos(C.az)].map(v=>Math.abs(v)<1e-6?0:Math.sign(v));
  const ease=bezier(.32,.72,0,1), glide=bezier(.45,0,.55,1);
  const unit=v=>Math.max(0,Math.min(1,v)), mix=(a,b,k)=>a.map((v,i)=>v+(b[i]-v)*k);
  let frame={x:0,y:0,width:400,height:320};
  const root=mk("g",{},svg), floor=mk("g",{},root), scene=mk("g",{},root), above=mk("g",{},root), notes=mk("g",{},root);

  // Every solid is a chamfered block (n=1 cuts each corner once) drawn at the origin and
  // translated: projection is affine. Round parts pass a higher n.
  const blocks=[];
  function block(w,h,d,{r=2,b=.6,n=1,crease=true,cls=""}={}) {
    const g=mk("g",cls?{class:cls}:{},scene), s=solid(g);
    const it={g,s,w,h,d,x:0,y:0,z:0,shown:true,shape:"",pose:"",alpha:"",marks:null};
    it.size=(W,H,D)=>{
      const key=`${W.toFixed(2)} ${H.toFixed(2)} ${D.toFixed(2)}`;
      if(it.shape===key)return it;
      it.shape=key;Object.assign(it,{w:W,h:H,d:D});
      const k=Math.min(b,W/2-.3,H/2-.3);
      put(s,prism(P,front,rrect(0,0,W,H,r,n),crease?rrect(k,k,W-k,H-k,Math.max(.3,r-k),n):null,0,D));
      it.marks?.(W,H,D);return it;
    };
    it.at=(x,y,z,opacity=1)=>{
      it.x=x;it.y=y;it.z=z;it.shown=opacity>.004;
      const q=P(x,y,z),pose=`translate(${(q[0]-origin[0]).toFixed(2)} ${(q[1]-origin[1]).toFixed(2)})`,alpha=opacity.toFixed(2);
      if(it.pose!==pose){it.pose=pose;g.setAttribute("transform",pose);}
      if(it.alpha!==alpha){it.alpha=alpha;g.setAttribute("opacity",alpha);}
      return it;
    };
    it.centre=(x,y,z,opacity)=>it.at(x-it.w/2,y-it.h/2,z,opacity);
    it.remove=()=>{g.remove();blocks.splice(blocks.indexOf(it),1);};
    it.state=(name,on)=>{if(g.classList.contains(name)!==on)g.classList.toggle(name,on);};
    blocks.push(it);return it.size(w,h,d);
  }
  // A check printed on the lid, drawn along the screen's axes so it reads upright from either camera.
  const across=[Math.cos(C.az),-Math.sin(C.az)], down=[Math.sin(C.az),Math.cos(C.az)];
  function checked(it) {
    const path=mk("path",{class:"nf production-check",opacity:"0"},it.g);
    it.marks=(W,H,D)=>{
      const R=Math.min(W,H)*.36,f=(u,v)=>P(W/2+R*(u*across[0]+v*down[0]),H/2+R*(u*across[1]+v*down[1]),D+.05);
      path.setAttribute("d",open([f(-.62,-.05),f(-.18,.62),f(.7,-.62)]));
    };
    it.marks(it.w,it.h,it.d);it.check=path;return it;
  }

  // Painter's sort: a box wholly above, or wholly nearer along a viewed axis, cannot be hidden.
  function sweep(it,axis) {
    const lo=axis?it.y:it.x,hi=lo+(axis?it.h:it.w);
    return toward[axis]>0?[lo,hi]:[-hi,-lo];
  }
  function order(a,b) {
    const e=.01;
    if(b.z>=a.z+a.d-e)return -1;
    if(a.z>=b.z+b.d-e)return 1;
    for(const axis of [0,1]) {
      if(!toward[axis])continue;
      const [a0,a1]=sweep(a,axis),[b0,b1]=sweep(b,axis);
      if(b0>=a1-e)return -1;
      if(a0>=b1-e)return 1;
    }
    // Intersecting boxes, such as a card riding over a plate's lip: the one standing higher is in front.
    if(a.z>b.z+e&&a.z+a.d>b.z+b.d+e)return 1;
    if(b.z>a.z+e&&b.z+b.d>a.z+a.d+e)return -1;
    return 0;
  }
  let painted=[];
  function paint() {
    const items=blocks.filter(it=>it.shown),n=items.length;
    const box=items.map(it=>{
      let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
      for(const x of [it.x,it.x+it.w])for(const y of [it.y,it.y+it.h])for(const z of [it.z,it.z+it.d]) {
        const q=P(x,y,z);x0=Math.min(x0,q[0]);x1=Math.max(x1,q[0]);y0=Math.min(y0,q[1]);y1=Math.max(y1,q[1]);
      }
      return [x0,y0,x1,y1];
    });
    const depth=items.map(it=>(it.x+it.w/2)*toward[0]+(it.y+it.h/2)*toward[1]+it.z*.01);
    const next=items.map(()=>[]),need=new Array(n).fill(0);
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++) {
      const a=box[i],b=box[j];
      if(a[2]<=b[0]+.01||b[2]<=a[0]+.01||a[3]<=b[1]+.01||b[3]<=a[1]+.01)continue;
      const o=order(items[i],items[j])||(depth[i]<=depth[j]?-1:1);
      if(o<0){next[i].push(j);need[j]++;}else{next[j].push(i);need[i]++;}
    }
    const done=new Array(n).fill(false),out=[];
    while(out.length<n) {
      let pick=-1;
      for(let i=0;i<n;i++)if(!done[i]&&!need[i]&&(pick<0||depth[i]<depth[pick]))pick=i;
      // Intersecting solids can form a cycle; the farther one breaks it.
      if(pick<0)for(let i=0;i<n;i++)if(!done[i]&&(pick<0||depth[i]<depth[pick]))pick=i;
      done[pick]=true;out.push(items[pick]);
      for(const j of next[pick])need[j]--;
    }
    if(out.length!==painted.length||out.some((it,i)=>it!==painted[i])){out.forEach(it=>scene.appendChild(it.g));painted=out;}
  }

  // One machined slab: a squared intake bay, a 45° shoulder into the channel, the hold arm off
  // the gate's approach, and the production yard. Every corner is a chamfer cut.
  const W=24, B=46;
  const outline=[[-172,-B],[-104,-B],[-82,-W],[184,-W],[194,-34],[276,-34],[276,34],[194,34],[184,W],[100,W],
    [100,132],[46,132],[46,W],[-82,W],[-104,B],[-172,B]];
  const bank=fillet(outline,[8,3,3,3,3,8,8,3,3,4,8,8,4,3,3,8],1);
  mk("path",{d:poly(bank.map(([x,y])=>P(x,y,0))),class:"sil platform-bottom"},floor);
  const edgeFaces=bank.map((a,i)=>{const b=bank[(i+1)%bank.length];return front({nu:b[1]-a[1],nv:a[0]-b[0]});});
  const startEdge=edgeFaces.indexOf(false),sideRuns=[];let sideRun=[];
  for(let step=1;step<=bank.length;step++) {
    const i=(startEdge+step)%bank.length,a=bank[i],b=bank[(i+1)%bank.length];
    if(edgeFaces[i]){if(!sideRun.length)sideRun.push(a);sideRun.push(b);}
    else if(sideRun.length){sideRuns.push(sideRun);sideRun=[];}
  }
  if(sideRun.length)sideRuns.push(sideRun);
  mk("path",{d:sideRuns.map(run=>poly([...run.map(q=>P(...q,Z)),...run.toReversed().map(q=>P(...q,0))])).join(""),class:"platform-side"},floor);
  mk("path",{d:poly(bank.map(([x,y])=>P(x,y,Z))),class:"sil platform-top"},floor);

  // Floor markings: a hairline centre guide up to the gate, and painted lanes with flow chevrons:
  // deferrals from the gate into the hold bay, released work back to the gate, and the main lane on.
  const lift=Z+.1, quad=(a,c,b,k)=>a.map((v,i)=>(1-k)**2*v+2*(1-k)*k*c[i]+k*k*b[i]);
  mk("path",{d:open([[-78,0],[88,0]].map(([x,y])=>P(x,y,lift))),class:"nf guide-rail"},floor);
  function lane(points,half,spacing,cls) {
    const at=[0];
    for(let i=1;i<points.length;i++)at.push(at[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
    const frame=i=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],l=Math.hypot(b[0]-a[0],b[1]-a[1]);
      return [(b[0]-a[0])/l,(b[1]-a[1])/l];};
    const side=(i,s)=>{const [tx,ty]=frame(i),q=points[i];return P(q[0]-ty*half*s,q[1]+tx*half*s,lift);};
    const edge=s=>open(points.map((_,i)=>side(i,s)));
    // Square stop bars close both ends, so every lane reads as a painted, finished marking.
    const caps=seg(side(0,1),side(0,-1))+seg(side(points.length-1,1),side(points.length-1,-1));
    mk("path",{d:edge(1)+edge(-1)+caps,class:`nf floor-edge ${cls}`},floor);
    let marks="";
    for(let d=spacing*.6;d<at.at(-1)-spacing*.3;d+=spacing) {
      const i=Math.max(1,at.findIndex(v=>v>=d)),k=(d-at[i-1])/(at[i]-at[i-1]);
      const q=[points[i-1][0]+(points[i][0]-points[i-1][0])*k,points[i-1][1]+(points[i][1]-points[i-1][1])*k],[tx,ty]=frame(i);
      const w=half*.62,back=2.4,tip=1.4;
      marks+=open([P(q[0]-tx*back-ty*w,q[1]-ty*back+tx*w,lift),P(q[0]+tx*tip,q[1]+ty*tip,lift),P(q[0]-tx*back+ty*w,q[1]-ty*back-tx*w,lift)]);
    }
    mk("path",{d:marks,class:`nf floor-mark ${cls}`},floor);
  }
  // The hold lanes sit 11 units either side of the arm and bay centreline (x = 73). The deferral
  // lane drops straight from the gate's queue into the bay; the release lane climbs back to it.
  function bend(a,corner,b,radius=10) {
    const toward=(p,q,d)=>{const l=Math.hypot(q[0]-p[0],q[1]-p[1]);return [p[0]+(q[0]-p[0])/l*d,p[1]+(q[1]-p[1])/l*d];};
    const straight=(p,q)=>{const n=Math.max(1,Math.round(Math.hypot(q[0]-p[0],q[1]-p[1])/2));return Array.from({length:n},(_,i)=>[p[0]+(q[0]-p[0])*i/n,p[1]+(q[1]-p[1])*i/n]);};
    const p1=toward(corner,a,radius),p2=toward(corner,b,radius);
    return [...straight(a,p1),...Array.from({length:9},(_,i)=>quad(p1,corner,p2,i/8)),...straight(p2,b).slice(1),b];
  }
  const LANE={y:12,into:84,out:62,bay:74};
  lane([[LANE.into,20],[LANE.into,46],[LANE.into,LANE.bay-2]],4.5,8,"hold-guide");
  // The release lane runs from the bay back to the gate, and lights up while a released batch moves.
  lane(bend([LANE.out,LANE.bay-2],[LANE.out,LANE.y],[LANE.into-6,LANE.y]),4.5,8,"release-guide");
  // The main lane: from the gate, under the ledger arch, onto dry ground, on the channel's axis.
  lane(Array.from({length:41},(_,i)=>[116+i*2,0]).concat([[198,0]]),5.5,8,"production-guide");
  const width=x=>x<=-104?B:x>=-82?W:B+(W-B)*(x+104)/22;
  // Lane dividers run straight through the bay and converge with the shoulder.
  for(const l of [-.6,-.2,.2,.6]) {
    const pts=[];
    for(let x=-166;x<=-80;x+=2)pts.push(P(x,l*(width(x)-8),lift));
    mk("path",{d:open(pts),class:"nf flood-lane"},floor);
  }

  // The flood: five lanes squeezed by the shoulder, crowding as they reach the wall.
  const noise=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
  const flood=[];
  [-.8,-.4,0,.4,.8].forEach((l,lane)=>{
    const speed=.009+noise(lane+7)*.005;
    for(let i=0;i<6;i++)flood.push({l,speed,phase:(i+noise(lane*6+i+61)*.35)/6,wave:noise(lane*6+i+91)*6.28,
      block:block(7+noise(lane*6+i+1)*2,5.5+noise(lane*6+i+31)*1.2,3,{r:1.6,b:.5,cls:"flood-intent"})});
  });

  // Admission: one bounded tray. Scheduler: three lanes divided by fins.
  const admission=block(30,32,3,{r:3,b:1.2}).at(-60,-16,Z);
  const scheduler=block(36,42,2.5,{r:3,b:1.2}).at(-16,-21,Z);
  const fins=[-6.6,5.4].map(y=>block(32,1.2,5,{r:.6,crease:false}).at(-14,y,Z+2.5));
  // Gate: a sluice, two posts and a crown with a shutter that lifts between them.
  const posts=[-26,20].map(y=>block(8,6,42,{r:1.5,crease:false}).at(100,y,Z));
  const shutter=block(5,40,14,{r:1.5,b:.8});
  const crown=block(14,56,6,{r:2,b:.8}).at(97,-28,Z+42);
  // Ledger: a lower arch whose stamp head presses each passing change; the chain rides on top.
  const arch=[-24,20].map(y=>block(6,4,28,{r:1.2,crease:false}).at(154,y,Z));
  const beam=block(12,52,5,{r:2,b:.8}).at(151,-26,Z+28);
  const head=block(8,12,4.5,{r:1.5,b:.7}), rod=block(2,2,1,{r:.8,crease:false});
  const receipts=Array.from({length:5},()=>block(8,7,2.5,{r:1.2,b:.6,cls:"ledger-record"}));
  const links=Array.from({length:4},()=>mk("path",{class:"nf ledger-chain-link"},above));
  // Production: dry ground. A low, sharp-edged pad that checked cartons flow onto in three lanes;
  // each arrival advances its lane, and the farthest carton ships off the far end.
  const pad=block(74,58,1.6,{r:5,b:1.6,cls:"production-destination"}).at(198,-29,Z);
  const top=Z+1.6, carton={w:12,h:11,d:8}, intent={w:9,h:7,d:3.5};
  const yard={x:211,step:19,depth:3,rows:[-15,0,15]};
  // Row guides painted on the pad: one bay per row, closed by a back stop at the far end.
  {
    const g=mk("path",{class:"nf floor-edge"},pad.g),L=(x,y)=>P(x-198,y+29,1.65);
    let d="";
    for(const y of [-22.5,-7.5,7.5,22.5])d+=seg(L(202,y),L(268,y));
    d+=seg(L(268,-22.5),L(268,22.5));
    g.setAttribute("d",d);
  }
  // The final run: off the arch, along the production lane, and onto the entry of its row.
  const toYard=(start,end,row)=>[end,[yard.x,yard.rows[row],Z],[[182,0,Z],[198,yard.rows[row]*.4,Z]]];
  // Hold: an open bay at the end of the arm, and a round push button in front of it.
  const bay=block(42,32,3,{r:3,b:1.2}).at(52,74,Z);
  const holdSlots=[0,1].flatMap(level=>[[67.5,85],[78.5,85],[67.5,95],[78.5,95]].map(([x,y])=>[x,y,Z+3+level*intent.d]));
  const heldCards=holdSlots.map(q=>block(intent.w,intent.h,intent.d,{cls:"held-intent"}).centre(...q));
  const button={x:73,y:120,top:Z+7};
  const disc=(R,z0,z1,cls)=>block(R*2,R*2,z1-z0,{r:R,n:12,b:.9,cls}).at(button.x-R,button.y-R,z0);
  disc(9.5,Z,Z+2);disc(7.5,Z+2,Z+5);
  const face=disc(8.5,Z+5,button.top,"release-button-face");
  const buttonText=mk("text",{class:"release-button-text","text-anchor":"middle","dominant-baseline":"central",
    "font-size":mobile?"5.6":"5.6","textLength":mobile?"12.5":"14","lengthAdjust":"spacingAndGlyphs"},above);
  buttonText.textContent="release";

  // Plates a card can cross: admission, scheduler, the hold bay and the dry-ground pad. A card rises
  // over a plate's lip within two units of travel, so it never cuts through a plate's edge.
  const plates=[[-60,-16,30,32,Z+3],[-16,-21,36,42,Z+2.5],[52,74,42,32,Z+3],[198,-29,74,58,top]];
  function surface(cx,cy,w,h) {
    let z=Z;
    for(const [x,y,pw,ph,pz] of plates) {
      const d=Math.min(cx+w/2-x,x+pw-cx+w/2,cy+h/2-y,y+ph-cy+h/2);
      if(d>0){const k=unit(d/2);z=Math.max(z,Z+(pz-Z)*k*k*(3-2*k));}
    }
    return z;
  }

  // Callouts attach at the midpoint of a station's edge, never a corner. A leader is a polyline
  // from that point; the label sits as a flag above its end, beside it, or below it.
  // Labels are sized in screen pixels, not drawing units: the shared 11px label (10px in the portrait
  // column), capped where the wide header row would start to collide.
  const LABEL_PX=mobile?10:11, LABEL_MAX=mobile?Infinity:6.6;
  let labelSize=mobile?6.4:5.6;
  const callouts=new Map();
  function callout(name,index,label,anchor,path,align,sub) {
    const a=P(...anchor),b=path.at(-1),g=mk("g",{class:"callout"},notes),size=labelSize;
    mk("path",{d:open([a,...path]),class:"nf callout-leader"},g);
    mk("ellipse",{cx:a[0].toFixed(2),cy:a[1].toFixed(2),rx:"1.3",ry:"1.3",class:"callout-dot"},g);
    const place={flag:[b[0],b[1]-3,"start","auto"],right:[b[0]+3,b[1],"start","central"],
      left:[b[0]-3,b[1],"end","central"],below:[b[0],b[1]+size+1.5,"middle","auto"]}[align];
    const text=mk("text",{x:place[0].toFixed(2),y:place[1].toFixed(2),"font-size":String(size),"text-anchor":place[2],"dominant-baseline":place[3]},g);
    if(index)mk("tspan",{class:"callout-index"},text).textContent=`${index} `;
    mk("tspan",{},text).textContent=label.toUpperCase();
    if(sub) {
      // The secondary line sits under the flag's rule, beside the leader.
      const [x,y]=align==="flag"?[b[0]+3,b[1]+size+1.5]:[place[0],place[1]+size*1.3];
      mk("text",{class:"callout-sub",x:x.toFixed(2),y:y.toFixed(2),"font-size":String(size),"text-anchor":align==="flag"?"start":place[2],
        "dominant-baseline":place[3]},g).textContent=sub.toUpperCase();
    }
    callouts.set(name,g);
  }
  function drawCallouts() {
  notes.replaceChildren();callouts.clear();
  if(mobile) {
    // One aligned column to the right of the portrait drawing.
    const column=Math.max(...bank.map(q=>P(...q,Z+18)[0]))+8;
    const aside=(name,index,label,q,sub)=>callout(name,index,label,q,[[column,P(...q)[1]]],"right",sub);
    aside("intents","01","Intents",[-138,-B,Z],"Flood");
    aside("admission","02","Admission",[-45,-16,Z+3]);
    aside("scheduler","03","Scheduler",[2,-21,Z+2.5]);
    aside("gate","04","Gate",[104,-26,Z+21]);
    aside("ledger","05","Ledger",[157,-26,Z+33]);
    aside("production","06","Production",[235,-29,top],"Dry ground");
    const hold=P(73,132,Z);callout("hold","","Hold",[73,132,Z],[[hold[0],hold[1]+22]],"below");
  } else {
    // The main line's labels share one header row; the leaders rise to it as flags.
    const row=Math.min(P(-172,0,Z)[1],P(104,-28,Z+48)[1])-18;
    const flag=(name,index,label,q,sub)=>callout(name,index,label,q,[[P(...q)[0],row]],"flag",sub);
    flag("intents","01","Intents",[-172,0,Z],"Flood");
    flag("admission","02","Admission",[-45,-16,Z+3]);
    flag("gate","04","Gate",[104,-28,Z+48]);
    flag("ledger","05","Ledger",[157,-26,Z+33]);
    flag("production","06","Production",[235,-29,top],"Dry ground");
    // The scheduler's leader drops off its near edge and turns out, clear of the deck.
    const sched=P(2,W-3,Z+2.5);
    callout("scheduler","03","Scheduler",[2,W-3,Z+2.5],[[sched[0],sched[1]+18],[sched[0]-22,sched[1]+18]],"left");
    const hold=P(73,132,Z);callout("hold","","Hold",[73,132,Z],[[hold[0],hold[1]+16]],"below");
  }
  }
  drawCallouts();

  // The cycle: three intents leave the flood and queue at the gate. Two are admitted; the near
  // lane's intent is deferred to the hold bay on one cycle and rejected on the next.
  const D=12000, lanes=[-13.5,0,13.5], trayY=[-10,0,10];
  const STAMP=[5900,7100], HOP=[7300,8500], ARRIVE=5600, ARCH=157, FRONT=LANE.into;
  const movers=lanes.map((_,lane)=>{
    const b=checked(block(intent.w,intent.h,intent.d,{r:1.2,b:.5,cls:"cycle-intent"}));
    b.s.sil.classList.add("hi");return {lane,block:b,cycle:-1};
  });
  let held=resume?.held??4, completed=resume?.completed??0, records=0, lastAppend=-Infinity, pullAt=-Infinity, jobs=[];
  const rows=yard.rows.map(()=>[]), shipped=[];let turn=0;
  function carton$(row,pos) {
    const b=checked(block(intent.w,intent.h,intent.d,{r:1.2,crease:false,cls:"production-box"}));
    b.size(carton.w,carton.h,carton.d);b.check.setAttribute("opacity","1");
    return Object.assign(b,{row,pos:tween(pos,700),fade:tween(1,500)});
  }
  [2,3,1].forEach((count,row)=>{for(let pos=0;pos<count;pos++)rows[row].push(carton$(row,pos));});
  // Arrivals take the lanes in turn; the lane advances one place to clear its entry.
  function claim() {
    const row=turn++%rows.length,lane=rows[row];
    lane.forEach(box=>tset(box.pos,box.pos.to+1,elapsed,0));
    for(let i=lane.length-1;i>=0;i--)if(lane[i].pos.to>=yard.depth){const [box]=lane.splice(i,1);shipped.push(box);tset(box.fade,0,elapsed,250);}
    return {row};
  }
  function land({row}) {rows[row].unshift(carton$(row,0));}
  function appended(at) {records++;lastAppend=Math.max(lastAppend,at);}
  // Keys are [time, [x, y, z], via?]. A leg eases once from end to end and passes its via
  // points on a Catmull-Rom curve at even speed, so a route never stops at a corner.
  function curve(points) {
    const out=[points[0]];
    for(let i=0;i<points.length-1;i++) {
      const p0=points[Math.max(0,i-1)],p1=points[i],p2=points[i+1],p3=points[Math.min(points.length-1,i+2)];
      for(let k=1;k<=10;k++) {
        const t=k/10,t2=t*t,t3=t2*t;
        out.push(p1.map((_,n)=>.5*(2*p1[n]+(p2[n]-p0[n])*t+(2*p0[n]-5*p1[n]+4*p2[n]-p3[n])*t2+(3*p1[n]-p0[n]-3*p2[n]+p3[n])*t3)));
      }
    }
    return out;
  }
  function along(points,k) {
    const at=[0];
    for(let i=1;i<points.length;i++)at.push(at[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1],points[i][2]-points[i-1][2]));
    const d=k*at.at(-1);
    for(let i=1;i<points.length;i++)if(d<=at[i]||i===points.length-1)return mix(points[i-1],points[i],at[i]>at[i-1]?unit((d-at[i-1])/(at[i]-at[i-1])):1);
    return points.at(-1);
  }
  function track(keys,t) {
    if(t<=keys[0][0])return keys[0][1];
    for(let i=1;i<keys.length;i++) {
      const [t0,q0]=keys[i-1],[t1,q1,via]=keys[i];
      if(t>=t1)continue;
      const k=glide(unit((t-t0)/Math.max(1,t1-t0)));
      return via?along(curve([q0,...via,q1]),k):mix(q0,q1,k);
    }
    return keys[keys.length-1][1];
  }
  const inTray=()=>held+jobs.filter(job=>!job.lifted).length;
  function plan(lane,cycle) {
    const y=lanes[lane], outcome=lane<2?"admit":cycle%2===0?"hold":"reject";
    // Heights here are the deck; surface() lifts a card over each plate it crosses.
    const keys=[[200+lane*450,[-88,y*.7,Z]],[1100+lane*450,[-45,trayY[lane],Z]],[1900+lane*250,[-45,trayY[lane],Z]],
      [2800+lane*250,[2,y,Z]],[3000+lane*150,[2,y,Z]]];
    keys.push([3900+lane*150,[FRONT,y,Z]]);
    // The gate defers it: the shutter stays down for it, and it drops down the hold lane.
    if(outcome==="hold")keys.push([4400,[FRONT,y,Z]],[ARRIVE,holdSlots[Math.min(7,inTray())],[[FRONT,26,Z],[FRONT,62,Z]]]);
    if(outcome==="reject")keys.push([4500,[FRONT,y,Z]],[5200,[FRONT-2,y+2,Z-2]]);
    if(outcome==="admit")keys.push([4300+lane*200,[FRONT,y,Z]]);
    // Admitted work merges onto the main lane past the gate.
    if(lane===0)keys.push([STAMP[0],[ARCH,0,Z],[[114,y,Z],[130,0,Z]]]);
    if(lane===1)keys.push([5600,[120,0,Z],[[112,0,Z]]],[6600,[120,0,Z]],[STAMP[1],[ARCH,0,Z]]);
    if(lane<2)keys.push([STAMP[lane]+800,[ARCH,0,Z]]);
    return {outcome,keys,stamp:STAMP[lane],hop:HOP[lane]};
  }
  // Recording morphs an intent into a checked carton.
  function record(b,age) {
    const k=age<0?0:ease(unit(age/600));
    b.state("is-recording",age<0&&age>=-800);
    b.state("recorded-intent",age>=0);
    // A finished carton has a clean lid: the intent's crease gives way to the check.
    if(b.s.cr.style.opacity!==(age>=0?"0":""))b.s.cr.style.opacity=age>=0?"0":"";
    b.size(intent.w+(carton.w-intent.w)*k,intent.h+(carton.h-intent.h)*k,intent.d+(carton.d-intent.d)*k);
    b.check.setAttribute("opacity",unit(k*2-1).toFixed(2));
  }
  // A release reserves its pass through the gate and its stamp outside the automatic batch,
  // and leaves the arm clear while overflow is arriving. Leaving the bay to the stamp takes 2.7s.
  const LEAD=2700, GATE=1400;
  function free(s,taken) {
    const start=s-LEAD,g=s-GATE;
    for(let cycle=Math.floor(s/D)-1;cycle<=Math.floor(s/D)+1;cycle++) {
      const a=cycle*D;
      if(s+1400>a+5200&&s-500<a+9400)return false;
      if(g+1600>a+3600&&g<a+5600)return false;
      if(cycle%2===0&&g>a+4200&&start<a+ARRIVE+100)return false;
    }
    return taken.every(other=>Math.abs(other-s)>=1700);
  }
  function release() {
    if(paused&&!reducedMotion()||jobs.length)return;
    const count=Math.min(2,held);if(!count)return;
    pullAt=elapsed;
    const taken=[],visible=Math.min(holdSlots.length,inTray());
    for(let j=0;j<count;j++) {
      let s=Math.max(elapsed+LEAD+300,(taken.at(-1)??-Infinity)+1700);
      while(!free(s,taken))s+=100;
      taken.push(s);
      const slot=holdSlots[Math.max(0,visible-1-j)];
      const b=checked(block(intent.w,intent.h,intent.d,{r:1.2,b:.5,cls:"deferred-intent human-released-intent"})).centre(...slot,0);
      jobs.push({block:b,slot,s,start:s-LEAD,gate:s-GATE,lifted:false,claim:null,stamped:false});
    }
    held-=count;render();loop.wake();
  }

  const stations={admission:[admission],scheduler:[scheduler,...fins],gate:[shutter,crown,...posts],
    hold:[bay],ledger:[beam,head,...arch],production:[pad]};
  let elapsed=0, paused=false, selected=null, pinned=null, breadcrumb="", holdStatus="";
  function render() {
    const reduced=reducedMotion(), cycle=Math.floor(elapsed/D), t=reduced?6100:elapsed-cycle*D;
    flood.forEach(f=>{
      const u=reduced?f.phase:((f.phase+elapsed*f.speed/82)%1+1)%1, x=-166+82*(.75*u+.25*(1-(1-u)**2));
      f.block.centre(x,f.l*(width(x)-8)+(reduced?0:.6*Math.sin(elapsed*.0016+f.wave)),Z,reduced?1:Math.min(1,u/.08,(1-u)/.08));
    });

    movers.forEach(m=>{
      if(m.cycle!==cycle){m.cycle=cycle;m.claim=null;m.landed=m.stamped=m.arrived=false;}
      const p=plan(m.lane,cycle),b=m.block;
      let q=track(p.keys,t),opacity=unit((t-p.keys[0][0])/250);
      b.state("deferred-intent",p.outcome==="hold"&&t>=4300);
      b.state("rejected-intent",p.outcome==="reject"&&t>=4200);
      if(reduced&&p.outcome!=="admit")opacity=0;
      if(p.outcome==="reject")opacity*=1-unit((t-4600)/600);
      if(p.outcome==="hold"&&t>=ARRIVE){opacity=0;if(!m.arrived&&!reduced){m.arrived=true;held++;}}
      // Defer/reject decisions append receipts at the gate; admits append at the recording head.
      const receiptAt=p.outcome==="admit"?p.stamp+300:p.outcome==="hold"?4400:4500;
      if(t>=receiptAt&&!m.stamped&&!reduced){m.stamped=true;appended(cycle*D+receiptAt);}
      if(p.outcome==="admit") {
        record(b,t-p.stamp-800);
        if(t>=p.stamp+800&&!reduced)m.claim??=claim();
        if(m.claim)q=track([[p.stamp+800,[ARCH,0,Z]],toYard(0,p.hop+800,m.claim.row)],t);
        if(t>=p.hop+800&&!reduced){opacity=0;if(!m.landed){m.landed=true;land(m.claim);}}
      } else record(b,-Infinity);
      b.centre(q[0],q[1],Math.max(q[2],surface(q[0],q[1],b.w,b.h)),opacity);
    });

    jobs.forEach(job=>{
      const b=job.block;
      if(reduced) {
        if(!job.stamped){job.stamped=true;appended(elapsed);}
        land(job.claim??claim());job.done=true;completed++;b.remove();return;
      }
      if(elapsed<job.start){b.centre(...job.slot,0);return;}
      job.lifted=true;
      // Out of the bay, up the release lane to the gate, through it once it lifts, then to the stamp.
      const s=job.s,g=job.gate,keys=[[job.start,job.slot],[job.start+300,[job.slot[0],job.slot[1],job.slot[2]+5]],
        [g,[FRONT,LANE.y,Z],[[LANE.out,66,Z],[LANE.out,22,Z],[LANE.out+10,LANE.y,Z]]],[g+500,[FRONT,LANE.y,Z]],
        [s,[ARCH,0,Z],[[116,6,Z]]],[s+800,[ARCH,0,Z]]];
      if(elapsed>=s+800)job.claim??=claim();
      if(job.claim)keys.push(toYard(0,s+2200,job.claim.row));
      let q=track(keys,elapsed);
      if(elapsed>=s+300&&!job.stamped){job.stamped=true;appended(s+300);}
      record(b,elapsed-s-800);
      b.state("deferred-intent",elapsed<s+800);
      b.state("human-released-intent",elapsed<s+800);
      if(elapsed>=s+2200){land(job.claim);job.done=true;completed++;b.remove();return;}
      b.g.dataset.releasePhase=elapsed<g+500?"transfer":elapsed<s?"gate":elapsed<s+800?"recording":"production";
      b.centre(q[0],q[1],Math.max(q[2],surface(q[0],q[1],b.w,b.h)),1);
    });
    jobs=jobs.filter(job=>!job.done);
    const tray=Math.min(holdSlots.length,inTray());
    heldCards.forEach((c,i)=>c.centre(...holdSlots[i],i<tray?1:0));

    // Production lanes advance by tween; a shipped carton fades as it leaves the pad.
    rows.forEach((lane,row)=>lane.forEach(box=>box.centre(yard.x+tval(box.pos,elapsed)*yard.step,yard.rows[row],top,1)));
    for(let i=shipped.length-1;i>=0;i--) {
      const box=shipped[i],alpha=tval(box.fade,elapsed);
      if(alpha<=.01){box.remove();shipped.splice(i,1);continue;}
      box.centre(yard.x+tval(box.pos,elapsed)*yard.step,yard.rows[box.row],top,alpha);
    }

    // Gate shutter lifts for the batch, then closes behind it; it lifts again for each released intent.
    const lift=u=>u<0?0:u<400?ease(u/400):u<1100?1:u<1600?1-ease((u-1100)/500):0;
    const lifted=reduced?0:Math.max(t<3800?0:t<4300?ease((t-3800)/500):t<5100?1:t<5600?1-ease((t-5100)/500):0,
      ...jobs.map(job=>lift(elapsed-job.gate)));
    shutter.at(101.5,-20,Z+lifted*27);
    // The stamp presses while a change sits under it; a new receipt slides onto the chain.
    const stamps=STAMP.map(s=>cycle*D+s).concat(jobs.map(job=>job.s));
    const live=stamps.find(s=>elapsed>=s&&elapsed<s+800),age=live===undefined?-1:elapsed-live;
    const press=reduced?1:age<0?0:age<180?ease(age/180):age<500?1:1-ease(unit((age-500)/300));
    const headZ=Z+20-press*15.5;
    head.at(ARCH-4,-6,headZ);rod.size(2,2,Z+28-headZ-4.5).at(ARCH-1,-1,headZ+4.5);
    beam.state("ledger-recording",age>=0);head.state("ledger-recording",age>=0);
    const appendAge=reduced?Infinity:elapsed-lastAppend, append=appendAge<900?ease(appendAge/900):1;
    const receiptY=i=>-17+(i-append)*9, receiptAlpha=i=>i===4?append:i===0?1-append:1;
    receipts.forEach((r,i)=>{
      r.at(ARCH-4,receiptY(i),Z+33+(i===4?6*(1-append):0),receiptAlpha(i));
      r.s.sil.classList.toggle("hi",appendAge<900&&i===4);
    });
    links.forEach((link,i)=>{
      const zTop=Z+35.5;
      link.setAttribute("d",seg(P(ARCH,receiptY(i)+3.5,zTop),P(ARCH,receiptY(i+1)+3.5,zTop)));
      link.setAttribute("opacity",Math.min(receiptAlpha(i),receiptAlpha(i+1)).toFixed(2));
    });

    // A short downstroke, held while the release dispatches, then a physical return.
    const busy=jobs.length>0, pressAge=elapsed-pullAt, holdUntil=Math.max(900,(jobs[0]?.start??pullAt)-pullAt+300);
    const pushed=reduced||!Number.isFinite(pullAt)?0:pressAge<180?ease(pressAge/180):pressAge<holdUntil?1:1-ease(unit((pressAge-holdUntil)/300));
    face.at(button.x-8.5,button.y-8.5,Z+5-pushed*1.5);
    const faceTop=P(button.x,button.y,button.top-pushed*1.5+.1);
    buttonText.setAttribute("transform",`matrix(1 0 0 ${(C.k*1.25).toFixed(3)} ${faceTop[0].toFixed(2)} ${faceTop[1].toFixed(2)})`);
    stage.classList.toggle("manual-release-active",busy);

    const status=JSON.stringify({count:held,available:Math.min(2,held),busy,paused:paused&&!reduced,completed,
      point:P(button.x,button.y,button.top),frame});
    if(status!==holdStatus){holdStatus=status;onHoldChange(JSON.parse(status));}
    stage.dataset.heldCount=String(held);
    stage.dataset.ledgerRecords=String(records);

    const phase=reduced?"intents":t<1900?"admission":t<3300?"scheduler":t<5200?"gate":t<7900?"ledger":t<9500?"production":"intents";
    if(stage.dataset.flowPhase!==phase)stage.dataset.flowPhase=phase;
    const current=selected??phase;
    // The current stage, whether the cycle reached it or the reader chose it, carries the bridge red.
    callouts.forEach((g,name)=>g.classList.toggle("is-active",name===current));
    Object.entries(stations).forEach(([key,list])=>list.forEach(b=>b.state("is-selected",key===current)));
    const crumb=current==="hold"?"gate":current;
    if(!paused&&breadcrumb!==crumb){breadcrumb=crumb;onStageChange(crumb);}
    paint();
  }
  const loop=register(stage,dt=>{
    if(paused||reducedMotion()){render();return false;}
    elapsed+=dt*1000;render();return true;
  });
  bag.add(loop.unregister);

  const centres={intents:[-125,0,Z],admission:[-45,0,Z+3],scheduler:[2,0,Z+4],gate:[104,0,Z+26],
    hold:[73,96,Z+4],ledger:[ARCH,0,Z+22],production:[234,0,top+6]};
  // A breadcrumb pin holds a station lit; hover previews another and leaving returns to the pin.
  // A preview also lapses once the pointer has rested for HOVER_REST, so a cursor parked on the
  // drawing never stalls the cycle.
  const HOVER_REST=2000;
  let rest=0;
  function choose(name) {
    clearTimeout(rest);
    if(name)rest=setTimeout(()=>choose(null),HOVER_REST);
    selected=name??pinned;
    render();
  }
  bag.add(()=>clearTimeout(rest));
  function hit([x,y]) {
    let best=null,distance=Infinity;
    for(const [name,q] of Object.entries(centres)){const p=P(...q),d=Math.hypot(x-p[0],y-p[1]);if(d<distance){distance=d;best=name;}}
    return distance<30?best:null;
  }
  // The kernel reports its fixed 400×320 canvas; map it into the fitted frame.
  if(!mobile)bag.add(pointer(stage,{move:p=>choose(hit([frame.x+p[0]*frame.width/400,frame.y+p[1]*frame.height/320])),leave:()=>choose(null)}));
  bag.add(()=>{svg.replaceChildren();stage.style.removeProperty("aspect-ratio");});
  render();
  function fitFrame() {
    const bounds=root.getBBox(),padding=mobile?10:12;
    frame={x:bounds.x-padding,y:bounds.y-padding,width:bounds.width+padding*2,height:bounds.height+padding*2};
    svg.setAttribute("viewBox",`${frame.x} ${frame.y} ${frame.width} ${frame.height}`);
    stage.style.aspectRatio=`${frame.width} / ${frame.height}`;
    stage.dataset.frame=`${frame.width.toFixed(1)}x${frame.height.toFixed(1)}`;
  }
  // Each pass resizes the labels for the current scale; refitting moves the scale a little, so a
  // couple of passes settle it.
  let fittedWidth=0;
  function settleLabels() {
    const width=svg.getBoundingClientRect().width;
    if(!width||Math.abs(width-fittedWidth)<.5)return;
    fittedWidth=width;
    for(let pass=0;pass<3;pass++) {
      const next=Math.min(LABEL_MAX,LABEL_PX*frame.width/width);
      if(Math.abs(next-labelSize)<.02)break;
      labelSize=next;drawCallouts();render();fitFrame();
    }
  }
  fitFrame();
  settleLabels();
  holdStatus="";render();
  let resizeFrame=0;
  const resizes=new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(settleLabels);});
  resizes.observe(stage);
  bag.add(()=>{resizes.disconnect();cancelAnimationFrame(resizeFrame);});
  return {release,set:()=>{},play:()=>{elapsed=0;render();loop.wake();},setPaused:v=>{paused=v;render();loop.wake();},pin:name=>{pinned=name;choose(name);},
    // A release in flight counts as delivered: it would finish before a rebuilt figure could show it.
    snapshot:()=>({held,completed:completed+jobs.filter(job=>!job.done).length}),destroy:bag.dispose};
}

hairline({name:"processing-line",means:"Intents pass admission, scheduling, and a policy gate; deferred work waits on hold, while the ledger precedes production.",
  rules:[1,3,4,5,6,7,8,9],range:[20,45,65],
  tour:[[204,147],[238,142],[216,215],[300,168],[360,170],null],
  labels:[], mount});
