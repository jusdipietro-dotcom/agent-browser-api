FROM node:20-slim

# Install Chromium, Xvfb, x11vnc, noVNC (web-based VNC client)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium xvfb x11vnc \
    fonts-liberation fonts-noto-color-emoji \
    novnc websockify \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer/agent-browser to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_BIN=/usr/bin/chromium

# Install agent-browser globally
RUN npm install -g agent-browser@latest

WORKDIR /app
COPY package.json server.js start.sh ./
RUN chmod +x start.sh
RUN npm install
RUN mkdir -p /app/profiles

# 3000 = API, 6080 = noVNC web interface
EXPOSE 3000 6080

CMD ["./start.sh"]
