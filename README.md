<div align="center">

  <img src="public/logo.svg" alt="NTVio" width="96" height="96" />

  # NTVio

  **Application web de streaming en direct et addon Stremio auto-hébergé.**  
  Agrégateur multi-sources pour chaînes TV 24/7 et événements sportifs.

  [![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-339933?style=flat-square&logo=node.js)](https://nodejs.org/)
  [![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
  [![Docker](https://img.shields.io/badge/docker-ready-2496ed?style=flat-square&logo=docker)](Dockerfile)
  [![Tailscale](https://img.shields.io/badge/tailscale-supported-24292e?style=flat-square&logo=tailscale)](DOCKER_TAILSCALE.md)

</div>

---

## Présentation

**NTVio** est une solution hybride combinant :
1. **Une application web autonome (SPA)** pour rechercher, planifier et regarder des flux vidéo directement dans le navigateur.
2. **Un addon officiel Stremio v3** pour intégrer les flux dans l'écosystème Stremio (Android TV, Apple TV, PC, mobile).

Le serveur unifie plusieurs clusters de diffusion tiers (NTV.cx, DLive.sx, LiveLive24/Falcon), déduplique les événements et assure le relais des flux via un proxy HLS transparent pour contourner les restrictions réseau et CORS.

---

## Fonctionnalités

### Application Web
- **Lecteur HLS natif** : Basé sur HLS.js avec sélection manuelle/automatique de la qualité et gestion du buffer.
- **Support des flux intégrés (Embeds)** : Iframe isolée et sécurisée (`sandbox`) pour les retransmissions nécessitant un player externe.
- **Routage SPA & Deep Linking** : Navigation sans rechargement de page (`pushState`) et URLs directes (`/watch?id=...`).
- **Programme interactif** : Filtrage par date, sport, compétition et recherche plein texte instantanée.
- **Design sobre** : Interface sombre inspirée d'Obsidian, adaptée au bureau comme au mobile.

### Addon Stremio
- **Compatibilité protocole v3** : Fonctionne sur toutes les plateformes Stremio (Desktop, Android TV, Stremio Web).
- **Catalogue Sports** : Matchs en direct classés par discipline avec statut `LIVE` et logos d'équipes.
- **Catalogue Chaînes** : Indexation par pays de plus de 10 000 canaux 24/7.
- **Page de configuration (`/configure`)** : Sélection des bouquets de pays et installation en 1 clic (`stremio://`).

### Moteur de Streaming & Réseau
- **Déduplication multi-serveurs** : Regroupement des flux identiques issus de différents fournisseurs sous une même fiche.
- **Proxy HLS / TS (`/proxy/hls`)** : Réécriture des flux m3u8 et gestion des en-têtes HTTP (`Referer`, `Origin`, `Access-Control-Allow-Private-Network`).
- **Tolérance de panne** : Gestion dynamique de serveurs miroirs avec bascule automatique.
- **Console d'administration (`/admin`)** : Monitoring des ressources, gestion des miroirs et outil de diagnostic de latence.

---

## Architecture

```
[ Sources Externes ] 
  ├── NTV.cx (Titan / Kobra)
  ├── DLive.sx (Phoenix)
  └── LiveLive24 (Falcon)
          │
          ▼
[ Serveur NTVio (Node.js / Express :7000) ]
  ├── Moteur d'agrégation & normalisation
  ├── Proxy HLS / TS (CORS & Referer rewrite)
  └── Gestionnaire de miroirs de secours
          │
          ├─────────────────────────┐
          ▼                         ▼
   [ Application Web ]       [ Client Stremio ]
     http://localhost:7000     stremio://localhost:7000/manifest.json
```

---

## Démarrage rapide

### Prérequis
- **Node.js** 20.x ou version ultérieure
- **npm** (inclus avec Node.js)

### Installation locale

```bash
# Cloner le dépôt
git clone https://github.com/Frenchouioui/NTVXC.git
cd NTVXC

# Installer les dépendances
npm install

# Lancer le serveur
npm start
```

Le serveur écoute par défaut sur le port `7000`.

### Accès aux services

| Point d'accès | URL | Usage |
| :--- | :--- | :--- |
| **Application Web** | `http://localhost:7000/` | Navigation, calendrier et lecture vidéo |
| **Configuration Stremio** | `http://localhost:7000/configure` | Personnalisation et installation de l'addon |
| **Console Admin** | `http://localhost:7000/admin` | État du serveur, gestion des miroirs et tests |
| **Manifest Stremio** | `http://localhost:7000/manifest.json` | URL d'installation directe |

---

## Déploiement

### Docker Compose

Un fichier `docker-compose.yml` est inclus pour un déploiement standard en conteneur :

```yaml
services:
  ntvio:
    build: .
    container_name: ntvio-live
    restart: unless-stopped
    ports:
      - "7000:7000"
    environment:
      - PORT=7000
      - NODE_ENV=production
```

Démarrage :
```bash
docker compose up -d --build
```

### Accès distant via Tailscale

Pour rendre votre instance accessible en toute sécurité depuis l'extérieur (Smart TV en déplacement, smartphone) sans ouvrir de port public sur votre routeur, référez-vous au guide :  
👉 **[Documentation de déploiement Tailscale](DOCKER_TAILSCALE.md)**

---

## API & Endpoints

### Addon Stremio
- `GET /manifest.json` : Manifest de l'addon Stremio.
- `GET /catalog/:type/:id.json` : Catalogues des sports et chaînes TV.
- `GET /stream/:type/:id.json` : Résolution des flux pour un élément donné.

### API Interne (Application Web)
- `GET /api/stats` : Statistiques générales (flux actifs, compteurs, état des clusters).
- `GET /api/matches` : Liste des rencontres avec filtres (`sport`, `live`, `server`, `q`).
- `GET /api/channels` : Liste paginée des chaînes (`country`, `server`, `offset`, `limit`).
- `GET /api/schedule` : Calendrier interactif (`date`, `sport`, `q`).
- `GET /api/stream/:id` : Résolution complète des flux disponibles pour un identifiant.
- `GET /proxy/hls?url=...&ref=...` : Proxy HLS avec réécriture d'en-têtes.

### Administration (`/api/admin`)
- `GET /api/admin/status` : Métriques système (RAM, uptime) et statut des miroirs.
- `GET /api/admin/health` : Test de connectivité sur l'ensemble des clusters.
- `POST /api/admin/clear-cache` : Purge du cache en mémoire.
- `POST /api/admin/test-stream` : Analyse et mesure de latence d'un flux.

---

## Structure du projet

```
NTVXC/
├── public/                 # Interface Web (HTML5, Vanilla JS, CSS)
│   ├── index.html          # SPA principale
│   ├── app.js              # Logique applicative et routage
│   ├── player.js           # Gestionnaire du lecteur HLS et iframes
│   ├── configure.html      # Interface de configuration Stremio
│   ├── admin.html          # Console d'administration
│   └── style.css           # Thème visuel Obsidian
├── src/                    # Backend Node.js (ES Modules)
│   ├── server.js           # Point d'entrée et configuration Express
│   ├── config.js           # Variables d'environnement et constantes
│   ├── routes/             # Endpoints (Stremio, Web API, Admin)
│   └── services/           # Logique métier, agrégation et proxying
├── Dockerfile              # Image minimale alpine (utilisateur non-root)
├── docker-compose.yml      # Configuration Docker Compose
├── DOCKER_TAILSCALE.md     # Guide de configuration réseau Tailscale
└── package.json            # Dépendances et scripts d'exécution
```

---

## Avertissement légal

Ce projet est un agrégateur de métadonnées et de liens open-source destiné à des fins éducatives et d'interopérabilité technique. **NTVio n'héberge, n'enregistre et ne diffuse directement aucun fichier multimédia**. Les flux sont transmis par des services tiers publiquement accessibles sur le web. Les utilisateurs sont responsables de l'usage qu'ils font de cet outil conformément aux législations applicables dans leur pays.

---

## Licence

Distribué sous licence **MIT**. Voir [LICENSE](LICENSE) pour plus de détails.
