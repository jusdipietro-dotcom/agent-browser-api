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

# Download noVNC browser client (ESM version from GitHub)
RUN apt-get update && apt-get install -y --no-install-recommends wget unzip \
    && wget -q https://github.com/novnc/noVNC/archive/refs/tags/v1.5.0.zip -O /tmp/novnc.zip \
    && unzip -q /tmp/novnc.zip -d /tmp \
    && mkdir -p /app/novnc \
    && cp -r /tmp/noVNC-1.5.0/core /app/novnc/core \
    && cp -r /tmp/noVNC-1.5.0/vendor /app/novnc/vendor \
    && cp /tmp/noVNC-1.5.0/vnc.html /app/novnc/ \
    && rm -rf /tmp/novnc.zip /tmp/noVNC-1.5.0 \
    && apt-get purge -y wget unzip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY package.json server.js start.sh ./
RUN chmod +x start.sh
RUN npm install
RUN mkdir -p /app/profiles

EXPOSE 3000

CMD ["./start.sh"]
