# Community reference image. The Node image tag is pinned to a tested release.
FROM node:22.18.0-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY --chown=node:node . .

RUN mkdir -p /data/artifacts /tmp/zeus-home \
    && chown -R node:node /data/artifacts /tmp/zeus-home

ENV HOME=/tmp/zeus-home
ENV ZEUS_OUTPUT_ROOT=/data/artifacts

USER node

ENTRYPOINT ["node", "cli/zeus.js"]
CMD ["--help"]
