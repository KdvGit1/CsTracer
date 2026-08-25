import { buildSquadEvidence } from "./analytics.mjs";
import { normalizeMapName, selectionFingerprint } from "./identity.mjs";
import { squadMapConfig } from "./maps.mjs";

const round1 = (value) => Math.round(Number(value || 0) * 10) / 10;

function categoryScore(player, category) {
  return Number(player.weaponCategories.find((item) => item.category === category)?.score || 0);
}

function sideStat(player, side) {
  return player.sides.find((item) => item.side === side) || { kd: 0, adr: 0, rounds: 0 };
}

function playerRoleScores(player) {
  const t = sideStat(player, "T");
  const ct = sideStat(player, "CT");
  const strongestTRoute = player.routes.filter((route) => route.side === "T").reduce((best, route) => Math.max(best, route.adjustedWinRate * route.confidence / 100), 0);
  return {
    entry: round1(45 + player.overall.openingDelta * 7 + categoryScore(player, "rifle") + categoryScore(player, "smg") * 0.5 + t.kd * 10),
    trader: round1(35 + player.overall.adr * 0.35 + player.overall.assists * 0.25 + categoryScore(player, "rifle") * 0.7),
    awp: round1(categoryScore(player, "sniper") * 2.2 + ct.kd * 8),
    support: round1(35 + player.overall.utilityPerRound * 2.2 + player.overall.flashesPerMatch * 2 + player.overall.assists * 0.2),
    lurker: round1(30 + strongestTRoute * 0.55 + t.kd * 12 - Math.max(0, player.overall.openingDelta) * 2),
    anchor: round1(35 + ct.kd * 18 + ct.adr * 0.35),
    rifler: round1(categoryScore(player, "rifle") + player.overall.adr * 0.3),
  };
}

function bestUniqueAssignment(players, slots, scoreFn) {
  let best = null;
  const visit = (playerIndex, remainingSlots, assignments, score) => {
    if (playerIndex >= players.length) {
      if (!best || score > best.score) best = { score, assignments };
      return;
    }
    for (let index = 0; index < remainingSlots.length; index++) {
      const slot = remainingSlots[index];
      const player = players[playerIndex];
      visit(
        playerIndex + 1,
        [...remainingSlots.slice(0, index), ...remainingSlots.slice(index + 1)],
        [...assignments, { slot, player, score: round1(scoreFn(player, slot)) }],
        score + scoreFn(player, slot),
      );
    }
  };
  if (!players.length || players.length > slots.length) return [];
  visit(0, slots, [], 0);
  if (!best) return [];
  return best.assignments.sort((left, right) => slots.indexOf(left.slot) - slots.indexOf(right.slot));
}

function routeAffinity(player, position) {
  const routes = player.routes.filter((route) => route.side === "CT");
  const matching = routes.filter((route) => position.keywords.some((keyword) => route.zone.toLowerCase().includes(keyword.toLowerCase())));
  const evidenceScore = matching.reduce((best, route) => Math.max(best, route.adjustedWinRate * route.confidence / 100 + Math.min(12, route.rounds)), 0);
  const fallback = sideStat(player, "CT");
  const roleScores = playerRoleScores(player);
  return evidenceScore * 1.7 + fallback.kd * 10 + fallback.adr * 0.08 + Number(roleScores[position.roleBias] || 0) * 0.25;
}

