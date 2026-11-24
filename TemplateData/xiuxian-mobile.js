/* Browser host only. Unity owns all gameplay controls and UI. */
(function () {
  "use strict";
  const canvas = document.getElementById("unity-canvas");
  const host = document.getElementById("unity-container");
  const frame = document.getElementById("unity-fullscreen-container");
  if (!canvas || !host || !frame) throw new Error("Missing Unity host");
  const valid = v => ["auto", "keyboard", "touch"].includes(v);
  const query = new URLSearchParams(location.search);
  const key = "xiuxian.input.v1:" + new URL(".", location.href).pathname;
  let saved = null;
  try { saved = localStorage.getItem(key); } catch (_) {}
  let mode = valid(query.get("input")) ? query.get("input") : valid(saved) ? saved : "auto";
  if (!query.has("input") && query.get("xiuxianQa") === "1" && query.get("ui") === "mobile") mode = "touch";
  const coarse = window.matchMedia("(pointer: coarse)");
  const fine = window.matchMedia("(pointer: fine)");
  function handheld() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1 && !fine.matches) ||
      (navigator.maxTouchPoints > 0 && coarse.matches && !fine.matches);
  }
  function touch() { return mode === "touch" || (mode === "auto" && handheld()); }
  let epoch = 0;
  function reset() { epoch++; }
  const style = document.createElement("style");
  style.textContent = `
    html, body { margin:0; height:100%; background:#10191a; color:#d9e1db; font:14px system-ui,sans-serif; }
    #unity-canvas { touch-action:none; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; }
    #unity-container.xiuxian-host { display:flex; flex-direction:column; gap:6px; }
    #unity-container.xiuxian-host:not(.xiuxian-handheld) { width:min(960px,98vw,calc((100dvh - 90px)*16/9)); }
    #unity-container.xiuxian-host:not(.xiuxian-handheld) #unity-fullscreen-container { width:100%!important; height:auto!important; aspect-ratio:16/9; }
    #unity-container.xiuxian-host.xiuxian-handheld { position:fixed!important; inset:0!important; transform:none!important; width:100%!important; height:100dvh!important; height:100svh; box-sizing:border-box; align-items:center; justify-content:center; gap:0; }
    .xiuxian-handheld #unity-fullscreen-container { width:100%!important; height:auto!important; flex:1 1 auto; min-height:0; }
    .xiuxian-handheld #unity-footer { display:none!important; }
    #xiuxian-input-toolbar { display:flex; flex:none; align-items:center; justify-content:center; gap:8px; padding:4px max(8px,env(safe-area-inset-right)) max(4px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left)); min-height:32px; box-sizing:border-box; }
    #xiuxian-input-toolbar select { color:#e2ede5; background:#263536; border:1px solid #60756e; border-radius:4px; padding:4px; font:inherit; }
    #xiuxian-input-status { font-size:12px; color:#c4d4c9; }
    @media (orientation:portrait) { .xiuxian-handheld #unity-fullscreen-container { flex:none; aspect-ratio:16/9; } }
    #unity-fullscreen-container:fullscreen { width:100%!important; height:100%!important; aspect-ratio:auto!important; }
  `;
  document.head.appendChild(style);
  host.classList.add("xiuxian-host");
  const toolbar = document.createElement("div");
  toolbar.id = "xiuxian-input-toolbar";
  const label = document.createElement("label");
  label.htmlFor = "xiuxian-input-mode"; label.textContent = "操作方式";
  const select = document.createElement("select");
  select.id = "xiuxian-input-mode";
  [["auto","自动"],["keyboard","键鼠"],["touch","触屏"]].forEach(([value,text]) => {
    const option=document.createElement("option"); option.value=value; option.textContent=text; select.appendChild(option);
  });
  select.value=mode;
  const status=document.createElement("span"); status.id="xiuxian-input-status"; status.setAttribute("aria-live","polite");
  toolbar.append(label,select,status); host.appendChild(toolbar);
  const probe=document.createElement("div");
  probe.setAttribute("aria-hidden","true");
  probe.style.cssText="position:fixed;inset:0;pointer-events:none;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);";
  document.body.appendChild(probe);
  function layout() {
    host.classList.add("xiuxian-host");
    host.classList.toggle("xiuxian-handheld",handheld() || touch());
    status.textContent=(touch() ? "触屏" : "键鼠") + ((handheld() || touch()) && innerHeight>innerWidth ? " · 建议横屏" : "");
  }
  function insets() {
    const r=canvas.getBoundingClientRect(), p=getComputedStyle(probe);
    const n=v=>parseFloat(v)||0;
    if (r.width<=0 || r.height<=0) return [0,0,0,0];
    const l=Math.max(0,n(p.paddingLeft)-r.left)/r.width;
    const t=Math.max(0,n(p.paddingTop)-r.top)/r.height;
    const ri=Math.max(0,r.right-(innerWidth-n(p.paddingRight)))/r.width;
    const b=Math.max(0,r.bottom-(innerHeight-n(p.paddingBottom)))/r.height;
    return [l,t,ri,b].map(v=>Math.min(.24,Math.max(0,v)));
  }
  function setMode(value) {
    if (!valid(value)) return;
    mode=value; select.value=value;
    try { localStorage.setItem(key,value); } catch (_) {}
    try { const url=new URL(location.href); url.searchParams.set("input",value); history.replaceState(null,"",url); } catch (_) {}
    if (touch() && document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    reset(); layout();
  }
  select.addEventListener("change",()=>{setMode(select.value);canvas.focus();});
  // Browser-owned cancellation/reset events; normal pointer-up remains owned by uGUI.
  canvas.addEventListener("pointercancel",reset);
  window.addEventListener("blur",reset);
  window.addEventListener("pagehide",reset);
  window.addEventListener("resize",()=>{reset();layout();});
  document.addEventListener("visibilitychange",reset);
  document.addEventListener("fullscreenchange",()=>{reset();layout();});
  [coarse,fine].forEach(m=>{if(m.addEventListener)m.addEventListener("change",()=>{reset();layout();});});
  window.XiuxianWebDevice={touch,handheld,insets,epoch:()=>epoch,setMode,mode:()=>mode};
  // The stock loader may set host.className synchronously after this script.
  layout();
  // Unity's stock template assigns className during boot; restore only our own classes.
  new MutationObserver(() => {
    if (!host.classList.contains("xiuxian-host") ||
        host.classList.contains("xiuxian-handheld") !== (handheld() || touch())) layout();
  }).observe(host,{attributes:true,attributeFilter:["class"]});
  requestAnimationFrame(layout);
})();
