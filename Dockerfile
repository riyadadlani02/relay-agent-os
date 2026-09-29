FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4310 DATABASE_PATH=/app/data/relay.db
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir data && chown node:node data
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src/shared.ts ./src/shared.ts
USER node
EXPOSE 4310
CMD ["npm", "start"]
