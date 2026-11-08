FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./

FROM node:20-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /app /app
RUN chown -R app:app /app
USER app
ENV PORT=4000
EXPOSE 4000
HEALTHCHECK CMD wget -q -O - http://localhost:4000/.well-known/apollo/server-health || exit 0
CMD ["node", "server.js"]
