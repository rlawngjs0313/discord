# Project Overview: Discord Bot with GCP CI/CD

This project is a simple Discord bot built with Node.js and discord.js. It features a fully automated CI/CD pipeline using GitHub Actions to deploy the bot as a containerized application to **Google Compute Engine (GCE)**.

## Technologies
- **Runtime:** Node.js (v20+)
- **Library:** discord.js (v14)
- **Containerization:** Docker
- **CI/CD:** GitHub Actions
- **Cloud Provider:** Google Cloud Platform (GCP)
- **Hosting:** Google Compute Engine (GCE)

## Git Branching Strategy
We follow a modified Git Flow strategy:
- **main:** Production-ready branch. Only merges from develop are allowed. Pushes to this branch trigger the **CD (Deploy)** pipeline.
- **develop:** Integration branch for features. Stability is verified here. PRs to this branch trigger the **CI (Test)** pipeline.
- **Feat/#{issue-number}:** Feature branches. Developers work here and merge into develop once complete.
- **Refactor/#{issue-number}:** Refactoring branches.

## CI/CD Workflow

### 1. CI Pipeline (Test)
- **Trigger:** Pull Request to develop.
- **Action:**
  - Installs dependencies.
  - Runs automated tests using jest.
- **Purpose:** Ensure new features don't break existing functionality and maintain code quality before integration.

### 2. CD Pipeline (Deploy)
- **Trigger:** Push to main.
- **Action:**
  - Authenticates with Google Cloud.
  - Builds a Docker image and pushes it to Artifact Registry.
  - Updates the GCE instance container with the new image.
- **Purpose:** Automated deployment of stable, tested code to the production environment.

---

## Building and Running

### Prerequisites
- Node.js installed locally.
- A Discord Bot Token (from the Discord Developer Portal).
- A GCP project with a GCE instance configured to run containers.

### Local Setup
1.  Install dependencies:
    \`\`\`bash
    npm install
    \`\`\`
2.  Create a .env file and add your configuration:
    \`\`\`env
    # Discord Bot Settings
    DISCORD_TOKEN=your_bot_token_here
    DISCORD_CLIENT_ID=your_client_id_here
    DISCORD_CLIENT_SECRET=your_client_secret_here
    DISCORD_REDIRECT_URI=http://localhost:8000/oauth/callback

    # Web Server Settings
    PORT=8000
    COOKIE_SECRET=your_random_secret_here (min 32 chars recommended)
    NODE_ENV=development

    # Scheduler Settings (Optional)
    DISCORD_CHANNEL_ID=your_target_channel_id
    SCHEDULER_CHANNEL_NAME=깡-통
    SCHEDULER_GIF_URL=https://giphy.com/...
    \`\`\`
3.  Start the bot locally:
    \`\`\`bash
    npm start
    \`\`\`

### Containerization
To build and run the Docker container locally:
\`\`\`bash
docker build -t discord-bot .
docker run --env-file .env discord-bot
\`\`\`

---

## Development Conventions

### Coding Style
- Use **CommonJS** modules (require/exports).
- Use **async/await** for asynchronous operations.
- Keep environment variables in .env and never commit them to the repository.

### CI/CD Requirements
For the GitHub Actions workflow to succeed, the following secrets must be configured in the GitHub repository:
- GCP_PROJECT_ID: Your Google Cloud Project ID.
- GCP_WIF_PROVIDER: The full identifier of the Workload Identity Pool provider.
- GCP_WIF_SERVICE_ACCOUNT: The email address of the GCP Service Account.
- DISCORD_TOKEN: The Discord bot token.
- DISCORD_CLIENT_ID: The Discord application Client ID.
- DISCORD_CLIENT_SECRET: The Discord application Client Secret.
- DISCORD_REDIRECT_URI: The OAuth2 redirect URI (e.g., http://GCE_IP/oauth/callback).
- COOKIE_SECRET: A secret string used to sign cookies for security (OAuth2 state validation).
- GCE_INSTANCE: The name of the target GCE instance.

### GCE Instance Setup Hint
The GCE instance should be created with the "Deploy a container image to this VM instance" option enabled.
\`\`\`bash
gcloud compute instances create-with-container INSTANCE_NAME \
    --container-image=gcr.io/google-containers/pause \
    --zone=us-central1-a \
    --scopes=https://www.googleapis.com/auth/cloud-platform
\`\`\`

---

## Gemini CLI Development Rules & Workflow

### 🚨 Critical Safety Rules
1. **Sensitive Info:** Always manage sensitive information (API keys, tokens) in .env. NEVER commit them.
2. **Autonomous Development:** Gemini CLI performs all development tasks. User intervention is not expected.
3. **Double-Check:** Rigorously verify all changes to prevent deployment issues.

### 📋 Commit Message Convention
|     Gitmoji     | Description |
|:---------------:| - |
|   ✨ feat:    | 새로운 기능 추가 |
|   🐛 fix:     | 버그 수정 |
|   📝 docs:    | 문서 추가, 수정, 삭제 |
|   ✅ test:    | 테스트 코드 추가, 수정, 삭제 |
|  💄 style:    | 코드 형식 변경 |
| ♻️ refactor:  | 코드 리팩토링 |
|   ⚡️ perf:    | 성능 개선 |
|    💚 ci:     | CI 관련 설정 수정 |
|  🚀 chore:    | 기타 변경사항 |
|  🔥 remove:️   | 코드 및 파일 제거 |

### 🛠 Development Workflow

#### Phase 1: Preparation (Setup)
0. **버전 체크:** 세션 시작 시 GitHub Repository의 히스토리(태그 및 커밋 메시지)를 분석하여 현재 가장 최신 배포 버전을 확인하고 기록합니다.
1. **이슈 생성:** 반드시 `gh issue create --template "파일명"`을 사용하여 성격에 맞는 템플릿으로 이슈를 생성합니다. (예: `gh issue create --template "✨--feat--기능-추가.md"`)
    - **주의:** 만약 CLI에서 템플릿 선택이 모호할 경우, `.github/ISSUE_TEMPLATE/` 내의 파일명을 정확히 지정합니다.
2. **이슈 번호 확인:** 생성된 이슈 번호 추출 및 기억.
3. **브랜치 생성:** develop 브랜치 베이스로 Feat/#번호 또는 Refactor/#번호 브랜치 생성.
4. **체크아웃:** 생성된 브랜치로 전환.
5. **개발 시작:** 해당 브랜치에서 기능 구현.

#### Phase 2: Finalization (Cleanup & Review)
1. **테스트 코드 작성:** 비즈니스 로직 및 예외 케이스 검증.
2. **작업 단위 커밋:** 상기 커밋 컨벤션을 준수하여 커밋.
3. **테스트 통과 확인:** `npm test`를 통한 모든 테스트 통과 확인.
4. **브랜치 확인 및 푸시:** 올바른 브랜치인지 확인 후 원격 저장소에 푸시.
5. **PR 생성:** 반드시 `gh pr create --template "pull_request_template.md"` (또는 해당 프로젝트의 PR 템플릿 경로)를 사용하여 `.github/pull_request_template.md`의 형식을 갖추어 develop 브랜치로 PR을 생성합니다.
    - **본문:** 반드시 `Closes #이슈번호` 키워드를 포함하여 머지 시 이슈가 자동으로 닫히도록 합니다.
    - **주의:** PR 생성 시 템플릿 내용이 자동으로 채워지지 않는다면, `cat .github/pull_request_template.md`로 내용을 읽어 `--body` 파라미터에 직접 포함시킵니다.
    - **자동 머지 금지:** PR 생성 후 자동으로 머지하지 않습니다. 생성된 PR 링크를 사용자에게 전달하고 대기합니다.
