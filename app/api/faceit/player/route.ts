export async function GET(request: Request) {
  try {
    const apiKey = process.env.FACEIT_API_KEY || request.headers.get("X-Faceit-Api-Key")?.trim();
    if (!apiKey) return Response.json({ error: "FACEIT Data API key gerekli. Ayarlardaki resmî geliştirici bağlantısından oluşturabilirsin." }, { status: 400 });
    const nickname = new URL(request.url).searchParams.get("nickname")?.trim();
    if (!nickname) return Response.json({ error: "FACEIT kullanıcı adı gerekli." }, { status: 400 });
    const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
    const playerResponse = await fetch(`https://open.faceit.com/data/v4/players?nickname=${encodeURIComponent(nickname)}&game=cs2`, { headers });
    if (!playerResponse.ok) return Response.json({ error: "FACEIT oyuncusu bulunamadı." }, { status: playerResponse.status === 404 ? 404 : 502 });
    type FaceitPlayer = { player_id: string; nickname: string; avatar?: string; country?: string; faceit_url?: string; games?: Record<string, unknown> };
    const player = (await playerResponse.json()) as FaceitPlayer;
    const historyResponse = await fetch(`https://open.faceit.com/data/v4/players/${player.player_id}/history?game=cs2&offset=0&limit=20`, { headers });
    const history = (historyResponse.ok ? await historyResponse.json() : { items: [] }) as { items?: unknown[] };
    return Response.json({
      player: { id: player.player_id, nickname: player.nickname, avatar: player.avatar, country: player.country, faceitUrl: player.faceit_url, game: player.games?.cs2 },
      matches: history.items || [],
    });
  } catch {
    return Response.json({ error: "FACEIT servisine ulaşılamadı." }, { status: 502 });
  }
}
