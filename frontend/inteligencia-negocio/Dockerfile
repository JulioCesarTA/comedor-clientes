# ============ STAGE 1: build ============
FROM node:20-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost:8080
ARG NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:8085
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_KEYCLOAK_URL=$NEXT_PUBLIC_KEYCLOAK_URL
COPY package.json next.config.js tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY app ./app
COPY public ./public
COPY middleware.ts ./middleware.ts
RUN npm run build

# ============ STAGE 2: runtime ============
FROM node:20-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
RUN chown -R app:app /app
USER app
EXPOSE 3003
ENV PORT=3003 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
