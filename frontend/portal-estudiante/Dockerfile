FROM node:20-alpine AS build
WORKDIR /app
ARG VITE_API_URL=http://localhost:8080
ARG VITE_KEYCLOAK_URL=http://localhost:8085
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL
COPY package.json tsconfig.json vite.config.ts index.html ./
RUN npm install --no-audit --no-fund
COPY src ./src
COPY public ./public
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
