"use client";

import React, { useState } from "react";
import { IconSparkle, IconWarning, IconCheck, IconSettings } from "./NavIcons";

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  title?: string;
  releaseDate?: string;
  changelog?: string[];
  patchUrl?: string;
  sizeMb?: string;
  error?: string;
  githubRepo?: string;
  configured?: boolean;
  message?: string;
  htmlUrl?: string;
}

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  updateInfo: UpdateInfo | null;
  onRefreshCheck: () => Promise<void>;
  checking: boolean;
}

const COMPANION_URL = "http://127.0.0.1:43119";

export default function UpdateModal({
  isOpen,
  onClose,
  updateInfo,
  onRefreshCheck,
  checking,
}: UpdateModalProps) {
  const [updating, setUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [showRepoConfig, setShowRepoConfig] = useState(false);
  const [repoInput, setRepoInput] = useState(updateInfo?.githubRepo || "");
  const [savingRepo, setSavingRepo] = useState(false);

  if (!isOpen) return null;

  async function handleApplyUpdate() {
    if (!updateInfo?.patchUrl) return;
    setUpdating(true);
    setErrorMessage("");
    try {
      const res = await fetch(`${COMPANION_URL}/update/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patchUrl: updateInfo.patchUrl }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Güncelleme uygulanamadı.");
      }
      setUpdateSuccess(true);
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setUpdating(false);
    }
  }

  async function handleSaveRepo() {
    setSavingRepo(true);
    setErrorMessage("");
    try {
      const cleanRepo = repoInput.trim().replace(/^https?:\/\/github\.com\//, "");
      const res = await fetch(`${COMPANION_URL}/update/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubRepo: cleanRepo }),
      });
      if (!res.ok) throw new Error("Ayar kaydedilemedi.");
      setShowRepoConfig(false);
      await onRefreshCheck();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingRepo(false);
    }
  }

  const hasNew = Boolean(updateInfo?.hasUpdate);
  const repoConfigured = Boolean(updateInfo?.configured);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !updating) onClose(); }}>
      <section className="settings-modal update-modal" role="dialog" aria-modal="true" aria-labelledby="update-modal-title">
        {!updating && <button className="modal-close" onClick={onClose} aria-label="Güncelleme penceresini kapat">×</button>}

        <div className="update-modal-header">
          <div className="update-icon-glow">
            {hasNew ? "🚀" : "✓"}
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
                <b>v{updateInfo?.currentVersion || "0.42.0"}</b>
              </div>
              <div className="version-arrow">➔</div>
              <div>
                <span>En Son Sürüm</span>
                <b className={hasNew ? "latest-badge-new" : "latest-badge-current"}>
                  v{updateInfo?.latestVersion || updateInfo?.currentVersion || "0.42.0"}
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
                      <li key={i}><span>✦</span> {item}</li>
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

            {updateInfo?.message && (
              <div className="update-info-note">
                <p>{updateInfo.message}</p>
              </div>
            )}

            {errorMessage && (
              <div className="update-error-box">
                <IconWarning size={16} />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* GitHub Repo Ayar Kartı */}
            <div className="update-repo-config-card">
              <div className="repo-config-head" onClick={() => setShowRepoConfig(!showRepoConfig)}>
                <span className="repo-config-title">
                  <IconSettings size={13} />
                  <span>Güncelleme Kaynağı: <b>{updateInfo?.githubRepo || "Henüz Belirtilmedi"}</b></span>
                </span>
                <button type="button" className="repo-config-toggle">{showRepoConfig ? "Kapat" : "Değiştir"}</button>
              </div>

              {showRepoConfig && (
                <div className="repo-config-body">
                  <label>
                    <span>GitHub Repository (kullanici/repo formatında):</span>
                    <input
                      type="text"
                      placeholder="örn: vuraldogan/CsTracker veya kullanici/TRACER"
                      value={repoInput}
                      onChange={(e) => setRepoInput(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
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
                  disabled={updating}
                >
                  <span className="btn-spark">✦</span>
                  <span>{updating ? "Yama İndiriliyor & Uygulanıyor..." : "1-Tıkla Şimdi Güncelle"}</span>
                </button>
              ) : (
                <button
                  className="ghost-button update-check-btn"
                  onClick={() => void onRefreshCheck()}
                  disabled={checking}
                >
                  <span>↻</span> {checking ? "Denetleniyor..." : "Yeniden Denetle"}
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
