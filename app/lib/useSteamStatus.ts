"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { COMPANION_URL } from "./config";

export type SteamHealth = {
  state: "connected" | "unverified" | "error" | "expired" | "disconnected";
  message: string;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  partial?: boolean;
};
export type SteamSnapshot = {
  hasSession: boolean;
  autoScanEnabled: boolean;
  connection: SteamHealth;
  scan: { running: boolean; revision: number; startedAt: number; finishedAt: number; message: string; ok: boolean | null };
};

export function useSteamStatus() {
  const [snapshot, setSnapshot] = useState<SteamSnapshot | null>(null);
  const [service, setService] = useState<"loading" | "online" | "offline">("loading");
  const alive = useRef(false);
  const busy = useRef(false);
  const accept = useCallback((data: SteamSnapshot) => {
    if (alive.current) { setSnapshot(data); setService("online"); }
  }, []);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const response = await fetch(`${COMPANION_URL}/steam/scan`, { cache: "no-store", signal: AbortSignal.timeout(2500) });
      if (!response.ok) throw new Error("Yerel servis yanıt vermedi.");
      const data = await response.json() as SteamSnapshot;
      if (alive.current) { setSnapshot(data); setService("online"); }
    } catch {
      // Preserve the last successful snapshot; local failure is not Steam expiry.
      if (alive.current) setService("offline");
    } finally { busy.current = false; }
  }, []);
  useEffect(() => {
    alive.current = true;
    const first = window.setTimeout(() => void refresh(), 0);
    const wake = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", wake);
    return () => { alive.current = false; window.clearTimeout(first); document.removeEventListener("visibilitychange", wake); };
  }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, service !== "online" || snapshot?.scan.running ? 1800 : 12000);
    return () => window.clearInterval(timer);
  }, [refresh, service, snapshot?.scan.running]);
  return { snapshot, service, refresh, accept };
}

export function steamStatusLabel(health?: SteamHealth) {
  if (!health) return "Durum alınıyor";
  return ({ connected: health.partial ? "Kısmi tarama" : "Son tarama başarılı", unverified: "Oturum kayıtlı", error: "Steam’e ulaşılamadı", expired: "Oturum süresi doldu", disconnected: "Steam bağlı değil" })[health.state];
}

export function scanTimeLabel(timestamp?: number) {
  return timestamp && Number.isFinite(new Date(timestamp).getTime()) ? new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(timestamp) : "Henüz başarılı tarama yok";
}
