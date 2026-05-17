# Project Overview: Discord Bot with GCP CI/CD

This project is a simple Discord bot built with Node.js and `discord.js`. It features a fully automated CI/CD pipeline using GitHub Actions to deploy the bot as a containerized application to Google Cloud Run.

## Technologies
- **Runtime:** Node.js (v20+)
- **Library:** discord.js (v14)
- **Containerization:** Docker
- **CI/CD:** GitHub Actions
- **Cloud Provider:** Google Cloud Platform (GCP)
- **Hosting:** Google Cloud Run

## Architecture
1.  **Discord Bot (`index.js`):** A basic bot that listens for "핑" (Ping) and replies with "퐁!" (Pong!). It uses `dotenv` for local environment variable management.
2.  **Containerization (`Dockerfile`):** A multi-stage Docker build that optimizes the production image by separating the build phase from the runtime phase.
3.  **CI/CD Workflow (`.github/workflows/ci-cd.yml`):**
    - Triggers on pushes to `main` or `master`.
    - Authenticates with GCP using Workload Identity Federation (WIF).
    - Builds and pushes the Docker image to Artifact Registry.
    - Deploys the image to Google Cloud Run, injecting the `DISCORD_TOKEN` from GitHub Secrets.

---

## Building and Running

### Prerequisites
- Node.js installed locally.
- A Discord Bot Token (from the Discord Developer Portal).
- A `.env` file in the root directory (see [Local Setup](#local-setup)).

### Local Setup
1.  Install dependencies:
    ```bash
    npm install
    ```
2.  Create a `.env` file and add your Discord token:
    ```env
    DISCORD_TOKEN=your_token_here
    ```
3.  Start the bot locally:
    ```bash
    npm start
    ```

### Containerization
To build and run the Docker container locally:
```bash
docker build -t discord-bot .
docker run --env-file .env discord-bot
```

---

## Development Conventions

### Coding Style
- Use **CommonJS** modules (`require`/`exports`).
- Use **async/await** for asynchronous operations (as per `discord.js` best practices).
- Keep environment variables in `.env` and never commit them to the repository.

### CI/CD Requirements
For the GitHub Actions workflow to succeed, the following secrets must be configured in the GitHub repository:
- `GCP_PROJECT_ID`: Your Google Cloud Project ID.
- `GCP_WIF_PROVIDER`: The full identifier of the Workload Identity Pool provider.
- `GCP_WIF_SERVICE_ACCOUNT`: The email address of the GCP Service Account.
- `DISCORD_TOKEN`: The Discord bot token.

### Testing
- Currently, no tests are specified. To add tests, update the `test` script in `package.json` and add your test files.
