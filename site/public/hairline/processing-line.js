/** The README's full control plane, with the hold branch off the policy gate. */
const { Cam, facing, fit, proj, rings, prism, fillet, poly, open, seg, solid, put, mk,
  pointer, register, disposer, reducedMotion, bezier } = HL;

function mount({stage,svg,onStageChange=()=>{},onHoldChange=()=>{}},value) {
  const mobile=matchMedia("(max-width: 600px)").matches;
  const terminalShift=32;
  const bag=disposer(), C=mobile?Cam(90,.65,1):Cam(45,.5,1);
  const timing={pause:1500,append:900,travel:3200,landing:650,settleLead:2200,rest:300,second:9600,duration:17000};
  let frame={x:0,y:0,width:400,height:320};
  fit(C,[[-160,-100,0],[200,115,0],[-160,115,0],[200,-100,0],[60,-25,66]],200,160);
  const deck={bottom:3,top:8,radius:6};
  const ground=proj(C), P=(x,y,z)=>ground(x,y,z+deck.top), front=facing(C), root=mk("g",{},svg);
  function plate(parent,box,z0,z1,r=3,crease=true) {
    const [ring,inner]=rings(...box,r,.65), s=solid(parent);
    put(s,prism(P,front,ring,inner,z0,z1));if(!crease)s.cr.remove();return s;
  }
  // Detached labels keep the camera's projected axes, with air around the drawing.
  function zoneLabel(text,point,u,v,size,kind="upright") {
    const a=P(0,0,0),b=P(...u),c=P(...v);
    const ul=Math.hypot(b[0]-a[0],b[1]-a[1]),vl=Math.hypot(c[0]-a[0],c[1]-a[1]);
    const label=mk("text",{class:`zone-label zone-label-${kind}`,"data-zone-label":text,
      "text-anchor":"middle","dominant-baseline":"central","font-size":String(size),
      transform:`matrix(${(b[0]-a[0])/ul} ${(b[1]-a[1])/ul} ${(c[0]-a[0])/vl} ${(c[1]-a[1])/vl} ${point[0]} ${point[1]})`},root);
    label.textContent=text.toUpperCase();return label;
  }
  function card(parent,x,y,z,w=10,h=9) {
    const group=mk("g",{},parent), body=plate(group,[x,y,x+w,y+h],z,z+4,2);
    let last="";
    function draw(X,Y,Z,depth=4,W=w,H=h) {
      const key=`${X},${Y},${Z},${depth},${W},${H}`; if(last===key)return; last=key;
      const [r,i]=rings(X,Y,X+W,Y+H,2,.5);
      put(body,prism(P,front,r,i,Z,Z+depth));
    }
    draw(x,y,z); return {body,draw,group};
  }
  function rails(points,width=8,kind="") {
    for(const side of [-1,1]) {
      const edge=points.map((q,i)=>{
        const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)];
        const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
        return ground(q[0]-side*dy/length*width/2,q[1]+side*dx/length*width/2,deck.top+.15);
      });
      mk("path",{d:open(edge),class:`nf guide-rail ${kind}`},root);
    }
  }
  function cartonMarks(parent) {
    const group=mk("g",{},parent),check=mk("path",{class:"nf production-check"},group),record=mk("path",{class:"nf production-record"},group);
    return {group,draw(x,y,z,w,h,d){
      const face=(u,v)=>P(x+w+.1,y+h*(1-u),z+d*v);
      const tile=(u0,v0,u1,v1)=>poly([face(u0,v0),face(u1,v0),face(u1,v1),face(u0,v1)]);
      if(mobile) {
        // The portrait camera sees the x face; the desktop check face is edge-on.
        check.setAttribute("d",open([face(.1,.56),face(.29,.33),face(.59,.8)]));
        record.setAttribute("d",tile(.68,.55,.89,.82)+tile(.74,.19,.95,.46)+seg(face(.79,.55),face(.85,.46)));
        return;
      }
      check.setAttribute("d",open([P(x+w*.12,y+h+.1,z+d*.6),P(x+w*.34,y+h+.1,z+d*.28),P(x+w*.76,y+h+.1,z+d*.9)]));
      record.setAttribute("d",tile(.19,.55,.64,.82)+tile(.35,.19,.8,.46)+seg(face(.43,.55),face(.59,.46)));
    }};
  }
  // One rounded Y footprint: broad intake, a narrow gate, two distinct banks.
  const outline=[[-149,-34],[64,-34],[142,-112],[228+terminalShift,-112],[228+terminalShift,-56],[160,-56],[107,0],
    [160,56],[228+terminalShift,56],[228+terminalShift,112],[142,112],[64,34],[-149,34]];
  const bank=fillet(outline,outline.map(()=>deck.radius));
  mk("path",{d:poly(bank.map(([x,y])=>ground(x,y,deck.bottom))),class:"sil platform-bottom"},root);
  const edgeFaces=bank.map((a,i)=>{const b=bank[(i+1)%bank.length];return front({nu:b[1]-a[1],nv:a[0]-b[0]});});
  const startEdge=edgeFaces.indexOf(false),sideRuns=[];let sideRun=[];
  for(let step=1;step<=bank.length;step++) {
    const i=(startEdge+step)%bank.length,a=bank[i],b=bank[(i+1)%bank.length];
    if(edgeFaces[i]){if(!sideRun.length)sideRun.push(a);sideRun.push(b);}
    else if(sideRun.length){sideRuns.push(sideRun);sideRun=[];}
  }
  mk("path",{d:sideRuns.map(run=>poly([...run.map(q=>ground(...q,deck.top)),...run.toReversed().map(q=>ground(...q,deck.bottom))])).join(""),class:"platform-side"},root);
  mk("path",{d:poly(bank.map(([x,y])=>ground(x,y,deck.top))),class:"sil platform-top"},root);
  // Inset workshop guides establish the two routes without floor arrows.
  rails([[-145,0],[57,0]],8);
  for(const side of [-1,1])rails([[78,0],[125,side*48],[177+terminalShift,side*84]],8,"release-guide");

  // Seeded variation keeps the flood irregular without changing on rerenders.
  const noise=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
  const flood=Array.from({length:48},(_,i)=>{
    const home=[-146+noise(i+1)*91,-28+noise(i+61)*54,8+noise(i+121)*7];
    return {home,card:card(root,...home,6+noise(i+181)*3,5+noise(i+241)*2),
      offset:noise(i+301)*91,speed:.014+noise(i+361)*.017,wave:noise(i+421)*Math.PI*2};
  });

  // Admission: a bounded tray, with a single intake slot and a compact queue.
  const admission=plate(root,[-49,-22,-17,22],0,10,3);
  for(let i=0;i<3;i++)card(root,-41,-11+i*7,11+i,14,10);

  // Scheduler: three resource lanes, each with its own waiting work.
  const scheduler=plate(root,[0,-22,38,22],0,10,3);
  for(const y of [-14,0,14]) {
    card(root,6+(y===0?12:0),y-4,11,10,8);
  }

  // A persistent, layered backlog remains behind the gate between releases.
  const backlog=[];
  for(let layer=0;layer<2;layer++)for(let i=0;i<6-layer*3;i++) {
    const q=[21+(i%3)*10+noise(i+layer*7)*2,-17+Math.floor(i/3)*19+noise(i+layer*13+1)*4,16+layer*6];
    backlog.push(q);
  }
  backlog.sort((a,b)=>a[0]+a[1]+a[2]-b[0]-b[1]-b[2]).forEach(q=>card(root,...q,8,7));
  const arrivals=Array.from({length:6},(_,i)=>{
    const target=backlog[(i*5)%backlog.length], period=4300+noise(i+501)*3700;
    const packet=card(root,0,0,0,8,7);packet.group.setAttribute("data-flow-kind","queue-arrival");
    return {card:packet,target,period,offset:noise(i+541)*period,delay:noise(i+581)*600};
  });

  // The next three queue up on top, then hand off to the released batch.
  const queueTargets=[[22,8,26],[24,9,33],[26,10,40]];
  const waiting=queueTargets.map(()=>card(root,0,0,0,10,8));
  waiting.forEach(c=>{c.body.sil.classList.add("hi");c.group.setAttribute("data-flow-kind","waiting");});

  // Gate: opaque posts and a retractable barrier across one controlled throat.
  plate(root,[61,-25,70,-20],0,46,1.5,false);
  const shutter=plate(root,[62,-19,69,19],20,25,2);
  const movers=Array.from({length:3},(_,i)=>({card:card(root,0,0,0,10,8),route:i===0?"hold":"production"}));
  movers.forEach(m=>{m.card.group.setAttribute("data-flow-route",m.route);m.card.body.sil.classList.add("hi");});
  const frontGate=plate(root,[61,20,70,25],0,46,1.5,false);
  movers.forEach((m,i)=>{
    if(i===0)return;
    m.badge=cartonMarks(m.card.group);m.marks=m.badge.group;m.marks.setAttribute("opacity","0");
  });
  const crown=plate(root,[58,-27,73,27],46,52,2);

  // Ledger: an append station, with an intake, recording head, and linked receipts.
  const ledgerOffset=[5,-5],origin=P(0,0,0),shift=P(...ledgerOffset,0);
  const ledgerStamp=[122+ledgerOffset[0],-43+ledgerOffset[1],12];
  const ledgerIntake=[103+ledgerOffset[0],-44+ledgerOffset[1],12];
  const ledgerTransform=`translate(${shift[0]-origin[0]} ${shift[1]-origin[1]})`;
  const ledgerBack=mk("g",{transform:ledgerTransform},root),ledgerFront=mk("g",{transform:ledgerTransform},root);
  root.insertBefore(ledgerBack,movers[0].card.group);
  const ledger=[plate(ledgerBack,[94,-62,134,-26],0,10,3)];
  ledger.push(plate(ledgerBack,[124,-57,132,-51],10,27,1.5,false));
  ledger.push(plate(ledgerFront,[122,-53,133,-33],24,28,2));
  const recordHead=plate(ledgerFront,[123,-43,131,-35],19,23,1.5);
  ledger.push(recordHead);
  // The visible chain is a moving window: each append adds a new linked tile.
  const receiptCount=4,receiptStep=9,receiptWidth=7,receiptOrigin=[99,-34,11];
  const receipts=Array.from({length:receiptCount},(_,i)=>card(ledgerFront,receiptOrigin[0]+i*receiptStep,receiptOrigin[1],receiptOrigin[2],receiptWidth,7));
  const chainLinks=Array.from({length:receiptCount-1},(_,i)=>mk("path",{d:seg(P(receiptOrigin[0]+i*receiptStep+receiptWidth,-31,13),P(receiptOrigin[0]+(i+1)*receiptStep,-31,13)),class:"nf ledger-chain-link"},ledgerFront));
  const writeLink=mk("path",{d:open([P(122,-43,17),P(122,-35,15),P(receiptOrigin[0]+(receiptCount-1)*receiptStep,-34,15)]),class:"nf ledger-write-link",opacity:"0"},ledgerFront);
  receipts.forEach(c=>{ledger.push(c.body);c.group.classList.add("ledger-record");});


  // A retained amber queue waits behind a manual-release stop; nothing auto-dispatches.
  const hold=plate(root,[154+terminalShift,60,200+terminalShift,106],0,10,3);
  root.insertBefore(hold.g,movers[0].card.group);
  const backstop=plate(root,[154+terminalShift,60,200+terminalShift,63],10,18,1.5);
  root.insertBefore(backstop.g,movers[0].card.group);
  const holdPositions=Array.from({length:8},(_,i)=>[(i%2===0?162:180)+terminalShift,i%2===0?87:73,11+Math.floor(i/2)*6]);
  const heldCards=holdPositions.map(q=>{
    const c=card(root,...q,10,8);c.group.classList.add("held-intent");return c;
  });
  // A round, raised push button beside Hold; its label lies on the top face.
  const consoleGroup=mk("g",{class:"release-console"},root);
  const [buttonX,buttonY]=[213+terminalShift,84];
  const buttonBounds=r=>[buttonX-r,buttonY-r,buttonX+r,buttonY+r];
  const buttonRadius=11.5,buttonTop=12,buttonShoulder=8;
  plate(consoleGroup,buttonBounds(10.5),0,3,10.5,false);
  plate(consoleGroup,buttonBounds(8.5),3,buttonShoulder,8.5,false);
  const buttonFace=plate(consoleGroup,buttonBounds(buttonRadius),buttonShoulder,buttonTop,buttonRadius);
  buttonFace.g.classList.add("release-button-face");
  const buttonText=mk("text",{class:"release-button-text","text-anchor":"middle","dominant-baseline":"central","font-size":"7","textLength":"19","lengthAdjust":"spacingAndGlyphs"},consoleGroup);
  buttonText.textContent="release";


  // Completed, checked changes remain above production across batch boundaries.
  const production=plate(root,[154+terminalShift,-106,200+terminalShift,-60],0,12,3);
  production.g.classList.add("production-destination");
  root.insertBefore(production.g,movers[0].card.group);
  const carton={w:15,h:mobile?17:11,d:10,step:10,base:12,slots:(mobile?[[162,-81],[182,-103]]:[[160,-78],[180,-100]]).map(([x,y])=>[x+terminalShift,y])};
  const produced=carton.slots.map(()=>Array.from({length:3},()=>{
    const c=card(root,0,0,0,carton.w,carton.h),badge=cartonMarks(c.group);
    c.draw(0,0,0,carton.d,carton.w,carton.h);
    badge.draw(0,0,0,carton.w,carton.h,carton.d);c.group.classList.add("production-box");
    return {card:c,badge};
  }));
  const receivedAt=[-Infinity,-Infinity];
  // Keep the arriving node: it becomes the top carton, rather than handing off to a copy.
  function landProduction(packet,column) {
    const retired=produced[column].shift();retired.card.group.remove();
    packet.card.group.classList.add("production-box");
    packet.card.group.classList.remove("human-released-intent","is-recording");
    packet.card.group.removeAttribute("data-flow-route");
    produced[column].push({card:packet.card,badge:packet.badge});
    receivedAt[column]=elapsed;
    return retired;
  }
  // Placement follows the annotated open-space composition; no name touches a solid.
  const uprightU=[0,-1,0],uprightV=[0,0,-1];
  const offset=(q,dx,dy)=>{const p=P(...q);return [p[0]+dx,p[1]+dy];};
  if(mobile) {
    zoneLabel("Flood of intents",offset([-145,0,15],0,-23),[0,-1,0],[1,0,0],10,"floor");
    zoneLabel("Admission",offset([-33,22,8],-54,0),uprightU,uprightV,10);
    zoneLabel("Scheduler",offset([19,22,8],-54,3),uprightU,uprightV,10);
    zoneLabel("Gate",offset([66,0,52],54,-5),uprightU,uprightV,10);
    zoneLabel("Ledger",offset([125,-39,16],40,-27),uprightU,uprightV,10);
    zoneLabel("Hold",offset([229+terminalShift,84,0],0,15),uprightU,uprightV,10);
    zoneLabel("Production",offset([229+terminalShift,-84,0],0,15),uprightU,uprightV,10);
    zoneLabel("Dry ground",offset([229+terminalShift,-84,0],0,29),uprightU,uprightV,8,"secondary");
  } else {
    zoneLabel("Flood of intents",offset([-104,-48,12],-4,-14),[1,0,0],[0,1,0],8,"floor");
    zoneLabel("Admission",offset([-33,44,0],-4,26),uprightU,uprightV,8);
    zoneLabel("Scheduler",offset([19,44,0],-2,30),uprightU,uprightV,8);
    zoneLabel("Gate",offset([66,0,52],35,-22),uprightU,uprightV,8);
    zoneLabel("Ledger",offset([129,-49,28],15,-16),uprightU,uprightV,8);
    zoneLabel("Hold",offset([178+terminalShift,128,0],0,17),uprightU,uprightV,8);
    zoneLabel("Production",offset([213+terminalShift,-84,0],16,30),uprightU,uprightV,8);
    zoneLabel("Dry ground",offset([213+terminalShift,-84,0],16,43),uprightU,uprightV,6.5,"secondary");
  }
  const names=["intents","admission","scheduler","gate","hold","ledger","production"];
  const centers=[P(-107,0,9),P(-34,0,12),P(18,0,12),P(66,0,32),P(177+terminalShift,84,14),P(125,-39,16),P(177+terminalShift,-84,20)];
  const ease=bezier(.32,.72,0,1), duration=timing.duration;
  const carryEase=bezier(.42,0,.28,1),landEase=bezier(.45,0,.55,1);
  function productionPose(destination,age) {
    const crossing=timing.travel-timing.landing;
    if(age>=crossing) {
      const k=landEase(Math.max(0,Math.min(1,(age-crossing)/timing.landing)));
      return [destination[0],destination[1],destination[2]+6*(1-k)];
    }
    const k=carryEase(Math.max(0,Math.min(1,age/crossing)));
    const q=ledgerStamp.map((v,n)=>v+(destination[n]+(n===2?6:0)-v)*k);
    q[2]+=5*Math.sin(Math.PI*k);return q;
  }
  let elapsed=0, paused=false, active=-1, drawnGate=NaN, drawnHead=NaN, breadcrumbStage="";
  let released=0, releaseCompleted=0, holdStatus="", visibleHeld=4, lastArrivals=4, pullAt=-Infinity;
  let lastReleasedStamp=-Infinity, lastReleaseStart=-Infinity;
  const releases=[];
  const arrivalsAt=time=>4+Math.max(0,Math.floor((time-6900)/duration)+1);
  const heldAt=time=>Math.max(0,arrivalsAt(time)-released);
  function release() {
    if(paused&&!reducedMotion()||releases.some(job=>!job.done))return;
    const count=Math.min(2,heldAt(elapsed),visibleHeld);if(!count)return;
    pullAt=elapsed;
    let start=elapsed+450,stampAt=start+2000;
    for(let i=0;i<count;i++) {
      // Reserve the head and leave the receiving column time to clear and settle.
      const column=i%2,phase=stampAt%duration;
      const columnRecordAt=column===0?6600:timing.second;
      const busyEnd=Math.max(timing.second+timing.pause,columnRecordAt+timing.settleLead+timing.rest);
      if(phase<busyEnd&&phase+timing.pause>4800)stampAt+=busyEnd-phase;
      const c=card(root,0,0,0,10,8),badge=cartonMarks(c.group);
      c.group.classList.add("deferred-intent","human-released-intent");c.group.setAttribute("data-flow-route","released");
      releases.push({card:c,badge,home:null,start,
        stampAt,landAt:stampAt+timing.pause+timing.travel,column,done:false});
      lastReleaseStart=start;
      start=stampAt+timing.pause+timing.travel+250;stampAt=start+2000;
    }
    released+=count;render();loop.wake();
  }
  function move(card,home,q,opacity=1) {
    const a=P(...home),b=P(...q);
    const pose=`translate(${(b[0]-a[0]).toFixed(2)} ${(b[1]-a[1]).toFixed(2)})`, alpha=opacity.toFixed(2);
    if(card.pose!==pose){card.pose=pose;card.group.setAttribute("transform",pose);}
    if(card.alpha!==alpha){card.alpha=alpha;card.group.setAttribute("opacity",alpha);}
  }
  function between(a,b,t) {const k=ease(Math.max(0,Math.min(1,t)));return a.map((v,i)=>v+(b[i]-v)*k);}
  function render() {
    const t=elapsed%duration, reduced=reducedMotion();
    const arrived=arrivalsAt(elapsed);
    if(arrived>lastArrivals){visibleHeld=Math.min(8,visibleHeld+arrived-lastArrivals);lastArrivals=arrived;}
    flood.forEach(m=>{
      const travel=reduced?m.offset:((m.offset+elapsed*m.speed+3*Math.sin(elapsed*.0011+m.wave))%91+91)%91;
      const q=[-146+travel,m.home[1]+(reduced?0:1.8*Math.sin(elapsed*.0017+m.wave)),m.home[2]];
      move(m.card,m.home,q,reduced?1:Math.min(1,travel/7,(91-travel)/7));
    });
    arrivals.forEach((m,i)=>{
      const age=reduced?m.period*.7:(elapsed+m.offset)%m.period, approach=2400+m.delay;
      const start=[-40+i%3*5,-14+(i%4)*8,19];
      const landing=[m.target[0],m.target[1],m.target[2]+5];
      const q=age<approach?between(start,landing,age/approach):landing;
      const opacity=reduced?.8:Math.min(1,age/250,(m.period-age)/600);
      move(m.card,[0,0,0],q,opacity);
    });
    const gateClosed=t<3400||t>=5300, closedAge=(t-5300+duration)%duration;
    let waitingCount=0;
    waiting.forEach((c,i)=>{
      const age=elapsed<3400?t:closedAge, delay=elapsed<3400?i*650:500+i*2500;
      const progress=(age-delay)/1200, visible=reduced||gateClosed&&progress>0;
      const q=reduced?queueTargets[i]:between([-38+i*5,-12+i*8,19],queueTargets[i],progress);
      move(c,[0,0,0],q,visible?Math.min(1,Math.max(0,progress)*5):0);
      if(visible&&progress>=1)waitingCount++;
    });
    if(stage.dataset.queueCount!==String(waitingCount))stage.dataset.queueCount=String(waitingCount);
    movers.forEach((m,i)=>{
      const cycle=Math.floor(elapsed/duration);
      if(m.landed) {
        if(cycle===m.cycle)return;
        m.card=m.spare.card;m.badge=m.spare.badge;m.marks=m.badge.group;
        m.card.group.classList.remove("production-box","recorded-intent");
        m.card.group.setAttribute("data-flow-route","production");
        m.card.body.sil.classList.add("hi");m.card.group.setAttribute("opacity","0");
        root.insertBefore(m.card.group,frontGate.g);
        m.landed=false;m.recorded=undefined;m.shape=undefined;
      }
      m.cycle=cycle;
      const queue=queueTargets[i],exit=[81+i*4,-9+i*7,14];
      const holdEnd=holdPositions[Math.min(7,visibleHeld)], input=[ledgerIntake[0]+(i-1)*6,ledgerIntake[1]+(i-1)*4,12], stamp=ledgerStamp;
      const recordAt=i===2?6600:timing.second, destination=[...carton.slots[i===2?0:1],carton.base+2*carton.step];
      let q=queue;
      if(reduced)q=i===0?holdEnd:destination;
      else if(t<3400)q=queue;
      else if(t<4800)q=between(queue,exit,(t-3400-(2-i)*140)/1000);
      else if(i===0)q=between(exit,holdEnd,(t-4800-200)/1900);
      else if(t<6200)q=between(exit,input,(t-4800-(2-i)*100)/1300);
      else if(t<recordAt)q=between(input,stamp,(t-recordAt+400)/400);
      else if(t<recordAt+timing.pause)q=stamp;
      else q=productionPose(destination,t-recordAt-timing.pause);
      if(i>0) {
        const recorded=!reduced&&t>=recordAt+timing.pause;
        if(m.recorded!==recorded){m.recorded=recorded;m.card.group.classList.toggle("recorded-intent",recorded);
          if(recorded)root.appendChild(m.card.group);else root.insertBefore(m.card.group,frontGate.g);}
        const morph=recorded?ease(Math.min(1,(t-recordAt-timing.pause)/550)):0, W=10+(carton.w-10)*morph,H=8+(carton.h-8)*morph,D=4+(carton.d-4)*morph;
        if(m.shape!==morph){m.shape=morph;m.card.draw(0,0,0,D,W,H);m.marks.setAttribute("opacity",Math.min(1,morph*2).toFixed(2));
          m.badge.draw(0,0,0,W,H,D);}
      } else m.card.group.classList.toggle("deferred-intent",t>=4800||reduced);
      m.card.group.classList.toggle("is-recording",i>0&&t>=recordAt&&t<recordAt+timing.pause);
      const landed=i>0&&t>=recordAt+timing.pause+timing.travel;
      const held=i===0&&t>=6900;
      const opacity=reduced?0:t<3400?0:held?0:Math.min(1,(duration-t)/700);
      move(m.card,[0,0,0],q,opacity);
      if(landed&&!reduced){m.spare=landProduction(m,i===2?0:1);m.landed=true;}
    });
    const heldCount=heldAt(elapsed);
    releases.forEach(job=>{
      if(job.done)return;
      const time=reduced?job.landAt:elapsed,depart=job.stampAt+timing.pause;
      if(time<job.start){job.card.group.setAttribute("opacity","0");return;}
      if(!job.home){job.home=holdPositions[Math.max(0,visibleHeld-1)];visibleHeld=Math.max(0,visibleHeld-1);}
      const stamp=ledgerStamp,input=ledgerIntake,junction=[87,13,16];
      let q=job.home;
      if(time<job.start)q=job.home;
      else if(time<job.start+1100)q=between(job.home,junction,(time-job.start)/1100);
      else if(time>=job.start+1100&&time<job.stampAt-400)q=between(junction,input,(time-job.start-1100)/500);
      else if(time<job.stampAt)q=between(input,stamp,(time-job.stampAt+400)/400);
      else if(time<depart)q=stamp;
      else q=productionPose([...carton.slots[job.column],carton.base+2*carton.step],time-depart);
      const recorded=time>=depart,morph=recorded?ease(Math.min(1,(time-depart)/550)):0;
      const W=10+(carton.w-10)*morph,H=8+(carton.h-8)*morph,D=4+(carton.d-4)*morph;
      job.card.group.classList.toggle("is-recording",time>=job.stampAt&&time<depart);
      job.card.group.classList.toggle("deferred-intent",!recorded);
      job.card.group.classList.toggle("recorded-intent",recorded);
      job.card.group.classList.toggle("human-released-intent",!recorded);
      job.card.draw(0,0,0,D,W,H);
      job.badge.draw(0,0,0,W,H,D);job.badge.group.setAttribute("opacity",String(Math.min(1,morph*2)));
      move(job.card,[0,0,0],q,1);
      job.card.group.dataset.releasePhase=time<job.stampAt?"transfer":time<depart?"recording":time<job.landAt?"production":"complete";
      if(time>=job.landAt){landProduction(job,job.column);job.done=true;releaseCompleted++;
        lastReleasedStamp=Math.max(lastReleasedStamp,job.stampAt+200);}
    });
    // The production columns now own landed cards; retain only live release jobs.
    for(let i=releases.length-1;i>=0;i--)if(releases[i].done)releases.splice(i,1);
    heldCards.forEach((c,i)=>c.group.setAttribute("opacity",i<visibleHeld?"1":"0"));
    stage.dataset.visibleHeldCount=String(visibleHeld);
    const busy=releases.some(job=>!job.done);
    stage.classList.toggle("manual-release-active",busy);
    // A short downstroke, held while dispatching, then a physical return.
    const pressAge=elapsed-pullAt,holdUntil=Math.max(900,lastReleaseStart-pullAt+500);
    const buttonPress=reduced||!Number.isFinite(pullAt)?0:pressAge<180?ease(pressAge/180):pressAge<holdUntil?1:1-ease(Math.min(1,(pressAge-holdUntil)/300));
    const top=buttonTop-buttonPress*1.5,[faceRing,faceInner]=rings(...buttonBounds(buttonRadius),buttonRadius,.65);
    put(buttonFace,prism(P,front,faceRing,faceInner,buttonShoulder,top));
    // Align the engraving across the face and optically open its vertical strokes.
    const origin=P(buttonX,buttonY,top+.2);
    buttonText.setAttribute("transform",`matrix(1 0 0 .85 ${origin[0]} ${origin[1]})`);
    stage.dataset.releasePress=buttonPress.toFixed(2);
    const status=JSON.stringify({count:heldCount,available:Math.min(2,heldCount,visibleHeld),busy,paused:paused&&!reduced,completed:releaseCompleted,point:P(buttonX,buttonY,buttonTop),frame});
    if(status!==holdStatus){holdStatus=status;onHoldChange(JSON.parse(status));}
    stage.dataset.releasedCount=String(released);
    stage.dataset.releaseCompleted=String(releaseCompleted);
    if(stage.dataset.heldCount!==String(heldCount))stage.dataset.heldCount=String(heldCount);
    const manualRecording=releases.find(job=>!job.done&&elapsed>=job.stampAt&&elapsed<job.stampAt+timing.pause);
    const recordAge=manualRecording?elapsed-manualRecording.stampAt:t>=timing.second&&t<timing.second+timing.pause?t-timing.second:t>=6600&&t<6600+timing.pause?t-6600:-1;
    const press=reduced||recordAge<0?0:recordAge<150?ease(recordAge/150):recordAge<timing.pause-300?1:1-ease(Math.min(1,(recordAge-timing.pause+300)/300));
    ledger[0].g.classList.toggle("ledger-recording",recordAge>=0);
    writeLink.setAttribute("opacity",!reduced&&recordAge>=200&&recordAge<timing.pause?"1":"0");
    const headZ=19-press*3.5;
    if(headZ!==drawnHead){drawnHead=headZ;const [r,i]=rings(123,-43,131,-35,2,.65);put(recordHead,prism(P,front,r,i,headZ,headZ+4));}
    const appendTimes=[5000,6800,timing.second+200], cycle=Math.floor(elapsed/duration);
    const recent=[...appendTimes.map(at=>cycle*duration+at),lastReleasedStamp,...releases.map(job=>job.stampAt+200)].filter(at=>Number.isFinite(at)&&at<=elapsed);
    const latest=recent.length?Math.max(...recent):undefined;
    const appending=!reduced&&latest!==undefined&&elapsed-latest<timing.append;
    const append=appending?ease((elapsed-latest)/timing.append):latest!==undefined?1:0;
    receipts.forEach((c,i)=>{
      const home=[receiptOrigin[0]+i*receiptStep,receiptOrigin[1],receiptOrigin[2]], q=[home[0]-append*receiptStep,home[1],home[2]+(i===receiptCount-1?7*(1-append):0)];
      move(c,home,q,i===receiptCount-1?append:i===0?1-append:1);
      c.body.sil.classList.toggle("hi",active===5||appending&&i===receiptCount-1);
    });
    chainLinks.forEach((link,i)=>{
      link.classList.toggle("is-appending",appending&&i===receiptCount-2);
      const dx=P(-append*receiptStep,0,0)[0]-P(0,0,0)[0],dy=P(-append*receiptStep,0,0)[1]-P(0,0,0)[1];
      link.setAttribute("transform",`translate(${dx} ${dy})`);
      link.setAttribute("opacity",i===receiptCount-2?append:i===0?1-append:1);
    });
    const count=Math.floor(elapsed/duration)*3+appendTimes.filter(at=>t>=at+timing.append).length+releaseCompleted+releases.filter(job=>elapsed>=job.stampAt+200+timing.append).length;
    if(stage.dataset.ledgerRecords!==String(count))stage.dataset.ledgerRecords=String(count);
    // Retire the bottom before the other two move; hold the empty top for arrival.
    produced.forEach((column,index)=>{
      const landedAt=(index===0?6600:timing.second)+timing.pause+timing.travel;
      const nextAuto=landedAt+(Math.floor((elapsed-landedAt)/duration)+1)*duration;
      const next=Math.min(nextAuto,...releases.filter(job=>!job.done&&job.column===index&&job.landAt>elapsed).map(job=>job.landAt));
      const remaining=next-elapsed,fadeEnd=next-timing.settleLead;
      const fadeStart=Math.max(next-timing.travel,receivedAt[index]);
      const fade=Math.max(0,Math.min(1,(fadeEnd-elapsed)/Math.max(1,fadeEnd-fadeStart)));
      const settle=reduced?0:ease(Math.max(0,Math.min(1,(timing.settleLead-remaining)/timing.landing)));
      column.forEach((box,level)=>{
        const [x,y]=carton.slots[index],z=carton.base+(level-(level>0?settle:0))*carton.step;
        move(box.card,[0,0,0],[x,y,z],reduced||level>0?1:fade);
      });
    });
    const lift=reduced?0:t<3000?0:t<3400?ease((t-3000)/400):t<4800?1:t<5300?1-ease((t-4800)/500):0;
    const z=20+lift*20;
    if(z!==drawnGate){drawnGate=z;const [r,i]=rings(62,-19,69,19,2,.65);put(shutter,prism(P,front,r,i,z,z+5));}
    const phase=reduced?"rest":t<2200?"admission":t<3400?"scheduler":t<4800?"gate":t<6200?"split":t<timing.second+timing.pause?"ledger":t<timing.second+timing.pause+timing.travel+500?"production":"recorded";
    if(stage.dataset.flowPhase!==phase)stage.dataset.flowPhase=phase;
    const selected=active<0?phase:names[active];
    const current={rest:"intents",split:"gate",hold:"gate",recorded:"production"}[selected]??selected;
    if(!paused&&breadcrumbStage!==current){breadcrumbStage=current;onStageChange(current);}
  }
  const loop=register(stage,dt=>{
    if(paused||reducedMotion()){render();return false;}
    elapsed+=dt*1000;render();return true;
  });
  bag.add(loop.unregister);
  function choose(next) {
    active=next;
    [admission,scheduler,shutter,hold,production].forEach(s=>s.sil.classList.remove("hi"));
    ledger.forEach(s=>s.sil.classList.remove("hi"));
    const selected={1:admission,2:scheduler,3:shutter,4:hold,6:production}[next];
    selected?.sil.classList.add("hi");
    if(next===5)ledger.forEach(s=>s.sil.classList.add("hi"));
    crown.sil.classList.toggle("hi",next<0);render();
  }
  function hit([x,y]) {
    let best=-1,distance=Infinity;
    centers.forEach((p,i)=>{const d=Math.hypot(x-p[0],y-p[1]);if(d<distance){distance=d;best=i;}});
    return distance<37?best:-1;
  }
  // The kernel reports its fixed 400×320 canvas; map it into the fitted frame.
  if(!mobile)bag.add(pointer(stage,{move:p=>choose(hit([frame.x+p[0]*frame.width/400,frame.y+p[1]*frame.height/320])),leave:()=>choose(-1)}));
  bag.add(()=>{svg.replaceChildren();stage.style.removeProperty("aspect-ratio");});choose(-1);
  {
    const bounds=root.getBBox(),padding=mobile?16:18;
    frame={x:bounds.x-padding,y:bounds.y-padding,width:bounds.width+padding*2,height:bounds.height+padding*2};
    svg.setAttribute("viewBox",`${frame.x} ${frame.y} ${frame.width} ${frame.height}`);
    stage.style.aspectRatio=`${frame.width} / ${frame.height}`;
    holdStatus="";render();
  }
  return {release,set:()=>{},play:()=>{elapsed=0;render();loop.wake();},setPaused:v=>{paused=v;render();loop.wake();},destroy:bag.dispose};
}

hairline({name:"processing-line",means:"Intents pass admission, scheduling, and a policy gate; deferred work waits on hold, while the ledger precedes production.",
  rules:[1,3,4,5,6,7,8,9],range:[20,45,65],
  tour:[[204,147],[238,142],[216,215],[300,168],[360,170],null],
  labels:[], mount});
