FROM apify/actor-node:22

COPY package.json ./
RUN npm install --omit=dev --omit=optional

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

CMD ["node", "dist/main.js"]
