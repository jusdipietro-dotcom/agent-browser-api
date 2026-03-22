FROM node:20-bookworm

# Install Chrome dependencies + Xvfb
RUN apt-get update && apt-get install -y \
    wget gnupg2 ca-certificates \
    xvfb \
    fonts-liberation fonts-noto-color-emoji \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 \
    libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxshmfence1 \
    python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install Chrome for Testing (stable)
RUN npx @puppeteer/browsers install chrome@stable --path /opt/chrome \
    && ln -s $(find /opt/chrome -name chrome -type f | head -1) /usr/local/bin/chrome

# Install agent-browser globally
RUN npm install -g agent-browser@latest

# Create app directory
WORKDIR /app

# Copy API server
COPY package.json server.js ./

# Install dependencies
RUN npm install

# Create profiles directory
RUN mkdir -p /app/profiles

# Expose port
EXPOSE 3000

# Start Xvfb + API server
CMD ["bash", "-c", "Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp &>/dev/null & export DISPLAY=:99 && node server.js"]