function assignWeapons(players, tAssignments) {
  const awpRank = [...players].sort((a, b) => categoryScore(b, "sniper") - categoryScore(a, "sniper"));
  const primaryAwper = awpRank[0];
  const backupAwper = awpRank[1];
  const primarySniper = primaryAwper.weaponCategories.find((item) => item.category === "sniper");
  return players.map((player) => {
    const role = tAssignments.find((item) => item.player.player.steamid === player.player.steamid)?.slot.id || "rifler";
    const bestCategory = player.weaponCategories[0]?.category || "rifle";
    let primaryBuy = "AK-47 / M4";
    let secondaryBuy = bestCategory === "smg" ? "MP9 / MAC-10" : bestCategory === "shotgun" ? "MAG-7 / XM1014 (yakın alan)" : "Takım ekonomisine göre SMG";
    let status = "rifler";
    if (player.player.steamid === primaryAwper?.player.steamid && primarySniper?.shots >= 20) {
      primaryBuy = "AWP";
      secondaryBuy = "AK-47 / M4 (AWP ekonomisi yoksa)";
      status = "primary_awp";
    } else if (player.player.steamid === backupAwper?.player.steamid && categoryScore(player, "sniper") > 0) {
      status = "backup_awp";
      secondaryBuy = "İkinci AWP yalnızca ekonomi ve harita planı uygunsa";
    } else if (bestCategory === "smg") {
      status = "smg_specialist";
    } else if (bestCategory === "shotgun") {
      status = "close_range_specialist";
    }
    return {
      player: player.player,
      role,
      status,
      primaryBuy,
      secondaryBuy,
      evidence: {
        bestCategory,
        categoryScore: round1(categoryScore(player, bestCategory)),
        confidence: player.weaponCategories.find((item) => item.category === bestCategory)?.confidence || 0,
      },
    };
  });
}

function planEvidence(template, players) {
  const tokens = String(template.lane || "").toLowerCase().split(/[^a-z0-9çğıöşü]+/i).filter((token) => token.length >= 2);
  const matchingRoutes = players.flatMap((player) => player.routes.filter((route) => route.side === "T" && tokens.some((token) => route.zone.toLowerCase().includes(token))));
  if (!matchingRoutes.length) return { historicalScore: 50, confidence: 35, sampleRounds: 0 };
  const rounds = matchingRoutes.reduce((sum, route) => sum + route.rounds, 0);
  const weighted = matchingRoutes.reduce((sum, route) => sum + route.adjustedWinRate * route.rounds, 0) / Math.max(1, rounds);
  const confidence = matchingRoutes.reduce((sum, route) => sum + route.confidence * route.rounds, 0) / Math.max(1, rounds);
  return { historicalScore: round1(weighted), confidence: Math.round(confidence), sampleRounds: rounds };
}

function buildRoundPlans(config, tAssignments, ctAssignments, players) {
  const roleToPlayer = new Map(tAssignments.map((assignment) => [assignment.slot.id, assignment.player.player.name]));
  const roleOrder = ["entry", "trader", "awp", "support", "lurker"];
  const roleForStep = (step, fallbackIndex) => {
    const normalized = String(step || "").trim().toLowerCase();
    if (/^entry\b/.test(normalized)) return "entry";
    if (/^trader\b/.test(normalized)) return "trader";
    if (/^awp\b/.test(normalized)) return "awp";
    if (/^support\b/.test(normalized)) return "support";
    if (/^lurker\b/.test(normalized)) return "lurker";
    return roleOrder[fallbackIndex] || "support";
  };
  const tPlans = config.t.map((template, index) => ({
    id: template.id,
    side: "T",
    buy: index === 0 ? "full" : index === 1 ? "force" : "eco_or_contact",
    title: template.label,
    lane: template.lane,
    goal: template.goal,
    evidence: planEvidence(template, players),
    tasks: template.steps.map((step, stepIndex) => {
      const role = roleForStep(step, stepIndex);
      const playerName = roleToPlayer.get(role);
      return playerName ? { role, playerName, text: step } : null;
    }).filter(Boolean),
  }));
  const ctFull = {
    id: "ct_default",
    side: "CT",
    buy: "full",
    title: "Varsayılan savunma ve erken bilgi",
    lane: "Harita geneli",
    goal: "Anchorları utility ile hayatta tut, rotatorları ilk teyitli bilgiyle hareket ettir.",
    tasks: ctAssignments.map((assignment) => ({ role: assignment.slot.roleBias, playerName: assignment.player.player.name, text: `${assignment.slot.label}: ilk temas sonrası gereksiz yeniden peek yapma; rotasyon çağrısını net ver.` })),
  };
  const ctLow = {
    id: "ct_low_buy",
    side: "CT",
    buy: "eco_or_force",
    title: "Yakın mesafe çapraz ateş",
    lane: "İki seçilmiş dar boğaz",
    goal: "Silah dezavantajında haritayı beşe bölmek yerine iki takas kümesi kur.",
    tasks: ctAssignments.map((assignment, index) => ({ role: assignment.slot.roleBias, playerName: assignment.player.player.name, text: index < 2 ? "Birinci çapraz ateş grubunda temas bekle." : index < 4 ? "İkinci çapraz ateş grubunda utility sakla." : "Hayatta kalıp düşen silahı geri al." })),
  };
  return [...tPlans, ctFull, ctLow];
}

