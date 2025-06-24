# Use official lightweight Node.js image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the app
COPY . .

# Expose the app port
EXPOSE 10000

# Run the application
CMD ["npm", "start"]
