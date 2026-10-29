# ProofRun needs exactly one browser: Chromium, driven headlessly to capture
# prospect sites and to verify the pages the model generates.
#
# Playwright's own base image is the easy route, but it ships Chromium, Firefox
# AND WebKit and lands at 3.72GB — most of which is downloaded on every cold
# start on a scale-to-zero host. Installing Chromium alone from the pinned
# playwright package cuts that by roughly two thirds.
#
# Installing the browser from the same package that drives it also removes a
# whole class of bug: with the base image, the image tag and the npm version
# must match exactly, or the container builds cleanly and then dies at
# browserType.launch() with "Executable doesn't exist at
# /ms-playwright/chromium_headless_shell-<n>". Here they cannot disagree.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# Dependencies first, so a source change does not invalidate the npm layer.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

# Chromium plus the system libraries it needs, and nothing else.
RUN npx playwright install --with-deps --only-shell chromium \
 && chmod -R a+rX /ms-playwright \
 && rm -rf /var/lib/apt/lists/*

COPY . .

# Memory and artifacts are the source of truth. Mount volumes over these in
# production or they reset on redeploy; on a scale-to-zero host they are
# ephemeral by definition, which is fine for a public demo and not for real use.
RUN mkdir -p data/runs data/mockups data/exports memory/prospects memory/runs \
 && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "web/server.js"]
