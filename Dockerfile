FROM node:20-slim

# Install Chromium, Xvfb, x11vnc
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium xvfb x11vnc \
    fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_BIN=/usr/bin/chromium

RUN npm install -g agent-browser@latest

WORKDIR /app
COPY package.json server.js start.sh ./
RUN chmod +x start.sh
RUN npm install
RUN mkdir -p /app/profiles

EXPOSE 3000

CMD ["./start.sh"]
