# Peeky web server (website, web app and API). The desktop app is built separately with `npm run dist`.
FROM node:24-slim

ENV NODE_ENV=production \
    PORT=8787 \
    PEEKY_DATA_DIR=/data

WORKDIR /app
COPY package.json package-lock.json ./
# Electron is a devDependency, so the server image stays small.
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY web ./web
COPY src/parse.js src/buddies.js ./src/

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
