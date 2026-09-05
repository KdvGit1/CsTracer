// Lightweight single-flight job. Snapshots deliberately exclude match bodies
// and credentials so polling stays fast even with a large local archive.
export function createSteamScanJob(run) {
  let pending = null;
  let state = { running: false, revision: 0, startedAt: 0, finishedAt: 0, message: "Henüz tarama yapılmadı.", ok: null };
  return {
    snapshot: () => ({ ...state }),
    start() {
      if (pending) return pending;
      state = { ...state, running: true, startedAt: Date.now(), finishedAt: 0, message: "Steam geçmişi arka planda taranıyor; kayıtlı maçlarını kullanabilirsin.", ok: null, revision: state.revision + 1 };
      pending = Promise.resolve().then(run).then((result) => {
        state = { ...state, message: result.message, ok: result.ok };
        return result;
      }, (error) => {
        state = { ...state, message: "Tarama tamamlanamadı. Kayıtlı maçlar korundu; yeniden deneyebilirsin.", ok: false };
        throw error;
      }).finally(() => {
        pending = null;
        state = { ...state, running: false, finishedAt: Date.now(), revision: state.revision + 1 };
      });
      return pending;
    },
  };
}

export function sameSteamScanSession(initial, current) {
  return initial.steamLoginSecure === current.steamLoginSecure && initial.steamId === current.steamId;
}
