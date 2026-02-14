FROM apify/actor-node:22

COPY package.json ./
RUN npm install --omit=dev --omit=optional

COPY dist/ ./dist/

CMD ["node", "dist/main.js"]
