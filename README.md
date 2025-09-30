# Columbus Parking Pass Manager

![Docker Image CI](https://github.com/alexberson/columbus-parking-pass/actions/workflows/docker-publish.yml/badge.svg)

A simple web application designed to automate the management of active vehicle license plates on the Columbus, OH parking permit website (`columbus.permitinfo.net`). It uses Playwright to perform browser automation, scraping your permit data and allowing you to switch the active plate with a single click, saving you the hassle of navigating the website manually.

The application provides a clean web interface and uses Server-Sent Events (SSE) to give you real-time feedback as it performs actions on your behalf.

## Features

*   **Automatic Login:** Securely uses your credentials to log into the permit portal.
*   **View Active Permits:** Scrapes and displays a list of your currently active permits.
*   **Manage Vehicle Plates:** For each permit, it shows the currently active plate and lists all other available plates on your account.
*   **One-Click Plate Change:** Switch the active vehicle for a permit with a single button press.
*   **Real-Time Logging:** The web UI shows a live log of the actions the scraper is performing in the background.
*   **Containerized:** Fully containerized with Docker for easy development and deployment.
*   **CI/CD Ready:** Includes a GitHub Actions workflow to automatically build and publish a production-ready Docker image to Docker Hub.

## Tech Stack

*   **Backend:** Node.js, Express.js
*   **Scraping:** Playwright
*   **Frontend:** EJS (Embedded JavaScript templates), Vanilla JavaScript
*   **Containerization:** Docker, Docker Compose
*   **CI/CD:** GitHub Actions

## Prerequisites

*   Git
*   Docker
*   Docker Compose

## Environment Variables

To run this application, you need to create a `.env` file in the root of the project.

```bash
# .env

# Your login credentials for columbus.permitinfo.net
SCRAPER_USERNAME="your-email@example.com"
SCRAPER_PASSWORD="your-password"

# (Optional) Set to 'true' to enable debug features, like taking screenshots during scraping.
DEBUG_MODE="false"

# (Optional) The port the web server will run on. Defaults to 3000.
PORT=3000
```

---

## Getting Started

There are two primary ways to run this application: for local development or as a deployed production service.

### 1. Local Development

This method is ideal for making changes to the code. It uses `nodemon` for live-reloading and mounts your local source code into the container.

1.  **Clone the repository:**
    ```sh
    git clone https://github.com/alexberson/columbus-parking-pass.git
    cd columbus-parking-pass
    ```

2.  **Create your environment file:**
    Create a `.env` file in the root directory and fill it with your credentials as described in the Environment Variables section.

3.  **Build and run the container:**
    This command will build the Docker image and start the service.
    ```sh
    docker-compose up --build
    ```

4.  **Access the application:**
    Open your web browser and navigate to `http://localhost:3000`.

### 2. Production Deployment (e.g., on Unraid)

This workflow is designed for a "set it and forget it" deployment on a home server like Unraid. It uses a pre-built, optimized image from Docker Hub, which is automatically updated every time you push changes to the `main` branch.

1.  **On your server**, create a directory for the application's configuration:
    ```sh
    mkdir -p /mnt/user/appdata/columbus-parking-pass
    cd /mnt/user/appdata/columbus-parking-pass
    ```

2.  **Create the environment file:**
    Inside that new directory, create a `.env` file containing your credentials.
    ```sh
    nano .env
    ```
    *(Paste your `SCRAPER_USERNAME` and `SCRAPER_PASSWORD` here and save the file.)*

3.  **Create the Docker Compose file:**
    Create a `docker-compose.yml` file in the same directory. Note that we use the contents of `docker-compose.prod.yml` from the repository for this.
    ```sh
    nano docker-compose.yml
    ```
    Paste the following content:
    ```yaml
    version: '3.8'

    services:
      app:
        image: alexberson/columbus-parking-pass:latest
        restart: unless-stopped
        env_file: .env
        ports:
          - "3000:3000" # Or change to "YOUR_DESIRED_PORT:3000"
    ```

4.  **Start the service:**
    ```sh
    docker-compose up -d
    ```

The application will now be running on your server. To update the application in the future, simply run `docker-compose pull` and `docker-compose up -d` in this directory to pull the latest image and restart the container.