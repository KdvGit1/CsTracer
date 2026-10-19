#!/usr/bin/env bash
# TRACER Discord botu — Oracle Cloud Always Free (Ampere A1, Ubuntu 22.04/24.04 ARM) kurulumu.
#
#   sudo bash oracle-setup.sh                      # depo zaten /opt/tracer'da ise
#   sudo bash oracle-setup.sh https://github.com/KULLANICI/CsTracer.git [dal]
#
# Yaptıkları: Node.js 22, yazı tipleri, 4 GB swap, "tracer" sistem kullanıcısı,
# bağımlılıklar (npm ci), radar görselleri, systemd servisi. İsteğe bağlı olarak
# OPEN_HTTP=1 ile 80/443 portlarını işletim sistemi güvenlik duvarında açar.
set -euo pipefail

REPO_URL="${1:-}"
BRANCH="${2:-main}"
APP_DIR="${APP_DIR:-/opt/tracer}"
BOT_DIR="$APP_DIR/discord-bot"
SERVICE_USER="tracer"

if [[ $EUID -ne 0 ]]; then
  echo "Bu betiği sudo ile çalıştır." >&2
  exit 1
fi

echo "==> Sistem paketleri"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git fonts-dejavu-core fonts-noto-core fonts-noto-color-emoji

if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  echo "==> Node.js 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

if ! swapon --show | grep -q .; then
  echo "==> 4 GB swap (analiz anlık bellek tepeleri için)"
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null
  grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
fi

id "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/home/$SERVICE_USER" --shell /usr/sbin/nologin "$SERVICE_USER"

if [[ -n "$REPO_URL" ]]; then
  if [[ -d "$APP_DIR/.git" ]]; then
    echo "==> Depo güncelleniyor"
    git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
    git -C "$APP_DIR" checkout -B "$BRANCH" FETCH_HEAD
  else
    echo "==> Depo klonlanıyor"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  fi
fi
if [[ ! -f "$BOT_DIR/package.json" ]]; then
  echo "$BOT_DIR bulunamadı. Depo adresini ilk argüman olarak ver." >&2
  exit 1
fi

echo "==> Bağımlılıklar (yalnız çalışma zamanı)"
cd "$BOT_DIR"
npm ci --omit=dev --no-audit --no-fund
echo "==> Radar görselleri"
node scripts/update-maps.mjs || echo "Uyarı: radar görselleri indirilemedi; sonra 'npm run maps' çalıştır."

mkdir -p "$BOT_DIR/data"
if [[ ! -f "$BOT_DIR/.env" ]]; then
  cp "$BOT_DIR/.env.example" "$BOT_DIR/.env"
  echo "==> $BOT_DIR/.env oluşturuldu."
fi

env_value() { grep -E "^$1=" "$BOT_DIR/.env" | head -1 | cut -d= -f2- || true; }
set_env() {
  if grep -qE "^$1=" "$BOT_DIR/.env"; then sed -i "s|^$1=.*|$1=$2|" "$BOT_DIR/.env"; else echo "$1=$2" >> "$BOT_DIR/.env"; fi
}
# Discord'a "ben kimim?" diye sorar; token geçerliyse botun kimliğini döndürür.
bot_id() {
  local response
  response="$(curl -s --max-time 15 -H "Authorization: Bot $1" https://discord.com/api/v10/users/@me || true)"
  printf '%s' "$response" | grep -o '"id": *"[0-9]\{16,22\}"' | head -1 | grep -o '[0-9]\{16,22\}' || true
}

# Yeni başlayanlar için: yalnız bot token'ı sorulur ve Discord'a sorularak doğrulanır.
if [[ -z "$(env_value DISCORD_TOKEN)" && -r /dev/tty ]]; then
  echo
  echo "==> Discord bot token'ı"
  echo "    Developer Portal → uygulaman → Bot → Reset Token ile aldığın token'ı yapıştır."
  echo "    Yazarken ekranda görünmez; yapıştırıp Enter'a bas. (Boş bırakırsan sonra .env'e yazabilirsin.)"
  for _ in 1 2 3; do
    read -rsp "    Token: " TOKEN < /dev/tty || TOKEN=""
    echo
    TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
    [[ -z "$TOKEN" ]] && break
    if [[ ! "$TOKEN" =~ ^[A-Za-z0-9_.-]{50,100}$ ]]; then
      echo "    Bu bir bot token'ına benzemiyor. Tekrar dene."
      continue
    fi
    BOT_ID="$(bot_id "$TOKEN")"
    if [[ -n "$BOT_ID" ]]; then
      set_env DISCORD_TOKEN "$TOKEN"
      echo "    ✓ Token doğru. Bot kimliği: $BOT_ID"
      break
    fi
    echo "    Discord bu token'ı kabul etmedi. Developer Portal'da Reset Token ile yenisini alıp tekrar dene."
  done
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
chmod 600 "$BOT_DIR/.env"

echo "==> systemd servisi"
sed "s#__BOT_DIR__#$BOT_DIR#g; s#__USER__#$SERVICE_USER#g" "$BOT_DIR/deploy/tracer-bot.service" > /etc/systemd/system/tracer-bot.service
systemctl daemon-reload
systemctl enable tracer-bot.service

if [[ "${OPEN_HTTP:-0}" == "1" ]]; then
  echo "==> 80/443 portları (Oracle Ubuntu imajları iptables ile kapalı gelir)"
  for port in 80 443; do
    iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null || iptables -I INPUT 6 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
  done
  command -v netfilter-persistent >/dev/null && netfilter-persistent save || true
  echo "   Ayrıca Oracle konsolunda VCN → Security List'e 80 ve 443 için ingress kuralı ekle."
fi

sudo -u "$SERVICE_USER" node --disable-warning=ExperimentalWarning scripts/check-install.mjs || true

TOKEN="$(env_value DISCORD_TOKEN)"
if [[ -z "$TOKEN" ]]; then
  cat <<EOF

Kurulum bitti ama bot token'ı girilmedi.
  1) Token'ı yaz:       sudo nano $BOT_DIR/.env   (DISCORD_TOKEN= satırı)
  2) Botu başlat:       sudo systemctl restart tracer-bot
  3) Günlükleri izle:   journalctl -u tracer-bot -f
EOF
  exit 0
fi

echo "==> Bot başlatılıyor"
systemctl restart tracer-bot.service
sleep 10
journalctl -u tracer-bot -n 15 --no-pager || true
APP_ID="$(bot_id "$TOKEN")"
cat <<EOF

Bot çalışıyor. Şimdi Discord'a ekle (bağlantıyı tarayıcıda aç):
  Sunucuna:  https://discord.com/oauth2/authorize?client_id=${APP_ID:-UYGULAMA_ID}&scope=bot+applications.commands&permissions=309237763072
  Kendine:   https://discord.com/oauth2/authorize?client_id=${APP_ID:-UYGULAMA_ID}&integration_type=1&scope=applications.commands
Sonra Discord'da /baslat yaz. Komutların görünmesi birkaç dakika sürebilir.

Günlükler:    journalctl -u tracer-bot -f
Ayarlar:      sudo nano $BOT_DIR/.env   (değiştirince: sudo systemctl restart tracer-bot)
Güncelleme:   sudo bash $BOT_DIR/deploy/oracle-setup.sh $REPO_URL $BRANCH
EOF
