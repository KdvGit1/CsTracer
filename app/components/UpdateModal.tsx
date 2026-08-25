"use client";

import { useEffect, useState } from "react";
import {
  IconSparkles,
  IconWarning,
  IconCheck,
  IconSettings,
  IconClose,
  IconRocket,
  IconArrowRight,
  IconRefresh,
} from "./NavIcons";
import { APP_VERSION, COMPANION_URL } from "../lib/config";

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  title?: string;
  releaseDate?: string;
  sizeMb?: string;
  changelog?: string[];
  repoUrl?: string;
  configured?: boolean;
  patchUrl?: string;
  expectedSha256?: string;
  htmlUrl?: string;
  message?: string;
}

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  updateInfo: UpdateInfo | null;
  onRefreshCheck: () => Promise<void>;
  checking: boolean;
}

export default function UpdateModal({
  isOpen,
  onClose,
  updateInfo,
  onRefreshCheck,
  checking,
}: UpdateModalProps) {
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [customRepo, setCustomRepo] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [savingRepo, setSavingRepo] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !updating) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, updating, onClose]);

  if (!isOpen) return null;

  const handleApplyUpdate = async () => {
    setUpdating(true);
    setUpdateError("");
    try {
      const res = await fetch(`${COMPANION_URL}/update/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patchUrl: updateInfo?.patchUrl || "",
          expectedSha256: updateInfo?.expectedSha256 || undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; needsRestart?: boolean; message?: string };
      if (res.ok && data.ok) {
        setUpdateSuccess(true);
        // Companion yamayı uygulayıp kendini yeniden başlatıyor; sunucunun
        // tekrar ayağa kalkması birkaç saniye sürebilir.
        setTimeout(() => {
          window.location.reload();
        }, 8000);
      } else {
        setUpdateError(data.error || "Güncelleme uygulanamadı.");
      }
    } catch (err: unknown) {
      setUpdateError(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUpdating(false);
    }
  };

  const handleSaveRepo = async () => {
    if (!customRepo.trim()) return;
    setSavingRepo(true);
    try {
      const res = await fetch(`${COMPANION_URL}/update/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: customRepo.trim() }),
      });
      if (res.ok) {
        setShowConfig(false);
        await onRefreshCheck();
      }
    } catch (err) {
      console.error("Repo kaydedilemedi:", err);
    } finally {
      setSavingRepo(false);
    }
  };

  const hasNew = Boolean(updateInfo?.hasUpdate);
  const canApplyUpdate = hasNew && Boolean(updateInfo?.patchUrl);
  const repoConfigured = Boolean(updateInfo?.configured);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !updating) onClose(); }}>
      <section className="settings-modal update-modal" role="dialog" aria-modal="true" aria-labelledby="update-modal-title">
        {!updating && (
          <button className="modal-close" onClick={onClose} aria-label="Güncelleme penceresini kapat">
            <IconClose size={16} />
          </button>
        )}

        <div className="update-modal-header">
          <div className="update-icon-glow">
            {hasNew ? <IconRocket size={24} color="#60a5fa" /> : <IconCheck size={24} color="#52e389" />}
          </div>
          <div>
            <p className="eyebrow">TRACER SÜRÜM & YAMA MERKEZİ</p>
            <h2 id="update-modal-title">
              {updateSuccess
                ? "Güncelleme Başarıyla Uygulandı!"
                : hasNew
                ? `Yeni Sürüm Mevcut (v${updateInfo?.latestVersion})`
                : "TRACER En Son Sürümde"}
            </h2>
          </div>
        </div>

        {updateSuccess ? (
          <div className="update-success-box">
            <span className="success-icon"><IconCheck size={24} /></span>
            <div>
              <b>Yeni dosyalar yüklendi!</b>
              <p>TRACER 2 saniye içinde kendini otomatik yenileyecek...</p>
            </div>
          </div>
        ) : (
          <div className="update-modal-content">
            <div className="version-compare-card">
              <div>
                <span>Şu Anki Sürüm</span>
                <b>v{updateInfo?.currentVersion || APP_VERSION}</b>
              </div>
              <div className="version-arrow">
                <IconArrowRight size={16} />
              </div>
              <div>
                <span>En Son Sürüm</span>
                <b className={hasNew ? "latest-badge-new" : "latest-badge-current"}>
                  v{updateInfo?.latestVersion || updateInfo?.currentVersion || APP_VERSION}
                </b>
              </div>
            </div>

            {hasNew && (
              <div className="changelog-card">
                <div className="changelog-head">
                  <b>{updateInfo?.title || `v${updateInfo?.latestVersion} Yenilikleri`}</b>
                  {updateInfo?.sizeMb && <span className="patch-size-pill">{updateInfo.sizeMb}</span>}
                </div>
                {updateInfo?.changelog && updateInfo.changelog.length > 0 ? (
                  <ul className="changelog-list">
                    {updateInfo.changelog.map((item, i) => (
                      <li key={i}><IconSparkles size={12} style={{ display: "inline-block", verticalAlign: "middle", marginRight: "6px" }} /> {item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="changelog-empty">Performans iyileştirmeleri ve hata düzeltmeleri.</p>
                )}
              </div>
            )}

            {!hasNew && repoConfigured && (
              <div className="update-up-to-date-box">
                <p>Tüm analiz motoru, canlı maç koçluğu ve harita algoritmaları güncel durumda. Yeni bir yama çıktığında burada görünecektir.</p>
              </div>
            )}

            {updateError && (
              <div className="update-error-box">
                <IconWarning size={16} />
                <span>{updateError}</span>
              </div>
            )}

            {hasNew && !canApplyUpdate && updateInfo?.message && (
              <div className="update-error-box">
                <IconWarning size={16} />
                <span>{updateInfo.message}</span>
              </div>
            )}

            <div className="update-config-section">
              {!showConfig ? (
                <button
                  className="ghost-btn config-toggle-btn"
                  onClick={() => {
                    setCustomRepo(updateInfo?.repoUrl || "");
                    setShowConfig(true);
                  }}
                >
                  <IconSettings size={14} style={{ marginRight: "6px" }} />
                  GitHub Güncelleme Kaynağını Düzenle
                </button>
              ) : (
                <div className="repo-config-form">
                  <label htmlFor="update-repository">GitHub Güncelleme Deposu (owner/repo):</label>
                  <input
                    id="update-repository"
                    type="text"
                    placeholder="Örn: KdvGit1/CsTracer"
                    value={customRepo}
                    onChange={(e) => setCustomRepo(e.target.value)}
                  />
                  <button
                    className="upload-button repo-save-btn"
                    onClick={() => void handleSaveRepo()}
                    disabled={savingRepo}
                  >
                    {savingRepo ? "Kaydediliyor..." : "Kaydet ve Denetle"}
                  </button>
                </div>
              )}
            </div>

            <div className="update-actions">
              {hasNew ? (
                <button
                  className="primary-action-btn update-apply-btn"
                  onClick={() => void handleApplyUpdate()}
                  disabled={updating || !canApplyUpdate}
                >
                  <IconSparkles size={14} style={{ marginRight: "6px" }} />
                  <span>
                    {updating
                      ? "Yama İndiriliyor & Uygulanıyor..."
                      : canApplyUpdate
                        ? "1-Tıkla Şimdi Güncelle"
                        : "Yama Dosyası Bekleniyor"}
                  </span>
                </button>
              ) : (
                <button
                  className="ghost-button update-check-btn"
                  onClick={() => void onRefreshCheck()}
                  disabled={checking}
                >
                  <IconRefresh size={14} className={checking ? "spin-icon" : ""} style={{ marginRight: "6px" }} />
                  <span>{checking ? "Denetleniyor..." : "Yeniden Denetle"}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
