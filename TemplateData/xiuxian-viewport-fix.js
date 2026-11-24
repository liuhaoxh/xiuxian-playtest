/* Handheld viewport geometry is owned exclusively by the host page. */
(() => {
  "use strict";
  const host=document.getElementById("unity-container"), frame=document.getElementById("unity-fullscreen-container"), canvas=document.getElementById("unity-canvas");
  if(!host||!frame||!canvas) return;
  const style=document.createElement("style");
  style.textContent=`
  html:has(#unity-container.xiuxian-handheld), body:has(#unity-container.xiuxian-handheld) { overflow:hidden;overscroll-behavior:none; }
  #unity-container.xiuxian-host.xiuxian-handheld { position:fixed!important;inset:auto!important;left:var(--xx-left,0px)!important;top:var(--xx-top,0px)!important;width:var(--xx-width,100vw)!important;height:var(--xx-height,100dvh)!important;min-width:0!important;min-height:0!important;overflow:hidden!important;transform:none!important;box-sizing:border-box; }
  #unity-container.xiuxian-handheld #unity-fullscreen-container {position:relative!important;overflow:hidden;min-width:0;min-height:0;width:100%!important;height:0!important;flex:1 1 0!important;aspect-ratio:auto!important;}
  #unity-container.xiuxian-handheld #unity-canvas {position:absolute!important;inset:0!important;width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;display:block;outline:none;touch-action:none;}
  #unity-container.xiuxian-handheld #xiuxian-input-toolbar { flex:0 0 auto!important;width:100%;padding-top:2px;padding-bottom:max(2px,env(safe-area-inset-bottom));gap:5px;font-size:12px; }
  #unity-container.xiuxian-handheld #xiuxian-input-toolbar label {white-space:nowrap;}
  @media(orientation:portrait) { #unity-container.xiuxian-handheld #unity-fullscreen-container {height:auto!important;flex:none!important;aspect-ratio:16/9!important;max-height:calc(var(--xx-height,100dvh) - 42px);}}
  `;
  document.head.appendChild(style);
  let last="",raf=0;
  function layout() {
    raf=0;
    if(!host.classList.contains("xiuxian-handheld"))return;
    const v=window.visualViewport;
    // Preserve accessibility zoom. Only use the visual viewport during ordinary browser chrome changes.
    if(v && Math.abs(v.scale-1)>.015)return;
    const values=[v?.offsetLeft||0,v?.offsetTop||0,v?.width||innerWidth,v?.height||innerHeight].map(n=>Math.round(n));
    const key=values.join(",");
    if(key===last)return;
    last=key;
    ["left","top","width","height"].forEach((name,i)=>host.style.setProperty("--xx-"+name,values[i]+"px"));
  }
  function schedule(){if(!raf)raf=requestAnimationFrame(layout);}
  function rotate(){last="";schedule();setTimeout(schedule,120);setTimeout(schedule,350);}
  window.addEventListener("resize",schedule);
  window.addEventListener("orientationchange",rotate);
  window.addEventListener("pageshow",rotate);
  window.visualViewport?.addEventListener("resize",schedule);
  window.visualViewport?.addEventListener("scroll",schedule);
  new MutationObserver(rotate).observe(host,{attributes:true,attributeFilter:["class"]});
  layout();
})();
