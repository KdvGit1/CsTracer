"use client";

import { useEffect, useSyncExternalStore } from "react";

const KEY = "tracer-motion";
const EVENT = "tracer-motion-change";
let fallbackPreference: string | undefined;
function readPreference() {
  if (fallbackPreference !== undefined) return fallbackPreference;
  try { return localStorage.getItem(KEY) === "reduced" ? "reduced" : "auto"; }
  catch { return "auto"; }
}
function subscribe(notify: () => void) {
  window.addEventListener(EVENT, notify);
  window.addEventListener("storage", notify);
  return () => { window.removeEventListener(EVENT, notify); window.removeEventListener("storage", notify); };
}

// Mounted once: visual preferences must not remount analysis or Steam jobs.
export default function MotionSettings() {
  const preference = useSyncExternalStore(subscribe, readPreference, () => "auto");
  useEffect(() => {
    document.documentElement.dataset.motion = preference;
  }, [preference]);
  useEffect(() => {
    const updateVisibility = () => { document.documentElement.dataset.motionPaused = String(document.hidden); };
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => { document.removeEventListener("visibilitychange", updateVisibility); delete document.documentElement.dataset.motionPaused; };
  }, []);
  return <button className="motion-toggle" aria-pressed={preference === "reduced"} title="Animasyonları azalt. Sistemindeki hareket azaltma tercihi de otomatik uygulanır." onClick={() => {
    const next = preference === "reduced" ? "auto" : "reduced";
    try { localStorage.setItem(KEY, next); fallbackPreference = undefined; }
    catch { fallbackPreference = next; }
    document.documentElement.dataset.motion = next;
    window.dispatchEvent(new Event(EVENT));
  }}><span aria-hidden="true">◒</span> Hareketi azalt <span className="motion-toggle-state">{preference === "reduced" ? "Açık" : "Kapalı"}</span></button>;
}
