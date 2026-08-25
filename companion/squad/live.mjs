function normalizedSide(value) {
  const side = String(value || "").toUpperCase();
  return side === "CT" || side === "3" ? "CT" : side === "T" || side === "2" ? "T" : "";
}

function buyState(gsi) {
  const playerMoney = Number(gsi?.player?.money || 0);
  const allyCount = Array.isArray(gsi?.team?.allies) ? gsi.team.allies.length + 1 : 1;
  const totalMoney = Number(gsi?.team?.totalMoney || playerMoney);
  const averageMoney = totalMoney / Math.max(1, allyCount);
  if (averageMoney >= 3900 || playerMoney >= 4400) return "full";
  if (averageMoney >= 1900 || playerMoney >= 2100) return "force";
  return "eco";
}

function planScore(plan, session, roundNumber, buy) {
  const evidence = Number(plan?.evidence?.historicalScore ?? 50);
  const confidence = Number(plan?.evidence?.confidence ?? 35);
  const buyMatch = plan.buy === "full" && buy === "full" ? 15
    : plan.buy === "force" && buy === "force" ? 12
      : String(plan.buy).includes("eco") && buy === "eco" ? 12 : 0;
  const usedRecently = session.history.slice(-3).some((entry) => entry.planId === plan.id) ? 6 : 0;
  const deterministicVariation = ((roundNumber + String(plan.id).length) % 5) * 0.1;
  return evidence * (0.65 + confidence / 300) + buyMatch - usedRecently + deterministicVariation;
}

export function chooseLivePlan(session, report, gsi) {
  const side = normalizedSide(gsi?.player?.team) || session.side || "T";
  const roundNumber = Number(gsi?.map?.round || 0) + 1;
  const buy = buyState(gsi);
  const available = (report?.playbook?.roundPlans || []).filter((plan) => plan.side === side);
  if (!available.length) return null;
  const withoutCooldown = available.filter((plan) => Number(session.cooldowns?.[plan.id] || 0) < roundNumber);
  const candidates = withoutCooldown.length ? withoutCooldown : available;
  const plan = [...candidates].sort((a, b) => planScore(b, session, roundNumber, buy) - planScore(a, session, roundNumber, buy) || String(a.id).localeCompare(String(b.id)))[0];
  return {
    ...plan,
    round: roundNumber,
    buyState: buy,
    selectedAt: Date.now(),
    adaptation: Number(session.cooldowns?.[plan.id] || 0) >= roundNumber
      ? "Tüm rotalar cooldown durumunda; en erken uygun plan kontrollü oynanıyor."
      : session.history.length ? "Geçmiş round sonucu, ekonomi ve rota cooldown’u ile seçildi." : "Çok maçlı tarihsel kanıta göre başlangıç planı.",
  };
}

export function startLiveSession(squad) {
  if (!squad?.id || !squad?.report) throw new Error("Canlı koç için önce takım raporu oluşturulmalı.");
  return {
    schemaVersion: 1,
    squadId: squad.id,
    map: squad.map,
    active: true,
    connected: false,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    round: 0,
    side: "",
    score: { CT: 0, T: 0 },
    currentPlan: null,
    history: [],
    cooldowns: {},
    failureCounts: {},
    personalEvents: [],
    notes: squad.notes || "",
    lastHealth: null,
    resolvedRoundKey: "",
    capability: {
      allPlayers: false,
      localPosition: false,
      mode: "normal_player",
      message: "Normal oyuncu GSI modunda takım konumları bulunmayabilir; round sonucu ve yerel oyuncu sinyali kullanılıyor.",
    },
  };
}

function resolveCurrentRound(session, won, reason, now) {
  const plan = session.currentPlan;
  if (!plan) return session;
  const planId = plan.id;
  const failureCount = won ? 0 : Number(session.failureCounts[planId] || 0) + 1;
  session.failureCounts[planId] = failureCount;
  if (!won) {
    const recentSameFailures = session.history.slice(-3).filter((entry) => entry.planId === planId && entry.outcome === "failed").length + 1;
    const cooldownRounds = recentSameFailures >= 2 ? 3 : 1;
    session.cooldowns[planId] = Math.max(Number(session.cooldowns[planId] || 0), Number(plan.round || session.round) + cooldownRounds);
  }
  session.history.push({
    round: plan.round,
    side: plan.side,
    planId,
    title: plan.title,
    lane: plan.lane,
    outcome: won ? "success" : "failed",
    reason,
    timestamp: now,
  });
  session.history = session.history.slice(-30);
  session.currentPlan = null;
  return session;
}

