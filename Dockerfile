# Use the official Playwright image which includes Node.js and all browser dependencies.
FROM mcr.microsoft.com/playwright:v1.44.1-jammy

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
# This is done separately to leverage Docker's layer caching.
COPY package*.json ./

# Install app dependencies
# Using "npm ci" is often better in CI/CD for reproducible builds
# but "npm install" is fine for this project.
RUN npm install

# Bundle app source by copying everything else
COPY . .

# Your app runs on port 3000, so expose it
EXPOSE 3000

# Define the command to run your app
CMD [ "npm", "start" ]