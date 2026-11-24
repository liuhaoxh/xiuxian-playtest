/* Unity 6 WebGL may defer pointer-lock requests until the next input event.
   Explicit gameplay confirmation can request the native lock immediately. */
(function () {
  "use strict";
  const canvas = document.getElementById("unity-canvas");
  if (!canvas || canvas.__xiuxianLockGuard) return;
  const touch = () => !!window.XiuxianWebDevice?.touch();
  const native = typeof canvas.requestPointerLock === "function" ? canvas.requestPointerLock.bind(canvas) : null;
  let pending = null, legacyPending = false, legacyTimer = null;
  function clearLegacy() {
    legacyPending = false;
    if (legacyTimer !== null) clearTimeout(legacyTimer);
    legacyTimer = null;
  }
  function denied(error) {
    const name = error && error.name;
    if (["InUseAttributeError","NotAllowedError","SecurityError","WrongDocumentError","NotSupportedError","AbortError"].includes(name)) {
      console.warn("[WebDesktop] pointer lock not granted:", name);
      return;
    }
    throw error;
  }
  document.addEventListener("pointerlockchange", clearLegacy);
  document.addEventListener("pointerlockerror", clearLegacy);
  function request(...args) {
    if (touch() || !native || document.pointerLockElement === canvas) return Promise.resolve();
    if (pending) return pending;
    if (legacyPending) return;
    try {
      const result = native(...args);
      if (result && typeof result.then === "function") {
        pending = Promise.resolve(result).catch(denied).finally(() => { pending = null; });
        return pending;
      }
      legacyPending = true;
      legacyTimer = setTimeout(clearLegacy, 1000);
      return result;
    } catch (error) { return denied(error); }
  }
  if (native) canvas.requestPointerLock = request;
  window.XiuxianWebPointer = {
    request() {
      if (touch() || !native || (document.visibilityState && document.visibilityState !== "visible")) return false;
      request();
      return true;
    }
  };
  canvas.__xiuxianLockGuard = true;
})();
