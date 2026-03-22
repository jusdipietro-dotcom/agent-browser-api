#!/bin/bash

# Start virtual display
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp &>/dev/null &
export DISPLAY=:99
sleep 1

# Start VNC server (x11vnc) - no password for internal use, API has auth
x11vnc -display :99 -forever -shared -rfbport 5900 -nopw &>/dev/null &
sleep 1

echo "Xvfb + x11vnc ready (display :99, vnc :5900)"

# Start API server (includes websocket VNC proxy)
node server.js
