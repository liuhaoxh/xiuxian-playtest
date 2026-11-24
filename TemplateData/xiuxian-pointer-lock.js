/* Unity 6 WebGL ignores the Promise returned by requestPointerLock.
   Protect only the game canvas; no global error suppression or touch input changes. */
(function () {
  "use strict";
  const canvas = document.getElementById("unity-canvas");
  if (!canvas || typeof canvas.requestPointerLock !== "function") return;
  if (canvas.__xiuxianLockGuard) return;
  const native = canvas.requestPointerLock.bind(canvas);
  let pending = null, legacyPending = false, legacyTimer = null;
  function clearLegacy() {
    legacyPending = false;
    if (legacyTimer !== null) clearTimeout(legacyTimer);
    legacyTimer = null;
  }
  function denied(error) {
    const name = error && error.name;
    // Expected outcomes of concurrent requests, lost activation, or user refusal.
    // Never claim a lock was acquired: Unity receives the real pointerlockchange event.
    if (["InUseAttributeError", "NotAllowedError", "SecurityError", "WrongDocumentError", "NotSupportedError", "AbortError"].includes(name)) {
      console.warn("[WebDesktop] pointer lock not granted:", name);
      return;
    }
    throw error;
  }
  document.addEventListener("pointerlockchange", clearLegacy);
  document.addEventListener("pointerlockerror", clearLegacy);
  canvas.requestPointerLock = function (...args) {
    if (window.XiuxianWebDevice && window.XiuxianWebDevice.touch()) return native(...args);
    if (document.pointerLockElement === canvas) return Promise.resolve();
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
    } catch (error) {
      return denied(error);
    }
  };
  canvas.__xiuxianLockGuard = true;
})();
