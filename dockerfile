FROM node:18-alpine

WORKDIR /app

# Copy only necessary files first for better cache
COPY package*.json ./

# Install prod dependencies only
RUN npm install --omit=dev

# Copy the rest of the app
COPY . .

# Expose app port
EXPOSE 10000

# Run the app
CMD ["npm", "start"]
