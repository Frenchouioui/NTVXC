# 📺 NTVio • Addon Stremio Live TV & Sports

Addon Stremio haute performance pour regarder plus de **10 000 chaînes de télévision en continu (24/7)** et **tous les événements sportifs mondiaux en direct** (Football, Ligue des Champions, Formule 1, MotoGP, NBA, UFC, Tennis, Rugby, etc.) propulsé par [ntv.cx](https://ntv.cx/).

Inspiré par le modèle de **TvMio**, avec une interface de configuration moderne, un décodage M3U8 natif, et un proxy HLS transparent.

---

## ⚡ Fonctionnalités

- **+10 360 Chaînes TV en Direct** : Couvrant France, USA, UK, Espagne, Portugal, Italie, Allemagne, Monde Arabe, etc.
- **Matchs & Sports en Direct** : Suivi en temps réel des matchs avec statut LIVE, affiches et métadonnées.
- **5 Clusters de serveurs NTV** : Titan (CDNLive), Phoenix (DaddyLive / DLHD), Falcon, Kobra, Raptor.
- **Support M3U8 (HLS) Natif** : Compatible avec tous les lecteurs Stremio (Android TV, Google TV, Windows, macOS, Linux, iOS, Steam Deck).
- **Proxy HLS Intégré** : Permet de contourner les restrictions CORS et de contourner les blocages FAI/Referers si nécessaire.
- **Portail de Configuration Web (`/configure`)** : Personnalisez vos bouquets, pays et serveurs, puis installez en 1 clic via `stremio://`.

---

## 🚀 Démarrage Rapide

### 1. Prérequis
- [Node.js](https://nodejs.org/) (version 18 ou supérieure)

### 2. Installation
```bash
git clone <repo-url>
cd NTVXC
npm install
```

### 3. Lancer le serveur
```bash
npm start
```

Le serveur démarrera sur le port **7000** :
- 🌐 Interface de configuration : [http://localhost:7000/configure](http://localhost:7000/configure)
- 📦 Manifest Stremio : `http://localhost:7000/manifest.json`
- ⚡ Lien d'installation rapide : `stremio://localhost:7000/manifest.json`

---

## 📱 Utilisation dans Stremio

1. Rendez-vous sur `http://localhost:7000/configure` (ou sur l'URL de votre serveur déployé).
2. Choisissez vos pays favoris (ex: France 🇫🇷, USA 🇺🇸, UK 🇬🇧) et vos serveurs.
3. Cliquez sur **« Installer sur Stremio »** : l'application Stremio s'ouvre automatiquement et vous propose d'ajouter **NTVio**.
4. Vous retrouverez les catalogues **⚽ NTV • Live Sports** et **📺 NTV • 24/7 Channels** dans l'onglet **Découvrir** de Stremio.

---

## 🌐 Déploiement en ligne gratuit (24/7)

Pour profiter de l'addon partout (sur votre Smart TV / Android TV ou mobile sans laisser votre PC allumé) :

### Option 1 : Render.com
1. Créez un compte gratuit sur [Render.com](https://render.com/).
2. Cliquez sur **New > Web Service** et liez votre dépôt GitHub.
3. Définissez la commande de build : `npm install`
4. Définissez la commande de démarrage : `npm start`
5. Récupérez votre URL Render (`https://votre-addon.onrender.com/configure`) et installez-la dans Stremio !

### Option 2 : Docker
```bash
docker build -t ntvio .
docker run -p 7000:7000 ntvio
```

---

## ⚖️ Avertissement légal
Ce projet est un agrégateur tiers open-source développé à des fins de recherche et de compatibilité multimédia avec le protocole Stremio. Les flux sont hébergés par des services tiers externes.
