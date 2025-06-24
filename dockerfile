# Use official lightweight Node.js image
FROM node:18-alpine

# Set working directory inside container
WORKDIR /app

# Copy package.json and package-lock.json first (better for caching)
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy the rest of the project
COPY . .

# Expose the port (ensure it matches your app PORT, defaults to 10000)
EXPOSE 10000

# Start the app
CMD ["node", "app.js"]
