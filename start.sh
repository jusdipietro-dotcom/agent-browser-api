#!/bin/bash

# Start virtual display
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp &>/dev/null &
export DISPLAY=:99
sleep 1

# Start VNC server on display :99 (password from env or default)
VNC_PASS=${VNC_PASSWORD:-agent2026}
x11vnc -display :99 -forever -shared -rfbport 5900 -passwd "$VNC_PASS" &>/dev/null &
sleep 1

# Start noVNC web client (proxies VNC to websocket on port 6080)
websockify --web /usr/share/novnc 6080 localhost:5900 &>/dev/null &

echo "VNC ready on port 6080 (web) / 5900 (native)"
echo "Password: $VNC_PASS"

# Start API server
node server.js
