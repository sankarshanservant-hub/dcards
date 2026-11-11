FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY seed ./seed
# База данных и загруженные изображения хранятся в томе /data — их нужно сохранять между обновлениями.
ENV DATA_DIR=/data PORT=3000
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server/index.js"]
