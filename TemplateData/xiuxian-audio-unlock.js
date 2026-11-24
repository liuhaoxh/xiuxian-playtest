/* Track only actual Unity-created AudioContexts. Do not synthesize a second audio system. */
(function () {
  "use strict";
  const contexts = new Set();
  const wrapped = new Map();
  let instance = null;
  const toolbar = document.getElementById("xiuxian-input-toolbar");
  const button = document.createElement("button");
  button.type = "button";
  button.id = "xiuxian-sound-check";
  button.textContent = "开启声音";
  button.title = "点击解锁浏览器音频并播放游戏音效";
  button.style.cssText = "font:inherit;color:#dce9e0;background:#263536;border:1px solid #60756e;border-radius:4px;padding:4px 9px;touch-action:manipulation;";
  toolbar?.appendChild(button);
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
    document.addEventListener(event, e => { if (e.isTrusted) unlock(); }, {capture:true,passive:true});
  }
  document.addEventListener("visibilitychange", update);
  window.addEventListener("pageshow", update);
  button.addEventListener("click", async e => {
    if (!e.isTrusted) return;
    await unlock();
    if (instance && [...contexts].some(c => c.state === "running")) {
      try { instance.SendMessage("Xiuxian_Audio","PlayWebSoundCheck",""); }
      catch (e) { console.warn("[WebAudio] test unavailable",e); }
    }
  });
  window.XiuxianWebAudio = { bind(value){instance=value;update();}, state(){return [...contexts].map(c=>c.state);} };
})();
