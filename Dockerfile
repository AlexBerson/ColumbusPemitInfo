# Stage 1: Build the application
# Use the official Node.js 20 image as a base.
# Using a specific version is better for reproducibility.
FROM node:20-alpine AS builder

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies. Using 'npm ci' is recommended for CI/CD for faster, more reliable builds.
RUN npm ci

# Copy the rest of the application's source code
COPY . .

# Stage 2: Create the final, smaller production image
FROM node:20-alpine

WORKDIR /usr/src/app

# Copy the installed node_modules from the 'builder' stage
COPY --from=builder /usr/src/app/node_modules ./node_modules
# Copy the application code from the 'builder' stage
COPY --from=builder /usr/src/app .

# Expose the port the app runs on
EXPOSE 3000

# The command to run the application in production
CMD [ "npm", "start" ]

