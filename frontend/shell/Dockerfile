FROM node:20-alpine AS build
WORKDIR /app
ARG VITE_KEYCLOAK_URL=http://localhost:8085
ARG VITE_API_URL=http://localhost:8080
ARG VITE_REMOTE_PORTAL=http://localhost:3002/assets/remoteEntry.js
ARG VITE_BACKOFFICE_URL=http://localhost:3001?embedded=1
ARG VITE_BI_URL=http://localhost:3003?embedded=1
ENV VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_REMOTE_PORTAL=$VITE_REMOTE_PORTAL
ENV VITE_BACKOFFICE_URL=$VITE_BACKOFFICE_URL
ENV VITE_BI_URL=$VITE_BI_URL
COPY package.json tsconfig.json vite.config.ts index.html ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npm run build

FROM nginx:alpine
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK CMD wget -q -O - http://localhost/ > /dev/null || exit 1
