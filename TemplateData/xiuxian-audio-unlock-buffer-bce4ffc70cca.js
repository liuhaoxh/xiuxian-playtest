/* Track only actual Unity-created AudioContexts. Do not synthesize a second audio system. */
(function () {
  "use strict";
  const contexts = new Set();
  const wrapped = new Map();
  let instance = null;
  // CompressedInMemory is the default silent-mode path. Offer the explicit
  // media playback session as a second layer on supporting Apple devices.
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent || "") ||
    (/Mac/i.test(navigator.platform || "") && navigator.maxTouchPoints > 1);
  let preferMediaSession = false;
  function applyMediaSession() {
    if (!ios || !preferMediaSession || !navigator.audioSession ||
        document.visibilityState === "hidden") return false;
    try {
      if (navigator.audioSession.type !== "playback") navigator.audioSession.type = "playback";
      return navigator.audioSession.type === "playback";
    } catch (error) { console.warn("[WebAudio] session:",error?.name||"unsupported"); return false; }
  }
  const toolbar = document.getElementById("xiuxian-input-toolbar");
  const button = document.createElement("button");
  button.type = "button";
  button.id = "xiuxian-sound-check";
  button.textContent = "开启声音";
  button.title = "点击解锁浏览器音频并播放游戏音效";
  button.style.cssText = "font:inherit;color:#dce9e0;background:#263536;border:1px solid #60756e;border-radius:4px;padding:4px 9px;touch-action:manipulation;";
  toolbar?.appendChild(button);
  // Optional per-cue diagnostics use the actual game's RunAudioSink, not synthetic tones.
  const qa = new URLSearchParams(location.search).get("audioqa")==="1";
  let cuePicker=null;
  if(qa && toolbar && window.XiuxianWebDirectAudio){
    cuePicker=document.createElement("select");
    cuePicker.setAttribute("aria-label","Audio cue test");
    cuePicker.title="Game dispatch test (actual game audio cues)";
    const names=["weapon / 飞剑","gongfa / 功法发射","impact / 命中","hurt / 受伤","pickup / 拾取","layer / 境界","offer_open / 机缘打开","offer_pick / 机缘确认","campfire / 营火","boss_warning / 首领","victory / 胜利","defeat / 失败"];
    names.forEach((name,id)=>{const o=document.createElement("option");o.value=String(id);o.textContent=name;cuePicker.appendChild(o);});
    cuePicker.value="1";
    toolbar.appendChild(cuePicker);
  }
  function update() {
    const running = [...contexts].some(c => c.state === "running");
    const d=window.XiuxianWebDirectAudio?.diagnostics();
    button.textContent = d?.disabled ? "声音已关闭" : d && d.decoded<12 ? "音效加载中" : running ? "试音" : "开启声音";
    button.setAttribute("aria-label", running ? "播放测试音效" : "开启声音");
  }
  function track(c) {
    contexts.add(c);
    window.XiuxianWebDirectAudio?.attachContext(c);
    c.addEventListener("statechange", () => {
      if (c.state === "closed") contexts.delete(c);
      update();
    });
    update();
    return c;
  }
  for (const name of ["AudioContext","webkitAudioContext"]) {
    const C = window[name];
    if (typeof C !== "function") continue;
    try {
      if (!wrapped.has(C)) wrapped.set(C,new Proxy(C,{construct(t,args,n){return track(Reflect.construct(t,args,n));}}));
      window[name] = wrapped.get(C);
    } catch (e) { console.warn("[WebAudio] context instrumentation unavailable", name); }
  }
  function unlock() {
    const pending = [];
    for (const c of contexts) {
      if (c.state !== "running" && c.state !== "closed") {
        try { pending.push(Promise.resolve(c.resume()).catch(e => console.warn("[WebAudio] resume:",e?.name||"denied"))); }
        catch (e) { console.warn("[WebAudio] resume:",e?.name||"denied"); }
      }
    }
    return Promise.all(pending).then(update);
  }
  for (const event of ["pointerup","touchend","click","keydown"]) {
    document.addEventListener(event, e => {
      if (!e.isTrusted) return;
      if (ios && (e.target === document.getElementById("unity-canvas") || e.target === button)) {
        preferMediaSession = true;
        if(!window.XiuxianWebDirectAudio)applyMediaSession();
        window.XiuxianWebDirectAudio?.unlock();
      }
      if(!window.XiuxianWebDirectAudio)unlock();
    }, {capture:true,passive:true});
  }
  document.addEventListener("visibilitychange", () => { if(!window.XiuxianWebDirectAudio)applyMediaSession(); update(); });
  window.addEventListener("pageshow", () => { if(!window.XiuxianWebDirectAudio)applyMediaSession(); update(); });
  button.addEventListener("click", async e => {
    if (!e.isTrusted) return;
    preferMediaSession = true;
    if(!window.XiuxianWebDirectAudio)applyMediaSession();
    window.XiuxianWebDirectAudio?.unlock();
    if(!window.XiuxianWebDirectAudio) await unlock();
    if(window.XiuxianWebDirectAudio && !await window.XiuxianWebDirectAudio.ready()) { update(); return; }
    if (instance && [...contexts].some(c => c.state === "running")) {
      try { if(cuePicker) { instance.SendMessage("Xiuxian_Audio","PlayWebSoundCheck",String(cuePicker.value)); } else instance.SendMessage("Xiuxian_Audio","PlayWebSoundCheck",""); }
      catch (e) { console.warn("[WebAudio] test unavailable",e); }
    }
  });
  if(qa && toolbar && window.XiuxianWebDirectAudio){
    const stats=document.createElement("button");stats.type="button";stats.textContent="Audio stats";
    stats.style.cssText=button.style.cssText;
    stats.addEventListener("click",()=>{
      const d=window.XiuxianWebDirectAudio.diagnostics();
      const box=document.createElement("div");box.setAttribute("role","dialog");
      box.style.cssText="position:fixed;inset:5%;z-index:5000;overflow:auto;padding:12px;background:#132221;color:#e0eee5;border:1px solid #90a090;font:12px monospace;white-space:pre-wrap;";
      const close=document.createElement("button");close.textContent="关闭";close.addEventListener("click",()=>box.remove());
      const pre=document.createElement("pre");pre.style.whiteSpace="pre-wrap";
      pre.textContent=["route "+d.mode+" | AudioSession "+d.sessionSet+" | "+d.context,
        "decoded "+d.decoded+"/12 | gain "+d.volume.toFixed(3)+" | output "+d.outputReady,
        "per-cue media calls "+d.perCueMediaCalls+" | output play "+d.mediaPlayCalls,
        "schedule "+JSON.stringify(d.scheduling),"frame "+JSON.stringify(d.frames),
        "cue: game / test / started / ended / busy / notReady / failed",
        ...d.rows.map(r=>r.name+": "+[r.game,r.diagnostic,r.started,r.ended,r.busy,r.notReady,r.failed].join(" / "))].join("\n");
      box.append(close,pre);document.body.appendChild(box);
    });toolbar.appendChild(stats);
  }
  window.XiuxianWebAudio = { bind(value){instance=value;update();}, state(){return [...contexts].map(c=>c.state);}, session(){return {ios,supported:!!navigator.audioSession,type:navigator.audioSession?.type||null,state:navigator.audioSession?.state||null,requested:preferMediaSession};} };
})();
