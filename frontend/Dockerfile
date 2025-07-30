# frontend/Dockerfile
FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Expose dev server port
EXPOSE 3000

# Use polling for file changes
ENV CHOKIDAR_USEPOLLING=true

CMD ["npm", "start"]
