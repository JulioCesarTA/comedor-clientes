FROM node:20-alpine AS build
WORKDIR /app
COPY package.json angular.json tsconfig.json ./
RUN npm install --no-audit --no-fund --legacy-peer-deps
COPY src ./src
RUN npx ng build --configuration=production || npx ng build

FROM nginx:alpine
COPY --from=build /app/dist/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
