/* iOS combat audio: decode once, schedule only AudioBufferSourceNodes.
 * Preserve the existing RunAudioSink semantic bridge. No per-cue media element,
 * decoder, fetch, seek, timer or per-cue analyser. Optional single stream output.
 */
(() => {
  "use strict";
  const ios=/iPhone|iPad|iPod/i.test(navigator.userAgent||"")||
    (/Mac/i.test(navigator.platform||"")&&navigator.maxTouchPoints>1);
  if(!ios)return;
  const q=new URLSearchParams(location.search), qa=q.get("audioqa")==="1";
  const bank=window.XiuxianWebCueBank;
  const names=["weapon","gongfa","impact","hurt","pickup","layer","offer_open","offer_pick","campfire","boss_warning","victory","defeat"];
  if(!Array.isArray(bank)||bank.length!==12||bank.some((b,i)=>b.name!==names[i]||!(b.duration>0)))
    throw new Error("iOS buffer bank mismatch");
  const buffers=new Array(12), rows=names.map(name=>({name,game:0,diagnostic:0,received:0,started:0,ended:0,failed:0,busy:0,notReady:0,muted:0,cancelled:0,isolatedPeak:0}));
  const active=new Set();
  let ctx=null,master=null,pickups=null,meter=null,stream=null,element=null;
  let preload=null,preloadError="",decoded=0,pcmBytes=0,mode="unselected",requested=false;
  let outputReady=false,activation=false,sessionSet=false,streamPromise=null,resumePromise=null;
  let volume=.65,muted=false,pickupMix=1,disabled=q.get("audio")==="off";
  let gameRequests=0,diagnosticRequests=0,decodeMs=0,mediaPlayCalls=0,maxActive=0;
  let scheduleMaxMs=0,scheduleTotalMs=0,scheduleCalls=0,peak=0;
  const timings=[],frames=[],longTasks=[];
  let lastFrame=0,raf=0,frameCount=0;
  function gains(){
    if(master){const v=muted||disabled?0:volume;if(master.gain.value!==v)master.gain.value=v;}
    if(pickups&&pickups.gain.value!==pickupMix)pickups.gain.value=pickupMix;
  }
  function setMix(v,m,p){
    v=Math.max(0,Math.min(1,Number(v)||0));m=!!m;p=Math.max(0,Math.min(1,Number(p)||0));
    if(v===volume&&m===muted&&p===pickupMix)return;
    volume=v;muted=m;pickupMix=p;gains();
  }
  function prepare(c){
    if(preload||disabled)return;
    const start=performance.now();
    // Only 12 tiny assets, at most two asynchronous decode jobs at a time.
    let index=0;
    async function worker(){
      while(index<bank.length){
        const i=index++,response=await fetch(new URL(bank[i].path,document.baseURI),{cache:"force-cache"});
        if(!response.ok)throw new Error("cue HTTP "+response.status+" "+names[i]);
        const data=await response.arrayBuffer();
        const b=await c.decodeAudioData(data);
        if(!b||!(b.duration>0)||b.duration>3)throw new Error("cue decode "+names[i]);
        buffers[i]=b;decoded++;pcmBytes+=b.length*b.numberOfChannels*4;
      }
    }
    preload=Promise.all([worker(),worker()]).then(()=>{decodeMs=performance.now()-start;return true;},
      err=>{preloadError=String(err?.message||err);console.warn("[BufferCue] preload",preloadError);return false;});
  }
  function attachContext(c){
    if(!c||ctx)return;
    ctx=c;master=c.createGain();pickups=c.createGain();
    pickups.connect(master);gains();prepare(c);
    if(qa){
      meter=c.createAnalyser();meter.fftSize=256;master.connect(meter);
      // Only one QA meter on the master bus; no timers per sound.
      const data=new Float32Array(meter.fftSize);
      function frame(t){
        if(document.visibilityState==="visible"){
          if(lastFrame&&frameCount>30){frames.push(t-lastFrame);if(frames.length>3600)frames.shift();}
          lastFrame=t;frameCount++;
          if(active.size){meter.getFloatTimeDomainData(data);let p=0;for(const n of data)p=Math.max(p,Math.abs(n));peak=Math.max(peak,p);if(active.size===1){const x=active.values().next().value;x.row.isolatedPeak=Math.max(x.row.isolatedPeak,p);}}
        }else lastFrame=0;
        raf=requestAnimationFrame(frame);
      }
      raf=requestAnimationFrame(frame);
      if(typeof PerformanceObserver==="function")try{
        new PerformanceObserver(list=>{for(const e of list.getEntries()){longTasks.push(e.duration);if(longTasks.length>100)longTasks.shift();}}).observe({type:"longtask",buffered:false});
      }catch(_){}
    }
  }
  function selectSession(){
    if(!navigator.audioSession)return false;
    try{
      if(navigator.audioSession.type!=="playback")navigator.audioSession.type="playback";
      sessionSet=navigator.audioSession.type==="playback";
      return sessionSet;
    }catch(e){console.warn("[BufferCue] AudioSession",e?.name||"denied");return false;}
  }
  function configureOutput(){
    if(mode!=="unselected")return;
    const requestedRoute=q.get("audioroute"), supported=selectSession();
    if(requestedRoute==="buffer"|| (requestedRoute!=="stream"&&supported)){
      master.connect(ctx.destination);mode="buffer";outputReady=true;return;
    }
    // One media stream carries the entire mixed PCM graph, never one player per cue.
    if(typeof ctx.createMediaStreamDestination==="function"){
      try{
        stream=ctx.createMediaStreamDestination();
        element=document.createElement("audio");element.playsInline=true;element.autoplay=false;
        element.srcObject=stream.stream;document.body.appendChild(element);
        master.connect(stream);mode="stream";return;
      }catch(e){console.warn("[BufferCue] stream unavailable",e?.name||"error");}
    }
    master.connect(ctx.destination);mode="buffer";outputReady=true;
  }
  function startOutput(){
    if(!element||streamPromise||(!element.paused&&outputReady))return;
    mediaPlayCalls++;
    try{
      streamPromise=Promise.resolve(element.play()).then(()=>{
        outputReady=document.visibilityState!=="hidden";
        if(!outputReady)element.pause();
      },e=>{outputReady=false;console.warn("[BufferCue] stream play",e?.name||"denied");})
        .finally(()=>{streamPromise=null;});
    }catch(e){outputReady=false;console.warn("[BufferCue] stream play",e?.name||"error");}
  }
  function unlock(){
    if(disabled||document.visibilityState==="hidden")return;
    requested=true;activation=true;
    if(!ctx){
      const C=window.AudioContext||window.webkitAudioContext;if(!C)return;
      attachContext(new C());
    }
    configureOutput();
    if(mode==="buffer" && navigator.audioSession && navigator.audioSession.type!=="playback")selectSession();
    if(ctx.state!=="running"&&ctx.state!=="closed"&&!resumePromise){
      try{resumePromise=Promise.resolve(ctx.resume()).catch(e=>console.warn("[BufferCue] resume",e?.name||"denied"))
        .finally(()=>{resumePromise=null;});}catch(e){console.warn("[BufferCue] resume",e?.name||"error");}
    }
    startOutput();
  }
  async function ready(){
    if(disabled)return false;
    const jobs=[preload,resumePromise,streamPromise].filter(Boolean);
    if(jobs.length)await Promise.allSettled(jobs);
    return !!ctx&&ctx.state==="running"&&outputReady&&decoded===12;
  }
  function finish(x,reason){
    if(!active.delete(x))return;
    x.node.onended=null;
    if(reason!=="ended"){try{x.node.stop();}catch(_){}}
    try{x.node.disconnect();}catch(_){}
    x.row[reason]++;
  }
  function reset(){
    for(const x of active)finish(x,"cancelled");
  }
  function play(id,diagnostic=false){
    id=Number(id);
    if(!Number.isInteger(id)||id<0||id>=12)return 0;
    const row=rows[id];row.received++;
    if(diagnostic){row.diagnostic++;diagnosticRequests++;}else{row.game++;gameRequests++;}
    if(muted||disabled||volume<=0){row.muted++;return 0;}
    if(!ctx||ctx.state!=="running"||!activation||!outputReady||!buffers[id]||document.visibilityState==="hidden"){
      row.notReady++;return -2;
    }
    // Fixed cap. Keep two cast voices protected from dense pickup/hit bursts.
    let combat=0,nonCast=0,ui=0;
    for(const x of active){if(x.id<=5){combat++;if(x.id>1)nonCast++;}else ui++;}
    if((id<=5&&(combat>=6||(id>1&&nonCast>=4)))||(id>5&&ui>=4)){row.busy++;return -1;}
    const start=performance.now();
    let x=null,node=null;
    try{
      node=ctx.createBufferSource();node.buffer=buffers[id];
      node.connect(id===4?pickups:master);
      x={id,row,node};active.add(x);maxActive=Math.max(maxActive,active.size);
      node.onended=()=>finish(x,"ended");
      node.start(0);row.started++;
      return 1;
    }catch(e){
      if(x)finish(x,"failed");else{row.failed++;try{node?.disconnect();}catch(_){}}
      console.warn("[BufferCue] play",names[id],e?.name||"error");return -2;
    }finally{
      const ms=performance.now()-start;scheduleCalls++;scheduleTotalMs+=ms;scheduleMaxMs=Math.max(scheduleMaxMs,ms);
      if(qa){timings.push(ms);if(timings.length>1000)timings.shift();}
    }
  }
  function hide(){reset();if(element){element.pause();outputReady=false;}activation=false;lastFrame=0;}
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")hide();});
  window.addEventListener("pagehide",hide);
  function percentile(a,p){if(!a.length)return null;const b=a.slice().sort((x,y)=>x-y);return b[Math.min(b.length-1,Math.floor(p*b.length))];}
  function diagnostics(){return {enabled:true,backend:"decoded-buffer-v1",mode,sessionSet,context:ctx?.state||null,
    activation,outputReady,disabled,decoded,pcmBytes,decodeMs,preloadError,volume,muted,pickupMix,active:active.size,maxActive,
    gameRequests,diagnosticRequests,mediaElements:element?1:0,mediaPlayCalls,perCueMediaCalls:0,peak,
    scheduling:{calls:scheduleCalls,meanMs:scheduleCalls?scheduleTotalMs/scheduleCalls:0,maxMs:scheduleMaxMs,p95Ms:percentile(timings,.95)},
    frames:{samples:frames.length,p50Ms:percentile(frames,.5),p95Ms:percentile(frames,.95),longTasks:longTasks.length,maxTaskMs:longTasks.length?Math.max(...longTasks):0},
    rows:rows.map(r=>({...r}))};}
  window.XiuxianWebDirectAudio={attachContext,unlock,ready,play,reset,setMix,enabled:()=>true,diagnostics};
})();
