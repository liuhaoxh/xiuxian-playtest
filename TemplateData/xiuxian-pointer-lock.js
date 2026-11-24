/* Browser capture adapter. The game declares desire; only a trusted gesture
   may request the OS lock. pointerlockchange is authoritative. */
(() => {
  "use strict";
  const canvas = document.getElementById("unity-canvas");
  if (!canvas || canvas.__xiuxianLockGuard) return;
  const frame = document.getElementById("unity-fullscreen-container") || canvas.parentElement;
  const native = typeof canvas.requestPointerLock === "function" ? canvas.requestPointerLock.bind(canvas) : null;
  const touch = () => !!window.XiuxianWebDevice?.touch();
  let desired=false, epoch=0, gesture=0, consumed=0, gestureAt=-Infinity;
  let pending=null, acceptedEpoch=-1, releaseExpected=false, timer=null;
  let requests=0, errors=0, lastError="", promptVisible=false;
  const actual = () => document.pointerLockElement === canvas;
  const visible = () => document.visibilityState !== "hidden";
  function mark(e) {
    if (!e.isTrusted || (e.type==="keydown" && (e.key==="Escape" || e.repeat))) return;
    // Only engagement gestures belonging to the game, not typing in the toolbar.
    if (e.target !== canvas && e.target !== button && !(e.type==="keydown" && desired && document.hasFocus())) return;
    gesture++; gestureAt=performance.now();
  }
  function finish(token) {
    if (pending!==token) return;
    if(timer!==null){clearTimeout(timer);timer=null;}
    pending=null;
  }
  function release() {
    if (actual()) {
      releaseExpected=true;
      try { document.exitPointerLock(); } catch(e) { lastError=e.name||"exit"; }
    }
  }
  function setDesired(value) {
    value=!!value && !touch() && !!native;
    if(desired===value)return;
    desired=value; epoch++;
    if(!desired){consumed=gesture;acceptedEpoch=-1;release();}
  }
  function canRequest() {
    return desired && !touch() && native && visible() && document.hasFocus() &&
      gesture>consumed && (navigator.userActivation ? navigator.userActivation.isActive : performance.now()-gestureAt<500);
  }
  function fail(token,e) {
    if(pending!==token)return;
    errors++;lastError=e?.name||"pointerlockerror";
    if(acceptedEpoch===token.epoch)acceptedEpoch=-1;
    finish(token);
    if(actual())release();
    console.warn("[InputFocus] lock denied:",lastError);
  }
  function request() {
    if(actual()){
      if(desired && !touch() && acceptedEpoch===epoch)return true;
      release();return false;
    }
    if(pending || !canRequest())return false;
    consumed=gesture;
    const token={epoch};
    pending=token;acceptedEpoch=epoch;requests++;
    timer=setTimeout(()=>fail(token,{name:"Timeout"}),1600);
    try {
      const result=native();
      if(result && typeof result.then==="function"){
        result.then(()=>{
          if(pending!==token){
            if(!desired || token.epoch!==epoch)release();
            return;
          }
          if(token.epoch!==epoch || !desired){acceptedEpoch=-1;release();}
          // Do not acknowledge on promise alone; retain pending until actual lock event.
          if(actual())finish(token);
        },e=>fail(token,e));
      }
    }catch(e){fail(token,e);}
    return true;
  }
  document.addEventListener("pointerlockchange",()=>{
    if(actual()){
      if(!desired || touch() || acceptedEpoch!==epoch){release();return;}
      if(pending)finish(pending);
      releaseExpected=false;lastError="";
    }else{
      acceptedEpoch=-1;
      // Do not treat the default unlock gesture as permission to recapture.
      if(!releaseExpected){consumed=gesture;lastError="unlocked";}
      releaseExpected=false;
      if(pending)finish(pending);
    }
  });
  document.addEventListener("pointerlockerror",()=>{if(pending)fail(pending,{name:"pointerlockerror"});});
  const button=document.createElement("button");
  button.id="xiuxian-resume-input";button.type="button";button.textContent="点击恢复战斗";
  button.setAttribute("aria-label","重新捕获鼠标并恢复战斗");
  button.style.cssText="display:none;position:absolute;inset:0;margin:auto;width:min(300px,90%);height:56px;z-index:1000;color:#e0eee5;background:#213b36;border:1px solid #a39770;border-radius:4px;font:600 17px system-ui;cursor:pointer;box-shadow:0 8px 40px #0008;";
  if(frame)frame.appendChild(button);
  for(const type of ["pointerdown","pointerup","click","keydown"]) document.addEventListener(type,mark,true);
  button.addEventListener("click",e=>{
    if(!e.isTrusted)return;
    canvas.focus({preventScroll:true});
    request(); // may wait until the next state evaluation if suspended
  });
  window.addEventListener("blur",()=>{setDesired(false);});
  document.addEventListener("visibilitychange",()=>{if(!visible())setDesired(false);});
  // Unity may submit its own deferred lock request; route it through the same guard.
  if(native)canvas.requestPointerLock=function(){request();return Promise.resolve();};
  window.XiuxianWebPointer={
    setDesired, request, isAcknowledged(){return desired && !touch() && actual() && acceptedEpoch===epoch;},
    showResumePrompt(show){promptVisible=!!show&&!touch();button.style.display=promptVisible?"block":"none";},
    diagnostics(){return {desired,actual:actual(),pending:!!pending,epoch,gesture,requests,errors,lastError,prompt:promptVisible,touch:touch()};}
  };
  canvas.__xiuxianLockGuard=true;
})();
