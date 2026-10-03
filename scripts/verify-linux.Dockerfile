FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/extension/package.json apps/extension/package.json
RUN npm ci --ignore-scripts
COPY . .
ENV NODE_ENV=test
RUN npm run verify && npm run test:sites -w @coinchecker/extension && npm run package
CMD ["npm", "run", "test:integration"]
