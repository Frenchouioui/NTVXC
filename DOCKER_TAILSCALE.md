# 🐳 Déploiement Docker & Accès Distant avec Tailscale

Ce guide vous explique comment déployer **NTVio Live** dans Docker et y accéder en toute sécurité depuis n'importe où (smartphone, tablette, TV, PC portable) grâce à **Tailscale**, sans ouvrir le moindre port sur votre box Internet.

---

## 🚀 1. Lancement Rapide avec Docker

Dans le dossier du projet :

```bash
# Construire et démarrer en arrière-plan
docker compose up -d

# Voir les logs en direct
docker compose logs -f

# Arrêter le conteneur
docker compose down
```

L'application est disponible immédiatement sur :
👉 **`http://localhost:7000`**

---

## 🔒 2. Accès à Distance Sécurisé avec Tailscale

Grâce à l'architecture de NTVio Live (qui calcule dynamiquement les URLs de flux selon l'adresse utilisée pour s'y connecter et gère `trust proxy`), vous pouvez y accéder à distance sans aucune reconfiguration !

Voici les **3 façons** de l'utiliser avec Tailscale :

### Méthode A : Tailscale sur la Machine Hôte (Recommandée & la plus simple)

Si votre serveur hôte (NAS Synology/QNAP, Mini PC, Raspberry Pi, serveur Linux ou Windows) a déjà Tailscale installé :

1. Lancez simplement `docker compose up -d`.
2. Ouvrez l'application Tailscale sur votre téléphone, PC portable ou tablette.
3. Connectez-vous sur votre navigateur via :
   - **L'IP Tailscale (100.x.y.z)** : `http://100.x.y.z:7000`
   - **Ou le nom MagicDNS** : `http://mon-serveur:7000`
4. Tous les flux vidéo, proxies HLS et logos fonctionnent automatiquement !

---

### Méthode B : Tailscale Serve (Nom de Domaine + HTTPS Automatique)

Si vous voulez une URL propre avec certificat SSL valide (très utile pour installer l'addon dans Stremio Web sur `https://web.stremio.com`) :

Sur votre machine hôte avec Tailscale, tapez simplement :
```bash
tailscale serve --bg 7000
```

Tailscale vous attribuera une adresse sécurisée du type :
👉 **`https://mon-serveur.tailnet-xyz.ts.net`**

Tout votre Tailnet pourra y accéder en HTTPS direct !

---

### Méthode C : Conteneur Tailscale Dédié (Sidecar)

Si vous préférez que le conteneur NTVio possède sa propre identité isolée sur votre réseau Tailscale, vous pouvez utiliser ce `docker-compose.yml` combiné :

```yaml
services:
  # Nœud Tailscale dédié
  tailscale:
    image: tailscale/tailscale:latest
    container_name: ntvio-tailscale
    hostname: ntvio-live
    environment:
      - TS_AUTHKEY=tskey-auth-xxxxxx?ephemeral=false  # Clé auth depuis https://login.tailscale.com/admin/settings/keys
      - TS_STATE_DIR=/var/lib/tailscale
      - TS_USERSPACE=false
    volumes:
      - ./tailscale-state:/var/lib/tailscale
      - /dev/net/tun:/dev/net/tun
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    restart: unless-stopped

  # Application NTVio routée via Tailscale
  ntvio:
    build: .
    container_name: ntvio-live
    network_mode: "service:tailscale"
    restart: unless-stopped
    depends_on:
      - tailscale
    environment:
      - PORT=7000
      - NODE_ENV=production
```

NTVio apparaîtra alors comme une machine indépendante nommée `ntvio-live` dans votre console d'administration Tailscale !

---

## 📱 Utilisation sur Smart TV / Android TV / Fire TV

Une fois connecté via Tailscale :
- Vous pouvez ouvrir l'interface web complète sur le navigateur de votre TV.
- Ou dans Stremio TV : installer l'addon avec l'adresse `http://<IP-Tailscale>:7000/manifest.json`.
