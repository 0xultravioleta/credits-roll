FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY overlay/package.json overlay/package.json
RUN npm ci
COPY . .
RUN npm run build && npm test && npm prune --omit=dev

FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates ffmpeg=7:5.1.9-0+deb12u1 python3-venv \
    && python3 -m venv /opt/streamlink \
    && /opt/streamlink/bin/pip install --no-cache-dir streamlink==8.6.2 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app /data && chown node:node /data && chmod 700 /data
ENV NODE_ENV=production PATH="/opt/streamlink/bin:${PATH}" HOME=/tmp
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/public ./server/public
COPY --from=build /app/overlay/dist ./overlay/dist
USER node
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
