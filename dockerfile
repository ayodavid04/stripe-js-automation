FROM node:18-alpine

WORKDIR /app

# Copy only necessary files first for better cache
COPY package*.json ./

# Install prod dependencies only
RUN npm install --omit=dev

# Copy the rest of the app
COPY . .

# Expose app portEXPOSE 8080

# Run the app
CMD ["npm", "start"]

# Healthcheck to ensure the app is runningHEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD wget --spider -q http://localhost:10000/ping || exit 1
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD wget --spider -q http://localhost:10000/ping || exit 1