6. **PR 리뷰 대응:** PR 리뷰가 등록되면 다음 단계를 따릅니다.
    - **리뷰 분석:** 어떤 점이 문제점이고 이를 해결하기 위한 최선의 방법을 모색합니다.
    - **실제 적용 여부 판단:** 지적된 사항이 반드시 반영되어야 하는 로직/스타일 오류인지, 혹은 프로젝트 방향성에 따라 무시하거나 토론이 필요한 사항인지 판단합니다.
    - **적용 및 코멘트 작성:** 수정한 내용을 반영하여 푸시하고, 리뷰 코멘트에 대해 [문제점 나열, 판단 근거, 수정 내용]을 포함하여 답변을 작성합니다.
    - **작업 복원:** 리뷰 대응을 위해 임시로 체크아웃했거나 보류한 작업이 있다면 다시 복원합니다.

#### Phase 3: 배포 준비 (Develop to Main)
develop 브랜치의 작업이 완료되어 main으로 머지할 준비가 되면 다음 단계를 따릅니다.
1. **작업 보류 및 체크아웃:** 진행 중인 작업을 git stash로 보류하고 develop 브랜치로 체크아웃합니다.
2. **테스트 수행:** npm test를 실행하여 모든 기능이 정상인지 최종 확인합니다.
3. **빌드 및 구동 확인:** npm start 등을 통해 애플리케이션이 정상적으로 구동되는지 확인합니다.
4. **배포 PR 생성:** develop -> main 방향으로 PR을 생성합니다.
    - **타이틀:** ✅ [Deploy] v?.?.? 배포 패턴 (예: ✅ [Deploy] v1.0.0 배포)
    - **버전 규칙:** 
        - Major (1.0.0): 대규모 변경 사항
        - Minor (0.1.0): 새로운 기능 추가
        - Patch (0.0.1): 사소한 버그 수정

#### Phase 4: 배포 후 작업 (Post-Deployment)
main 브랜치 머지 및 배포가 완료된 후 다음 단계를 따릅니다.
1. **태그 생성:** 배포된 버전에 맞게 태그를 생성하고 푸시합니다.
    - **명령 예시:** git tag v1.5.0 && git push origin v1.5.0
2. **릴리즈 생성:** GitHub Release를 생성합니다.
    - **조건:** 반드시 generate release notes 기능을 사용합니다.
    - **명령 예시:** gh release create v1.5.0 --title "v1.5.0" --generate-notes

7. **PR 머지 (사용자 승인 후):** 사용자로부터 머지 지시가 있을 경우에만 다음 명령을 사용합니다.
    - **구조:** 타이틀에 상세 내용을 포함하는 문장을 넣고, 본문(detail)은 비워둡니다.
    - **명령 예시:** gh pr merge --merge --subject "✨ feat: 로깅 기능 강화 (#27)" --body ""
