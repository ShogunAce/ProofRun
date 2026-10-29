# Playwright's own image, which already carries Chromium and the system
# libraries it needs. Installing those on a plain node image is the single
# fiddliest part of deploying anything that drives a headless browser.
FROM mcr.microsoft.com/playwright:v1.57.0-noble

ENV NODE_ENV=production \
    PORT=3000 \
    # The browsers are already in the image; do not download them again.
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

# Dependencies first, so a source change does not invalidate the npm layer.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

COPY . .

# Memory and artifacts are the source of truth. Mount volumes over these in
# production (see jobs/nebius-serverless-job.json) or they reset on redeploy.
RUN mkdir -p data/runs data/mockups data/exports memory/prospects memory/runs \
 && chown -R pwuser:pwuser /app

USER pwuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "web/server.js"]
