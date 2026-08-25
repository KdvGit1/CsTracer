import assert from "node:assert/strict";
import test from "node:test";
import { applyLiveFeedback, reconcileLiveSession, startLiveSession } from "../companion/squad/live.mjs";

const report = {
  playbook: {
    roundPlans: [
      { id: "long", side: "T", buy: "full", title: "Long rush", lane: "A Long", evidence: { historicalScore: 80, confidence: 80 }, tasks: [] },
      { id: "short", side: "T", buy: "full", title: "Short", lane: "A Short", evidence: { historicalScore: 70, confidence: 80 }, tasks: [] },
      { id: "ct", side: "CT", buy: "full", title: "CT default", lane: "Genel", tasks: [] },
    ],
  },
};
const squad = { id: "s1", map: "dust2", report, notes: "İlk not" };

function gsi({ round = 0, team = "T", health = 100, winner = "", map = "dust2" } = {}) {
  return {
    map: { name: map, round, scoreCT: winner === "CT" ? 1 : 0, scoreT: winner === "T" ? 1 : 0 },
    round: { winTeam: winner },
    player: { team, health, money: 5000, position: { x: 1, y: 2 } },
    team: { totalMoney: 25000, allies: [] },
  };
}

test("canlı plan yerel ölümü kişisel sinyal sayar, round sonucunu bekler", () => {
  let session = startLiveSession(squad);
  session = reconcileLiveSession(session, report, gsi(), 100);
  assert.equal(session.currentPlan.id, "long");
  session = reconcileLiveSession(session, report, gsi({ health: 0 }), 200);
  assert.equal(session.personalEvents.length, 1);
  assert.equal(session.history.length, 0);
  session = reconcileLiveSession(session, report, gsi({ health: 0, winner: "CT" }), 300);
  assert.equal(session.history[0].outcome, "failed");
  assert.ok(session.cooldowns.long >= 2);
});

test("kaybedilen rota sonraki roundda zorlanmaz", () => {
  let session = reconcileLiveSession(startLiveSession(squad), report, gsi(), 100);
  session = reconcileLiveSession(session, report, gsi({ winner: "CT" }), 200);
  session = reconcileLiveSession(session, report, gsi({ round: 1 }), 300);
  assert.equal(session.currentPlan.id, "short");
  assert.match(session.currentPlan.adaptation, /cooldown|round sonucu/i);
});

test("manuel takım geri bildirimi ve kişisel not ayrıdır", () => {
  let session = reconcileLiveSession(startLiveSession(squad), report, gsi(), 100);
  session = applyLiveFeedback(session, report, { personal: true, reason: "Long flash geç kaldı" }, 200);
  assert.equal(session.history.length, 0);
  assert.equal(session.personalEvents.length, 1);
  session = applyLiveFeedback(session, report, { outcome: "success", notes: "İkinci oyuncu flash atsın" }, 300);
  assert.equal(session.history[0].outcome, "success");
  assert.equal(session.notes, "İkinci oyuncu flash atsın");
});

test("rapor haritası ile canlı harita uyuşmazsa plan durur", () => {
  const session = reconcileLiveSession(startLiveSession(squad), report, gsi({ map: "mirage" }), 100);
  assert.equal(session.currentPlan, null);
  assert.match(session.statusMessage, /rapor haritası/);
});

test("GSI bağlı değilken varsayılan CT değerinden sahte plan başlatılmaz", () => {
  const session = reconcileLiveSession(startLiveSession(squad), report, { ...gsi(), connected: false }, 100);
  assert.equal(session.connected, false);
  assert.equal(session.currentPlan, null);
  assert.match(session.statusMessage, /GSI bağlantısı bekleniyor/);
});
