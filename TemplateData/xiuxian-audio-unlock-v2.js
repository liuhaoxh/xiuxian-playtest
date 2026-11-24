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
  if(qa && toolbar && window.XiuxianIOSMedia){
    cuePicker=document.createElement("select");
    cuePicker.setAttribute("aria-label","Audio cue test");
    cuePicker.title="Standalone audio transport test (actual game assets)";
    const names=["weapon / 飞剑","gongfa / 功法发射","impact / 命中","hurt / 受伤","pickup / 拾取","layer / 境界","offer_open / 机缘打开","offer_pick / 机缘确认","campfire / 营火","boss_warning / 首领","victory / 胜利","defeat / 失败"];
    names.forEach((name,id)=>{const o=document.createElement("option");o.value=String(id);o.textContent=name;cuePicker.appendChild(o);});
    cuePicker.value="1";
    toolbar.appendChild(cuePicker);
  }
  function update() {
    const running = [...contexts].some(c => c.state === "running");
    button.textContent = running ? "试音" : "开启声音";
    button.setAttribute("aria-label", running ? "播放测试音效" : "开启声音");
  }
  function track(c) {
    contexts.add(c);
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
        applyMediaSession();
        window.XiuxianIOSMedia?.unlock();
      }
      unlock();
    }, {capture:true,passive:true});
  }
  document.addEventListener("visibilitychange", () => { applyMediaSession(); update(); });
  window.addEventListener("pageshow", () => { applyMediaSession(); update(); });
  button.addEventListener("click", async e => {
    if (!e.isTrusted) return;
    preferMediaSession = true;
    applyMediaSession();
    window.XiuxianIOSMedia?.unlock();
    await unlock();
    if(window.XiuxianIOSMedia) await window.XiuxianIOSMedia.ready();
    if (instance && [...contexts].some(c => c.state === "running")) {
      try { if(cuePicker) { if(!window.XiuxianIOSMedia.testCue(Number(cuePicker.value))) console.warn("[WebAudio] cue inventory changed; standalone check unavailable"); } else instance.SendMessage("Xiuxian_Audio","PlayWebSoundCheck",""); }
      catch (e) { console.warn("[WebAudio] test unavailable",e); }
    }
  });
  window.XiuxianWebAudio = { bind(value){instance=value;update();}, state(){return [...contexts].map(c=>c.state);}, session(){return {ios,supported:!!navigator.audioSession,type:navigator.audioSession?.type||null,state:navigator.audioSession?.state||null,requested:preferMediaSession};} };
})();