export function buildSquadReport(matches, roster, map, options = {}) {
  const evidence = buildSquadEvidence(matches, roster, map, options);
  const config = squadMapConfig(map);
  const players = evidence.players;
  const roleSlots = [
    { id: "entry", label: "Entry", description: "İlk teması açar" },
    { id: "trader", label: "Trader", description: "Entry takasını alır" },
    { id: "awp", label: "AWP", description: "Uzun görüş ve rotasyon keser" },
    { id: "support", label: "Support / IGL", description: "Utility ve zamanlama çağrısı" },
    { id: "lurker", label: "Lurker", description: "Rotasyon ve push kontrolü" },
  ];
  const tAssignments = bestUniqueAssignment(players, roleSlots, (player, slot) => playerRoleScores(player)[slot.id]);
  const ctAssignments = bestUniqueAssignment(players, config.ct, routeAffinity);
  const weapons = assignWeapons(players, tAssignments);
  const roundPlans = buildRoundPlans(config, tAssignments, ctAssignments, players);

  return {
    schemaVersion: 1,
    generatedAt: Date.now(),
    id: `${selectionFingerprint(roster)}_${normalizeMapName(map)}`,
    map: normalizeMapName(map),
    mapLabel: config.label,
    genericMapPlan: Boolean(config.generic),
    evidence,
    assignments: {
      t: tAssignments.map((assignment) => ({ player: assignment.player.player, role: assignment.slot.id, roleLabel: assignment.slot.label, description: assignment.slot.description, fitScore: assignment.score })),
      ct: ctAssignments.map((assignment) => ({ player: assignment.player.player, position: assignment.slot.id, positionLabel: assignment.slot.label, fitScore: assignment.score, confidence: assignment.player.evidence.confidence })),
    },
    weapons,
    playbook: {
      rules: [
        "Plan bir emir değil, kanıta dayalı başlangıç noktasıdır; canlı maç sonucu önceliklidir.",
        "Entry ile Trader arasındaki mesafe takas alınabilecek kadar kısa tutulur.",
        "Aynı kaybedilen rota cooldown süresinde tekrar zorlanmaz.",
        "Ekonomi bozulursa pahalı rol dağılımı yerine takım buy seviyesi korunur.",
      ],
      roundPlans,
    },
    playerCards: players.map((player) => ({
      player: player.player,
      confidence: player.evidence,
      bestCTRoute: player.routes.filter((route) => route.side === "CT")[0] || null,
      bestTRoute: player.routes.filter((route) => route.side === "T")[0] || null,
      bestWeapon: player.weapons[0] || null,
      overall: player.overall,
    })),
    limitations: [
      "Sonuçlar yalnızca seçilen oyuncuların uygulama sahibiyle aynı takımda oynadığı, aynı haritadaki analiz edilmiş demolara dayanır.",
      "Seçilmemiş takım üyeleri için görev, rota veya silah tahmini üretilmez; plan yalnızca seçili oyuncuları gösterir.",
      "Normal oyuncu GSI akışında takım arkadaşlarının canlı konumu her zaman verilmez; takım planı round sonucu ve yerel geri bildirimle uyarlanır.",
    ],
  };
}
