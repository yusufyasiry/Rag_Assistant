# 1) Build stage
FROM node:18-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# CRA needs REACT_APP_* at build time
ARG REACT_APP_API_URL
ENV REACT_APP_API_URL=$REACT_APP_API_URL

RUN npm run build

# 2) Serve with Nginx
FROM nginx:alpine

# Configure SPA fallback
RUN rm -rf /usr/share/nginx/html/* \
 && printf 'server {\n\
  listen 0.0.0.0:8080;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location / {\n\
    try_files $uri /index.html;\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf

COPY --from=build /app/build /usr/share/nginx/html

ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "nginx -g 'daemon off;' -c /etc/nginx/nginx.conf"]
