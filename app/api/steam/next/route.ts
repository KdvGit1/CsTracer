export async function POST(request: Request) {
  try {
    const apiKey = process.env.STEAM_WEB_API_KEY;
    if (!apiKey) return Response.json({ error: "STEAM_WEB_API_KEY yapılandırılmadı." }, { status: 503 });
    const body = await request.json() as { steamid?: string; authCode?: string; knownCode?: string };
    if (!/^\d{17}$/.test(body.steamid || "") || !body.authCode || !body.knownCode) {
      return Response.json({ error: "SteamID64, Game Authentication Code ve son match token gerekli." }, { status: 400 });
    }
    const params = new URLSearchParams({
      key: apiKey,
      steamid: body.steamid!,
      steamidkey: body.authCode,
      knowncode: body.knownCode,
    });
    const response = await fetch(`https://api.steampowered.com/ICSGOPlayers_730/GetNextMatchSharingCode/v1?${params}`, {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 202) return Response.json({ nextCode: null, upToDate: true });
    if (!response.ok) return Response.json({ error: "Valve maç geçmişi sorgusu başarısız.", status: response.status }, { status: 502 });
    const nextCode = payload?.result?.nextcode;
    return Response.json({ nextCode: nextCode === "n/a" ? null : nextCode, upToDate: nextCode === "n/a" });
  } catch {
    return Response.json({ error: "Valve servisine ulaşılamadı." }, { status: 502 });
  }
}
