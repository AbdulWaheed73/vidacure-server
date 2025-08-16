# 1. Build stage
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# 2. Production stage
FROM node:18-alpine AS prod
WORKDIR /app
COPY package*.json ./
# RUN npm ci --only=production
RUN npm install  
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
