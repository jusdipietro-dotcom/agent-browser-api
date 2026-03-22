FROM mcr.microsoft.com/playwright:v1.58.1-jammy

# Node.js already included in playwright image
# Chromium already included in playwright image
# Install Xvfb
RUN apt-get update && apt-get install -y xvfb && rm -rf /var/lib/apt/lists/*

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
