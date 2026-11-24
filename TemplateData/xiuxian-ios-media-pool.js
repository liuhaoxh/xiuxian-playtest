/* Standard Web iOS audio transport for Unity's compressed one-shot cues.
 * Reuse media element AND MediaElementAudioSourceNode. No extra audible backend.
 * Playback remains in Unity's channel gain graph. No continuous silent playback.
 */
(() => {
  "use strict";
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent || "") ||
    (/Mac/i.test(navigator.platform || "") && navigator.maxTouchPoints > 1);
  if (!ios) return;
  const LIMIT = 12;
  const slots = [];
  let context = null, firstUrl = "", activated = false;
  const stats = {created:0, primed:0, primeRejected:0, primeCancelled:0, borrowed:0, reused:0, released:0,
    attempts:0, started:0, ended:0, rejected:0, timedOut:0, exhausted:0, lastError:""};
  const clips = new Map();
  function make() {
    const el = new Audio();
    el.autoplay = false; el.preload = "auto"; el.playsInline = true;
    const node = context.createMediaElementSource(el);
    const slot = {el,node,owner:null,prime:false,authorized:false,uses:0};
    slots.push(slot); stats.created++;
    return slot;
  }
  function setSource(slot,url) {
    if (slot.el.src !== url) slot.el.src = url;
  }
  // Parse the MP4 movie duration before Safari has loaded the media metadata.
  // Unity's compressed getLength otherwise returns zero, making voice reuse
  // race the asynchronous media startup of very short casts.
  function durationHint(data) {
    try {
      const view = new DataView(data);
      function find(start,end,type) {
        for(let p=start;p+8<=end;){
          const size=view.getUint32(p),name=String.fromCharCode(view.getUint8(p+4),view.getUint8(p+5),view.getUint8(p+6),view.getUint8(p+7));
          if(size<8||p+size>end)return null;
          if(name===type)return [p+8,p+size];
          p+=size;
        }
        return null;
      }
      const moov=find(0,view.byteLength,"moov");if(!moov)return 0;
      const mvhd=find(moov[0],moov[1],"mvhd");if(!mvhd)return 0;
      const p=mvhd[0],version=view.getUint8(p);
      let scale=0,units=0;
      if(version===0&&p+20<=mvhd[1]){scale=view.getUint32(p+12);units=view.getUint32(p+16);}
      else if(version===1&&p+32<=mvhd[1]){scale=view.getUint32(p+20);units=view.getUint32(p+24)*4294967296+view.getUint32(p+28);}
      const seconds=scale?units/scale:0;
      return Number.isFinite(seconds)&&seconds>0&&seconds<3600?seconds:0;
    }catch(_){return 0;}
  }
  function register(ctx,url,data) {
    if (context && context !== ctx) {
      // The Unity context is normally persistent. Never reuse a node from another context.
      for (const s of slots) { s.owner?.release(); s.el.pause(); s.node.disconnect(); s.el.removeAttribute("src"); }
      slots.length=0; firstUrl=""; clips.clear(); activated=false;
    }
    context=ctx;
    if (!firstUrl) firstUrl=url;
    if (!clips.has(url)) clips.set(url,{duration:durationHint(data),attempts:0,started:0,ended:0,rejected:0});
  }
  function registerNamed(ctx,url,seconds) {
    register(ctx,url);
    if(!(seconds>0&&seconds<3600))throw new Error("Invalid cue duration");
    clips.get(url).duration=seconds;
  }
  function prime(slot,url) {
    if (slot.authorized || slot.owner || slot.prime || !firstUrl) return;
    slot.prime=true;
    const gain=context.createGain(); gain.gain.value=0;
    slot.node.connect(gain); gain.connect(context.destination);
    setSource(slot,url||firstUrl);
    let done=false, timer=null;
    function finish(ok,err) {
      if(done)return; done=true;
      if(timer!==null)clearTimeout(timer);
      slot.el.pause(); slot.node.disconnect(); gain.disconnect();
      slot.prime=false;slot.authorized=ok;slot.cancelPrime=null;
      if(ok)stats.primed++;else if(err?.name==="PrimeSuperseded")stats.primeCancelled++;else{stats.primeRejected++;stats.lastError=err?.name||"PrimeTimeout";}
    }
    slot.cancelPrime=()=>finish(false,{name:"PrimeSuperseded"});
    // This call must occur directly inside the trusted gesture; gain is zero only
    // during the one-shot authorization handshake.
    try {
      timer=setTimeout(()=>finish(false),1800);
      const p=slot.el.play();
      Promise.resolve(p).then(()=>finish(true),err=>finish(false,err));
    }catch(err){finish(false,err);}
  }
  function unlock(preferredUrls) {
    if(!context || !firstUrl || document.visibilityState==="hidden")return;
    activated=true;
    while(slots.length<LIMIT)make();
    const urls=preferredUrls?.length?preferredUrls:[...clips.keys()]; slots.forEach((slot,i)=>prime(slot,urls[i%urls.length]));
  }
  function borrow(ctx,url) {
    register(ctx,url);
    let slot=slots.find(s=>!s.owner&&!s.prime&&s.authorized&&s.el.src===url) || slots.find(s=>!s.owner&&!s.prime&&s.authorized) || slots.find(s=>!s.owner&&!s.prime);
    if(!slot && slots.length<LIMIT)slot=make();
    if(!slot){slot=slots.find(s=>!s.owner&&s.prime&&s.el.src===url)||slots.find(s=>!s.owner&&s.prime);if(slot)slot.cancelPrime?.();}
    if(!slot){stats.exhausted++;throw new Error("iOS media voice pool exhausted");}
    const el=slot.el, node=slot.node, counts=clips.get(url);
    let released=false, version=0, delay=null, stopTimer=null, watchdog=null;
    let onended=null, promise=null, pausedRequested=false, startOffset=0;
    stats.borrowed++; if(slot.uses++)stats.reused++;
    node.disconnect();
    el.pause(); el.onended=null; el.onerror=null; el.onplaying=null;
    el.loop=false; el.muted=false; el.playbackRate=1;
    setSource(slot,url);
    const source={mediaElement:el,isStopped:true,playbackRate:{},
      connect(...args){return node.connect(...args);},
      disconnect(...args){return node.disconnect(...args);},
      estimatePlaybackPosition(){return Number.isFinite(el.currentTime)?el.currentTime:0;},
      setPitch(value){if(!released && Number.isFinite(value)&&value>0){try{el.playbackRate=value;}catch(e){console.warn("[XiuxianIOSAudio] pitch unavailable",e.name);}}},
      _pauseMediaElement(){
        pausedRequested=true;
        // FMOD's start-paused/unpause setup can arrive before HTMLMediaElement.play()
        // has fulfilled. Pausing the native element here aborts short attack cues.
        if(promise===null && delay===null)el.pause();
      },
      isIosMediaPaused(){return pausedRequested || (promise===null && delay===null && el.paused);},
      start(when=ctx.currentTime,offset=0){
        if(released)return;
        // Unity can ask to resume the same media source while its first play()
        // is pending. Do not restart/seek a short cast a second time.
        if(promise!==null || delay!==null){
          // Resume the in-flight request, never seek/replay it.
          pausedRequested=false;return;
        }
        if(!pausedRequested && !el.paused && !source.isStopped)return;
        clearTimeout(delay);clearTimeout(watchdog);clearTimeout(stopTimer);
        delay=watchdog=stopTimer=null;pausedRequested=false;source.isStopped=false;
        const token=++version;startOffset=Math.max(0,Number.isFinite(offset)?offset:0);
        const current=()=>!released&&version===token&&slot.owner===source;
        const fail=(error,timeout=false)=>{
          if(!current())return;
          stats.rejected++;counts.rejected++;if(timeout)stats.timedOut++;
          stats.lastError=error?.name||"PlaybackError";
          if(error?.name==="NotAllowedError")slot.authorized=false;
          console.warn("[XiuxianIOSAudio] play failed:",stats.lastError);
          Promise.resolve().then(()=>finish(token,false));
        };
        function play(){
          delay=null;
          if(!current()||pausedRequested)return;
          stats.attempts++;counts.attempts++;
          // Do not set currentTime before metadata if starting at zero; a fresh
          // source is already at zero. A reused source must seek back to zero.
          try {
            if(el.readyState>0 || startOffset>0)el.currentTime=startOffset;
            el.onended=()=>finish(token,true);
            el.onerror=()=>fail({name:"MediaError"});
            watchdog=setTimeout(()=>{if(current()&&(promise!==null||el.paused||el.currentTime<=startOffset))fail({name:"PlaybackTimeout"},true);},2000);
            promise=Promise.resolve(el.play());
            promise.then(()=>{
              if(!current())return;
              promise=null;slot.authorized=true;stats.started++;counts.started++;
              source.onStarted?.();
              if(pausedRequested)el.pause();
              // Media element may promise success but stall. Keep a bounded
              // one-shot completion watchdog in addition to the ended event.
              clearTimeout(watchdog);
              const seconds=Number.isFinite(el.duration)?Math.max(0,el.duration-startOffset):1;
              if(!el.loop)watchdog=setTimeout(()=>{
                if(!current()||pausedRequested)return;
                if(el.ended || el.currentTime>startOffset)finish(token,true);
                else fail({name:"NoProgress"},true);
              },Math.max(1000,seconds/Math.max(.1,el.playbackRate)*1000+1200));
            },error=>fail(error));
          }catch(error){fail(error);}
        }
        const ms=Math.max(0,(when-ctx.currentTime)*1000);
        if(ms>4)delay=setTimeout(play,ms);else play();
      },
      stop(when=ctx.currentTime){
        if(released)return;
        const ms=Math.max(0,(when-ctx.currentTime)*1000);
        if(ms>4){clearTimeout(stopTimer);const token=version;stopTimer=setTimeout(()=>finish(token,false),ms);}
        else {++version;clearTimers();el.pause();source.isStopped=true;}
      },
      release(){
        if(released)return;
        released=true;++version;clearTimers();onended=null;
        el.onended=null;el.onerror=null;el.onplaying=null;
        el.pause();node.disconnect();
        // Keep source URL and native element permission for the next voice.
        if(slot.owner===source)slot.owner=null;
        stats.released++;
      }
    };
    function clearTimers(){clearTimeout(delay);clearTimeout(stopTimer);clearTimeout(watchdog);delay=stopTimer=watchdog=null;promise=null;}
    function finish(token,natural){
      if(released||version!==token||slot.owner!==source)return;
      ++version;clearTimers();el.pause();source.isStopped=true;
      source.completionReason=natural?"ended":"failed";
      if(natural){stats.ended++;counts.ended++;}
      const cb=onended;
      // Unity's callback synchronously disconnects and releases the voice.
      if(cb)cb();else source.release();
    }
    Object.defineProperties(source,{
      loop:{get:()=>el.loop,set:v=>{el.loop=!!v;}},
      mute:{get:()=>el.muted,set:v=>{el.muted=!!v;}},
      currentTime:{get:()=>el.currentTime,set:v=>{if(Number.isFinite(v))el.currentTime=v;}},
      onended:{get:()=>onended,set:v=>{onended=v;}},
      pauseRequested:{get:()=>pausedRequested,set:v=>{pausedRequested=!!v;}}
    });
    Object.defineProperty(source.playbackRate,"value",{get:()=>el.playbackRate,set:v=>source.setPitch(v)});
    slot.owner=source;
    return source;
  }
  async function ready() {
    const until=performance.now()+1800;
    while(performance.now()<until){
      if(slots.some(s=>!s.owner&&!s.prime&&s.authorized))return true;
      if(!slots.some(s=>s.prime))break;
      await new Promise(ok=>setTimeout(ok,25));
    }
    return slots.some(s=>!s.owner&&!s.prime);
  }
  // Explicit transport-only test: the game's twelve loaded media clips, not a synthetic beep.
  // Confirm the known cue order against the source duration manifest before labeling.
  function testCue(id){
    const urls=[...clips.keys()], expected=[.12,.20,.11,.23,.17,.48,.28,.22,.52,.80,.95,.80];
    if(!Number.isInteger(id)||id<0||id>=12||urls.length!==12||
       urls.some((u,i)=>Math.abs(clips.get(u).duration-expected[i])>.055))return false;
    const src=borrow(context,urls[id]),gain=context.createGain();
    gain.gain.value=.65;src.connect(gain);gain.connect(context.destination);
    src.onended=()=>{src.release();gain.disconnect();};
    src.start(context.currentTime,0);
    return true;
  }
  window.XiuxianIOSMedia={register,registerNamed,borrow,unlock,ready,testCue,duration(url){return clips.get(url)?.duration||0;},diagnostics(){return {...stats,limit:LIMIT,slots:slots.length,busy:slots.filter(s=>s.owner).length,
    authorized:slots.filter(s=>s.authorized).length,priming:slots.filter(s=>s.prime).length,activated,
    clips:[...clips.values()].map((c,i)=>({id:i,...c}))};}};
})();
