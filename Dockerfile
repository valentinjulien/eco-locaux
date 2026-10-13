# ============================================================
#  Image de l'application Eco-Locaux Prospect.
#
#  L'application n'a aucune dépendance à l'exécution : tout tient
#  dans les modules de Node. Il n'y a donc ni npm install, ni étape
#  de compilation, ni couche de cache à gérer — seulement la copie
#  des fichiers. L'image fait quelques dizaines de mégaoctets, dont
#  l'essentiel est Node lui-même.
#
#  Playwright, qui sert aux tests de bout en bout, est une
#  dépendance de développement : elle n'entre pas dans l'image.
# ============================================================

FROM node:22-alpine

# Les signaux de Docker doivent atteindre Node, sinon l'arrêt propre
# du serveur n'est jamais déclenché et le conteneur est tué de force.
RUN apk add --no-cache tini

WORKDIR /app

# L'utilisateur « node » existe déjà dans l'image officielle.
# L'application ne doit jamais tourner en root.
COPY --chown=node:node package.json ./
COPY --chown=node:node public/ ./public/
COPY --chown=node:node api/ ./api/
COPY --chown=node:node scripts/serveur.js ./scripts/serveur.js

USER node

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Sonde interne : utile même si l'hébergeur n'en déclare pas.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/sante').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "scripts/serveur.js"]
