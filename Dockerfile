# ImmoRadar — productie-image.
#
# ─── ÉÉN IMAGE, TWEE ROLLEN ──────────────────────────────────────────────────
#
# Dezelfde image draait als webserver (`npm start`) en als achtergrondworker
# (`npm run worker`). Ze delen alle code en alle configuratie; alleen het
# startcommando verschilt. Twee images bouwen zou betekenen dat de collector en
# het dashboard kunnen gaan afwijken in versie, en dan verwerkt de ene laag data
# volgens regels die de andere niet kent.
#
# Prisma 7 gebruikt een TypeScript-client met de pg-driver: geen Rust-engine,
# geen OpenSSL-afhankelijkheid, geen platformgebonden binaries in de image.

FROM node:22-alpine AS deps
WORKDIR /app

# Het schema en de Prisma-config moeten er vóór `npm ci` zijn: de postinstall
# genereert de client naar src/generated/prisma.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# `npm ci` en niet `npm install`: de lockfile is de waarheid, en een build die
# stilzwijgend een nieuwere minor binnenhaalt is niet reproduceerbaar.
RUN npm ci


FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=deps /app/src/generated ./src/generated

# Een DATABASE_URL die alleen de env-validatie tevredenstelt. Er wordt tijdens
# de build geen verbinding geopend — alle pagina's zijn dynamisch (ze hangen van
# de sessie af), dus er valt niets te prerenderen dat de database raakt.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build


FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# De volledige node_modules: de worker draait via tsx op de TypeScript-bronnen,
# en `prisma migrate deploy` heeft de CLI nodig bij het opstarten. Een kleinere
# image zou betekenen dat migraties en de collector elk hun eigen image krijgen
# — meer bewegende delen voor minder megabytes.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/src ./src

COPY package.json next.config.ts prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY fixtures ./fixtures

# Niet als root draaien. Het node-image levert deze gebruiker al.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

# Wordt door docker-compose overschreven; dit is de zinnigste standaard.
CMD ["npm", "start"]
