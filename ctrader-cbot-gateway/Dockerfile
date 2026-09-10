FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    CBOT_WS_HOST=0.0.0.0 \
    CBOT_WS_PORT=25346 \
    CBOT_CONTROL_HOST=0.0.0.0 \
    CBOT_CONTROL_PORT=8790
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./package.json
COPY src ./src
USER node
EXPOSE 25346 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8790/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
