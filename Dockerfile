FROM node:20-alpine

WORKDIR /usr/src/app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy source
COPY . .

ENV NODE_ENV=production
EXPOSE 5000

CMD ["npm", "start"]
