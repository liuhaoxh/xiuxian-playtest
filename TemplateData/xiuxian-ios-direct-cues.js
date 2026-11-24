/* iOS semantic cue backend. One named AAC bank, one bounded media pool, no
   FMOD channel scheduling for RunAudioSink cues. The Unity context is reused. */
(() => {
  "use strict";
  const ios=/iPhone|iPad|iPod/i.test(navigator.userAgent||"")||
    (/Mac/i.test(navigator.platform||"")&&navigator.maxTouchPoints>1);
  if(!ios)return;
  const bank=window.XiuxianWebCueBank;
  const pool=window.XiuxianIOSMedia;
  if(!bank||!pool||bank.length!==12)throw new Error("iOS cue bank unavailable");
  const names=["weapon","gongfa","impact","hurt","pickup","layer","offer_open","offer_pick","campfire","boss_warning","victory","defeat"];
  if(bank.some((b,i)=>b.name!==names[i]||!(b.duration>0)))throw new Error("iOS cue bank mismatch");
  const urls=bank.map(b=>new URL(b.path,document.baseURI).href);
  let ctx=null, master=null, volume=.65, muted=false, pickupMix=1, generation=0;
  let gestureSeen=false, contextOwned=false;
  const active=new Set();
  const rows=names.map(name=>({name,received:0,accepted:0,started:0,ended:0,failed:0,busy:0,notReady:0,muted:0,cancelled:0,game:0,diagnostic:0,peak:0}));
  let gameRequests=0, diagnosticRequests=0;
  function attachContext(c){
    if(!c || ctx===c)return;
    // Do not switch an already active graph to a later, unrelated audio context.
    if(ctx)return;
    ctx=c;master=ctx.createGain();master.connect(ctx.destination);
    for(let i=0;i<bank.length;i++)pool.registerNamed(ctx,urls[i],bank[i].duration);
    setMix(volume,muted,pickupMix);
  }
  function unlock(){
    gestureSeen=true;
    if(!ctx){
      const C=window.AudioContext||window.webkitAudioContext;
      if(!C)return;
      attachContext(new C());contextOwned=true;
    }
    if(ctx.state!=="running"&&ctx.state!=="closed")
      Promise.resolve(ctx.resume()).catch(e=>console.warn("[DirectCue] resume",e.name));
    pool.unlock(urls);
  }
  function setMix(v,m,p){
    volume=Math.max(0,Math.min(1,Number(v)||0));muted=!!m;
    pickupMix=Math.max(0,Math.min(1,Number(p)||0));
    if(master)master.gain.value=muted?0:volume;
    for(const x of active)if(x.id===4)x.gain.gain.value=pickupMix;
  }
  function finish(x,reason){
    if(!active.delete(x))return;
    clearInterval(x.meterTimer);x.source.release();x.gain.disconnect();
    if(x.analyser)x.analyser.disconnect();
    if(reason==="ended")x.row.ended++;
    else if(reason==="cancelled")x.row.cancelled++;
    else x.row.failed++;
  }
  function reset(){
    generation++;
    for(const x of [...active])finish(x,"cancelled");
  }
  function play(id,diagnostic=false){
    id=Number(id);
    if(!Number.isInteger(id)||id<0||id>=12)return 0;
    const row=rows[id];row.received++;
    if(diagnostic){row.diagnostic++;diagnosticRequests++;}else{row.game++;gameRequests++;}
    if(muted||volume<=0){row.muted++;return 0;}
    if(!ctx||ctx.state!=="running"||!gestureSeen||document.visibilityState==="hidden"){
      row.notReady++;return -2;
    }
    // Keep the original six combat/four UI budgets; reserve two of the six
    // combat slots for casts so pickup and impact bursts cannot starve them.
    const combat=id<=5, cast=id<=1;
    const group=[...active].filter(x=>(x.id<=5)===combat);
    if(group.length>=(combat?6:4) ||
       (combat&&!cast&&group.filter(x=>x.id>1).length>=4)){
      row.busy++;return -1;
    }
    let source,gain;
    try{source=pool.borrow(ctx,urls[id]);gain=ctx.createGain();}
    catch(e){row.busy++;return -1;}
    gain.gain.value=id===4?pickupMix:1;
    source.connect(gain);gain.connect(master);
    const x={id,row,source,gain,generation,meterTimer:null,analyser:null};
    active.add(x);row.accepted++;
    // Sample actual graph signal only in explicitly enabled QA mode.
    // This proves digital signal, not that the device speaker is audible.
    if(new URLSearchParams(location.search).get("audioqa")==="1"){
      const analyser=ctx.createAnalyser();analyser.fftSize=256;
      gain.connect(analyser);x.analyser=analyser;
      const data=new Float32Array(analyser.fftSize);
      x.meterTimer=setInterval(()=>{
        if(!active.has(x))return;
        analyser.getFloatTimeDomainData(data);
        let peak=0;for(const s of data)peak=Math.max(peak,Math.abs(s));
        row.peak=Math.max(row.peak,peak);
      },16);
    }
    source.onStarted=()=>{if(active.has(x))row.started++;};
    source.onended=()=>finish(x,source.completionReason||"failed");
    // Match the standalone cue that the user confirmed. Keep pitch fixed on
    // iOS short cues; native PC/WeChat pitch variation is unchanged.
    source.setPitch(1);
    source.start(ctx.currentTime,0);
    return 1;
  }
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")reset();});
  window.addEventListener("pagehide",reset);
  // Optional local-only diagnostic readout, useful on a real iPhone without devtools.
  if(new URLSearchParams(location.search).get("audioqa")==="1"){
    const toolbar=document.getElementById("xiuxian-input-toolbar");
    if(toolbar){
      const btn=document.createElement("button");btn.type="button";btn.textContent="Audio stats";
      btn.style.cssText="font:inherit;color:#dce9e0;background:#263536;border:1px solid #60756e;border-radius:4px;padding:4px 9px";
      btn.addEventListener("click",()=>{
        const d=window.XiuxianWebDirectAudio.diagnostics();
        const report=["iOS direct audio | "+d.context+" | gain "+d.volume.toFixed(2),
          "cue: game / diagnostic / started / ended / failed / busy / notReady",
          ...d.rows.map(r=>r.name+": "+[r.game,r.diagnostic,r.started,r.ended,r.failed,r.busy,r.notReady].join(" / ")),
          "pool "+d.pool.authorized+"/"+d.pool.limit+" authorized; "+d.active+" active"].join("\n");
        const dialog=document.createElement("div");dialog.setAttribute("role","dialog");
        dialog.style.cssText="position:fixed;inset:5%;z-index:5000;overflow:auto;padding:12px;background:#132221;color:#e0eee5;border:1px solid #90a090;font:13px monospace;white-space:pre-wrap";
        const close=document.createElement("button");close.type="button";close.textContent="Close";close.addEventListener("click",()=>dialog.remove());
        const pre=document.createElement("pre");pre.style.whiteSpace="pre-wrap";pre.textContent=report;dialog.append(close,pre);document.body.appendChild(dialog);
      });
      toolbar.appendChild(btn);
    }
  }
  window.XiuxianWebDirectAudio={attachContext,unlock,play,reset,setMix,enabled:()=>true,
    diagnostics:()=>({enabled:true,context:ctx?.state||null,contextOwned,gestureSeen,volume,muted,pickupMix,
      active:active.size,gameRequests,diagnosticRequests,rows:rows.map(r=>({...r})),pool:pool.diagnostics()})};
})();
