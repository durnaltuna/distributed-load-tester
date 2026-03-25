FROM node:22-alpine

WORKDIR /workspace

COPY . .

RUN npm install
RUN cd apps/orchestrator && npm run build

EXPOSE 3000

CMD ["node", "apps/orchestrator/dist/apps/orchestrator/src/index.js"]
