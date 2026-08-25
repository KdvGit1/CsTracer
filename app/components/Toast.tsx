"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { IconCheck, IconWarning, IconClose } from "./NavIcons";

export type ToastTone = "success" | "error" | "info";

type ToastItem = { id: number; tone: ToastTone; message: string };
type ConfirmRequest = { id: number; message: string; resolve: (value: boolean) => void };

type ToastApi = {
  notify: (tone: ToastTone, message: string) => void;
  success: (message: string) => void;
  info: (message: string) => void;
  error: (message: string) => void;
  confirm: (message: string) => Promise<boolean>;
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast, ToastProvider içinde kullanılmalıdır.");
  return ctx;
}

const AUTO_DISMISS_MS = 4500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const nextIdRef = useRef(1);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((tone: ToastTone, message: string) => {
    const id = nextIdRef.current++;
    setToasts((current) => [...current.slice(-3), { id, tone, message }]);
    if (tone !== "error") {
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, AUTO_DISMISS_MS);
    }
  }, []);

  const success = useCallback((message: string) => notify("success", message), [notify]);
  const info = useCallback((message: string) => notify("info", message), [notify]);
  const error = useCallback((message: string) => notify("error", message), [notify]);

  const confirm = useCallback((message: string) => {
    return new Promise<boolean>((resolve) => {
      setConfirmRequest({ id: nextIdRef.current++, message, resolve });
    });
  }, []);

  const settleConfirm = useCallback((value: boolean) => {
    setConfirmRequest((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!confirmRequest) return;
    cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") settleConfirm(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmRequest, settleConfirm]);

  return (
    <ToastContext.Provider value={{ notify, success, info, error, confirm }}>
      {children}
      <div className="toast-stack" role="region" aria-label="Bildirimler" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>
            <span className="toast-icon">
              {toast.tone === "success" ? <IconCheck size={14} /> : <IconWarning size={14} />}
            </span>
            <p>{toast.message}</p>
            <button className="toast-close" onClick={() => dismiss(toast.id)} aria-label="Bildirimi kapat">
              <IconClose size={12} />
            </button>
          </div>
        ))}
      </div>
      {confirmRequest && (
        <div className="confirm-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) settleConfirm(false);
        }}>
          <div
            className="confirm-modal-card"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`confirm-title-${confirmRequest.id}`}
            aria-describedby={`confirm-message-${confirmRequest.id}`}
          >
            <span className="confirm-modal-icon"><IconWarning size={22} /></span>
            <div>
              <h2 id={`confirm-title-${confirmRequest.id}`}>Silme işlemini onayla</h2>
              <p id={`confirm-message-${confirmRequest.id}`}>{confirmRequest.message}</p>
            </div>
            <div className="confirm-modal-actions">
              <button ref={cancelButtonRef} className="confirm-modal-no" onClick={() => settleConfirm(false)}>Vazgeç</button>
              <button className="confirm-modal-yes" onClick={() => settleConfirm(true)}>Evet, sil</button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
