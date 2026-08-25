"use client";

import { useState, useEffect, useRef } from "react";
import { IconCheck, IconTerminal, IconFolder, IconCopy, IconClose } from "./NavIcons";
import { APP_VERSION, COMPANION_URL } from "../lib/config";

export interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "gsi" | "updater";
  message: string;
  meta?: unknown;
}

interface SystemInfo {
  uptimeSec?: number;
  memoryMb?: number;
  version?: string;
  dataDir?: string;
  platform?: string;
  nodeVersion?: string;
}

interface LogsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function LogsModal({ isOpen, onClose }: LogsModalProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const terminalEndRef = useRef<HTMLDivElement>(null);

  async function fetchLogs() {
    try {
      const res = await fetch(`${COMPANION_URL}/logs`);
      if (res.ok) {
        const data = (await res.json()) as { logs?: LogEntry[]; system?: SystemInfo };
        setLogs(Array.isArray(data.logs) ? data.logs : []);
        if (data.system) setSystemInfo(data.system);
      }
    } catch {
      // offline or companion unreachable
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    const initialFetch = window.setTimeout(() => void fetchLogs(), 0);

    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetchLogs();
    }, 1500);

    return () => {
      window.clearTimeout(initialFetch);
      clearInterval(timer);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  async function handleClearLogs() {
    try {
      await fetch(`${COMPANION_URL}/logs/clear`, { method: "POST" });
      setLogs([]);
      setActionMessage("Log geçmişi temizlendi");
      setTimeout(() => setActionMessage(""), 2500);
    } catch {
      setActionMessage("Loglar temizlenemedi");
    }
  }

  async function handleOpenLogFolder() {
    try {
      await fetch(`${COMPANION_URL}/system/open-log-dir`, { method: "POST" });
      setActionMessage("Log klasörü Windows Gezgini'nde açıldı");
      setTimeout(() => setActionMessage(""), 3000);
    } catch {
      setActionMessage("Klasör açılamadı");
    }
  }

  function handleCopyLogs() {
    const text = filteredLogs
      .map((l) => `[${l.timestamp.slice(11, 19)}] [${l.level.toUpperCase()}] ${l.message}`)
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  if (!isOpen) return null;

  const filteredLogs = logs.filter((log) => {
    if (filterLevel !== "all" && log.level !== filterLevel) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return log.message.toLowerCase().includes(q) || log.level.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="settings-modal logs-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logs-modal-title"
        style={{ maxWidth: "880px", width: "95vw" }}
      >
        <button className="modal-close" onClick={onClose} aria-label="Terminal penceresini kapat">
          <IconClose size={16} />
        </button>

        {/* Modal Header */}
        <div className="logs-modal-header">
          <div className="logs-header-title">
            <span className="terminal-badge-glow">
              <IconTerminal size={18} />
            </span>
            <div>
              <p className="eyebrow">TRACER GELİŞTİRİCİ & SİSTEM TEŞHİSİ</p>
              <h2 id="logs-modal-title">Canlı Terminal & Log Konsolu</h2>
            </div>
          </div>

          {systemInfo && (
            <div className="system-diag-pill">
              <span>Sürüm: <b>v{systemInfo.version || APP_VERSION}</b></span>
              <span>RAM: <b>{systemInfo.memoryMb} MB</b></span>
              <span>Çalışma: <b>{systemInfo.uptimeSec}s</b></span>
            </div>
          )}
        </div>

        {/* Terminal Controls Bar */}
        <div className="logs-controls-bar">
          <div className="logs-filter-group">
            <button
              type="button"
              className={`logs-tab-btn ${filterLevel === "all" ? "active" : ""}`}
              onClick={() => setFilterLevel("all")}
            >
              Tümü ({logs.length})
            </button>
            <button
              type="button"
              className={`logs-tab-btn level-error ${filterLevel === "error" ? "active" : ""}`}
              onClick={() => setFilterLevel("error")}
            >
              Hatalar ({logs.filter((l) => l.level === "error").length})
            </button>
            <button
              type="button"
              className={`logs-tab-btn level-gsi ${filterLevel === "gsi" ? "active" : ""}`}
              onClick={() => setFilterLevel("gsi")}
            >
              GSI Canlı ({logs.filter((l) => l.level === "gsi").length})
            </button>
            <button
              type="button"
              className={`logs-tab-btn level-updater ${filterLevel === "updater" ? "active" : ""}`}
              onClick={() => setFilterLevel("updater")}
            >
              Güncelleme ({logs.filter((l) => l.level === "updater").length})
            </button>
            <button
              type="button"
              className={`logs-tab-btn level-warn ${filterLevel === "warn" ? "active" : ""}`}
              onClick={() => setFilterLevel("warn")}
            >
              Uyarılar ({logs.filter((l) => l.level === "warn").length})
            </button>
          </div>

          <div className="logs-search-box">
            <input
              type="text"
              placeholder="Loglarda ara..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery("")} className="clear-search-btn">
                ×
              </button>
            )}
          </div>
        </div>

        {/* Terminal Window Box */}
        <div className="terminal-window">
          <div className="terminal-titlebar">
            <div className="terminal-traffic-lights">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
            </div>
            <div className="terminal-title">TRACER Internal Console · Port 43119 / 43118</div>
            <div className="terminal-status-indicator">
              <span className="pulse-indicator-dot" /> CANLI
            </div>
          </div>

          <div className="terminal-body">
            {filteredLogs.length === 0 ? (
              <div className="terminal-empty">
                <p>Henüz bu filtreye uygun log kaydı bulunmuyor.</p>
                <small>CS2 maçları oynandıkça, demo yüklendikçe veya güncelleme yapıldıkça tüm çıktılar buraya düşecektir.</small>
              </div>
            ) : (
              filteredLogs.map((log) => (
                <div key={log.id} className={`terminal-line level-${log.level}`}>
                  <span className="log-time">{log.timestamp.slice(11, 19)}</span>
                  <span className={`log-tag tag-${log.level}`}>[{log.level.toUpperCase()}]</span>
                  <span className="log-msg">{log.message}</span>
                </div>
              ))
            )}
            <div ref={terminalEndRef} />
          </div>
        </div>

        {/* Action feedback bar */}
        {actionMessage && (
          <div className="logs-feedback-banner">
            <IconCheck size={14} /> <span>{actionMessage}</span>
          </div>
        )}

        {/* Modal Footer Actions */}
        <div className="logs-modal-footer">
          <div className="footer-left-actions">
            <label className="autoscroll-toggle">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              <span>Otomatik Kaydır</span>
            </label>
            <button
              type="button"
              className="ghost-button mini-btn"
              onClick={handleClearLogs}
              title="Konsol geçmişini temizler"
            >
              Geçmişi Temizle
            </button>
          </div>

          <div className="footer-right-actions">
            <button
              type="button"
              className="ghost-button mini-btn"
              onClick={handleOpenLogFolder}
              title="Windows Gezgini'nde log dosyalarını açar"
            >
              <IconFolder size={14} style={{ marginRight: "6px" }} />
              Log Klasörünü Aç
            </button>
            <button
              type="button"
              className="primary-action-btn mini-btn"
              onClick={handleCopyLogs}
            >
              {copied ? (
                <>
                  <IconCheck size={14} style={{ marginRight: "6px" }} />
                  Kopyalandı
                </>
              ) : (
                <>
                  <IconCopy size={14} style={{ marginRight: "6px" }} />
                  Logları Kopyala
                </>
              )}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
