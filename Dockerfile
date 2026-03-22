FROM node:20-slim

# Install Chromium and Xvfb (much lighter than full Chrome)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium xvfb \
    fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer/agent-browser to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_BIN=/usr/bin/chromium

# Install agent-browser globally
RUN npm install -g agent-browser@latest

WORKDIR /app
COPY package.json server.js ./
RUN npm install
RUN mkdir -p /app/profiles

EXPOSE 3000

CMD ["bash", "-c", "Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp &>/dev/null & export DISPLAY=:99 && node server.js"]
