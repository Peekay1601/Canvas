# Hosted Script Builder for a claude.ai custom connector. The Playwright base image ships Chromium for PDF export.
FROM mcr.microsoft.com/playwright:v1.56.1-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY fonts ./fonts
RUN npx tsc && npm prune --omit=dev
ENV NODE_ENV=production PORT=8787 SCRIPT_BUILDER_DATA=/data
VOLUME /data
EXPOSE 8787
CMD ["node", "dist/index.js"]
