FROM node:22-alpine

WORKDIR /workspace

COPY . .

RUN npm install
RUN cd apps/dashboard && npm run build

EXPOSE 4173

CMD ["npm", "run", "-w", "dashboard", "preview"]
