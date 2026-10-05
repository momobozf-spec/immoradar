#!/usr/bin/env bash
# Eenmalige inrichting van een verse Ubuntu 24.04-server voor ImmoRadar.
# Als root uitvoeren:  bash setup-server.sh
#
# Doet alleen wat nodig is: Docker uit de Ubuntu-pakketten, een firewall die
# enkel SSH, HTTP en HTTPS doorlaat, en automatische beveiligingsupdates.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Voer dit uit als root." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get -y install docker.io docker-compose-v2 ufw unattended-upgrades

systemctl enable --now docker

# Firewall: SSH, HTTP (voor het certificaat) en HTTPS. De database en de app
# hebben geen poort naar buiten (zie docker-compose.yml).
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# Beveiligingsupdates automatisch installeren.
dpkg-reconfigure -f noninteractive unattended-upgrades

# 2 GB swap: de eerste build van de app vraagt even veel geheugen.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

mkdir -p /opt/immoradar
echo
echo "Klaar. Docker: $(docker --version)"
echo "Zet de projectbestanden in /opt/immoradar en volg deploy/README.md vanaf stap 5."
