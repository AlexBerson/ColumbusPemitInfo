# Use an official Node.js runtime as a parent image.
# The 'alpine' version is a lightweight Linux distribution.
FROM node:20-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
# This is done separately to leverage Docker's layer caching.
COPY package*.json ./

# Install app dependencies
RUN npm install

# Bundle app source by copying everything else
COPY . .

# Your app runs on port 3000, so expose it
EXPOSE 3000

# Define the command to run your app
CMD [ "npm", "start" ]