FROM node:22-alpine

WORKDIR /workspace

COPY . .

RUN npm install
RUN cd apps/worker && npm run build

CMD ["node", "apps/worker/dist/apps/worker/src/index.js"]
