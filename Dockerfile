FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci
COPY client client
RUN npm run build
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY server server
COPY --from=build /app/client/dist client/dist
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node
EXPOSE 4000
CMD ["sh", "-c", "npm run migrate && npm run seed && npm start"]