export function reconcileLiveSession(inputSession, report, gsi, now = Date.now()) {
  const session = structuredClone(inputSession);
  if (!session.active || !gsi) return session;
  session.connected = gsi.connected !== false;
  if (!session.connected) {
    session.statusMessage = "CS2 GSI bağlantısı bekleniyor; bağlantı gelmeden round planı başlatılmayacak.";
    session.currentPlan = null;
    session.updatedAt = now;
    return session;
  }
  const map = String(gsi?.map?.name || "").replace(/^de_/, "").toLowerCase();
  if (map && session.map && map !== session.map) {
    session.statusMessage = `Canlı harita ${map}; rapor haritası ${session.map}. Plan beklemeye alındı.`;
    session.currentPlan = null;
    session.updatedAt = now;
    return session;
  }
  session.statusMessage = "";
  session.side = normalizedSide(gsi?.player?.team) || session.side;
  session.score = { CT: Number(gsi?.map?.scoreCT || 0), T: Number(gsi?.map?.scoreT || 0) };
  session.capability = {
    allPlayers: Array.isArray(gsi?.team?.allies) && gsi.team.allies.length >= 4,
    localPosition: Boolean(gsi?.player?.position && (Number(gsi.player.position.x) !== 0 || Number(gsi.player.position.y) !== 0)),
    mode: Array.isArray(gsi?.team?.allies) && gsi.team.allies.length >= 4 ? "spectator_full" : "normal_player",
    message: Array.isArray(gsi?.team?.allies) && gsi.team.allies.length >= 4
      ? "Tam takım GSI verisi görüldü."
      : "Normal oyuncu GSI modunda takım konumları bulunmayabilir; round sonucu ve yerel oyuncu sinyali kullanılıyor.",
  };

  const roundNumber = Number(gsi?.map?.round || 0) + 1;
  const roundWinner = normalizedSide(gsi?.round?.winTeam);
  if (roundWinner && session.currentPlan) {
    const key = `${session.currentPlan.round}:${roundWinner}`;
    if (session.resolvedRoundKey !== key) {
      session.resolvedRoundKey = key;
      resolveCurrentRound(session, roundWinner === session.side, `GSI round sonucu: ${roundWinner}`, now);
    }
  }

  const health = Number(gsi?.player?.health ?? session.lastHealth ?? 100);
  if (session.lastHealth !== null && session.lastHealth > 0 && health <= 0 && session.currentPlan) {
    session.personalEvents.push({
      round: session.currentPlan.round,
      planId: session.currentPlan.id,
      lane: session.currentPlan.lane,
      type: "local_death",
      message: `${session.currentPlan.lane} planında erken düştün; takım sonucu görülmeden rota takım çapında başarısız sayılmayacak.`,
      timestamp: now,
    });
    session.personalEvents = session.personalEvents.slice(-20);
  }
  session.lastHealth = health;

  if (!session.currentPlan && !roundWinner && session.side) {
    session.currentPlan = chooseLivePlan(session, report, gsi);
  }
  session.round = roundNumber;
  session.updatedAt = now;
  return session;
}

export function applyLiveFeedback(inputSession, report, feedback = {}, now = Date.now()) {
  const session = structuredClone(inputSession);
  const outcome = String(feedback.outcome || "");
  if (outcome === "failed" || outcome === "success") {
    resolveCurrentRound(session, outcome === "success", String(feedback.reason || "Manuel takım geri bildirimi"), now);
  } else if (feedback.personal) {
    session.personalEvents.push({
      round: session.currentPlan?.round || session.round,
      planId: session.currentPlan?.id || "",
      lane: session.currentPlan?.lane || "",
      type: "manual_personal",
      message: String(feedback.reason || "Kişisel not"),
      timestamp: now,
    });
  }
  if (feedback.notes !== undefined) session.notes = String(feedback.notes || "").slice(0, 12000);
  if (!session.currentPlan) {
    const syntheticGsi = {
      map: { round: Math.max(0, Number(session.round || 1) - 1), scoreCT: session.score?.CT, scoreT: session.score?.T },
      player: { team: session.side, money: feedback.money || 4000 },
      team: { totalMoney: feedback.teamMoney || 20000, allies: [{}, {}, {}, {}] },
    };
    session.currentPlan = chooseLivePlan(session, report, syntheticGsi);
  }
  session.updatedAt = now;
  return session;
}

export function reconcileActiveSquadSessions(store, gsi, now = Date.now()) {
  const sessions = store.listLiveSessions();
  const squads = store.listSquads();
  for (const [squadId, session] of Object.entries(sessions)) {
    if (!session?.active) continue;
    const squad = squads.find((item) => item.id === squadId);
    if (!squad?.report) continue;
    store.saveLiveSession(squadId, reconcileLiveSession(session, squad.report, gsi, now));
  }
}
