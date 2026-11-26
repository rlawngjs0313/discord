# Discord 포럼 정산 봇

사용자가 만든 포럼 포스트에서 여러 사람이 결제한 비용을 기록하고, 각자의 송금액을 비공개로 확인한다.

| 명령 | 동작 |
| --- | --- |
| `/정산` | 참여자와 총액을 입력한다. 결제자 본인 몫까지 포함해 나누고, 총액과 참여자별 송금액을 현재 포스트에 공개 답장으로 표시한다. |
| `/정산확인` | 현재 포스트에서 상대별로 보낼 금액과 등록된 계좌를 확인한다. |
| `/정산세부` | 본인과 관련된 기록을 같은 비공개 답장에서 한 건씩 보며, 자신의 기록은 수정하거나 취소할 수 있다. |
| `/계좌등록` | 폼에서 국내 은행 하나를 고르고, 계좌번호와 예금주명을 입력한다. 주요 은행이 목록 상단에 표시된다. |
| `/계좌삭제` | 본인 계좌를 삭제한다. |

정산 등록 공개 답장은 포스트에 남는다. 비공개 답장은 생성 1분 뒤 삭제된다. 정산이나 계좌가 바뀌면 이전 정보를 담은 비공개 답장을 즉시 삭제하도록 예약한다. 실제 송금 여부는 추적하지 않는다.

## 실행

Node.js 22.18 이상과 전용 PostgreSQL 데이터베이스가 필요하다. `.env.example`을 참고해 로컬 `.env`에 값을 설정한다. `DISCORD_RESPONSE_KEY`는 `openssl rand -base64 32`로 만들고 재시작 시에도 같은 값을 사용한다.

Discord Developer Portal에서 앱을 서버에 설치할 때 `bot`, `applications.commands` 범위를 허용한다. 포럼 포스트를 볼 수 있는 권한이 필요하다. `DISCORD_GUILD_ID`를 지정하면 테스트 서버에만 명령을 등록한다. 앱 설치 후 사용자가 포럼에 직접 포스트를 만들고 그 안에서 명령을 사용한다.

```sh
npm ci
npm run db:deploy
npm run build
npm start
```

`db:deploy`는 Graphile Worker 스키마를 준비한 뒤 Prisma 마이그레이션을 적용한다. Docker 이미지도 시작할 때 같은 순서로 검사한다.

## 오늘의 토막상식

로컬 `.env` 또는 운영 `bot.env`에 `GEMINI_API_KEY`를 설정하면 봇 프로필의 **플레이 중**에 한국어 토막상식 한 문장을 표시한다. 봇이 시작되면 한국 시간 기준 오늘의 상식을 불러오고, 매일 자정에 새 날짜의 상식으로 바꾼다. 기본 모델은 `gemini-3.5-flash-lite`이며 `GEMINI_MODEL`로 바꿀 수 있다.

기존 로컬 DB에 처음 기능을 추가할 때 `npm run db:deploy`를 실행해 토막상식 테이블을 만든다. 테이블이 없으면 봇 로그에 필요한 명령을 표시한다.

당일 생성에 성공하면 PostgreSQL에 저장한다. 같은 데이터베이스를 쓰는 봇은 재시작해도 해당 날짜의 결과를 재사용한다. Gemini에는 날짜와 최근 생성한 문장 최대 7개만 전송한다. 생성에 실패하면 마지막으로 표시한 내용을 유지하고 최대 한 시간 뒤에 다시 시도한다. [Gemini API 문서](https://ai.google.dev/api/generate-content)

## 대화 기반 밈 전송

`/밈`은 현재 채널이나 포럼 포스트에서 명령 전 기록을 거슬러 올라가 사람 메시지 최대 10개를 모은다. 봇과 웹훅 메시지를 건너뛰고, 대화 끝에 이어진 링크만 있는 메시지도 건너뛴다. 사람 메시지에 붙은 사진과 본문에 넣은 서버 이모티콘은 `<사진1>`, `<이모티콘1>`처럼 표시한다. 사진만 있는 메시지도 분석에 포함한다.

Gemini가 마지막 발언과 이어지는 흐름을 고르고, 그 흐름의 중심 사건이나 소재에 맞는 짤·사진·게임 장면을 찾는다. 봇은 Brave에서 이미지 후보를 최대 5개 가져온다. Gemini는 같은 흐름의 발언과 연결된 이미지, 후보 제목과 썸네일을 보고 주제와 이어지는 장면을 고른다. 어울리는 후보를 고르지 못하거나 원본을 가져올 수 없으면 같은 주제의 국내 커뮤니티식 짤을 한 번 더 검색한다. 보통 Gemini 호출 두 번과 Brave 검색 한 번을 사용하며, 두 번째 검색을 하면 각각 최대 한 번씩 늘어난다. 봇은 선택된 원본 JPEG·PNG·WebP·GIF를 최대 8 MiB까지 받아 현재 채널이나 스레드의 일반 메시지로 첨부한다. [Brave 이미지 검색 문서](https://api-dashboard.search.brave.com/api-reference/images/image_search)

농담이나 거친 말투가 섞인 대화는 상황에서 웃긴 부분을 과장해 검색한다. 주제와 연결되는 사물이나 행동을 검색어에 함께 넣는다.

`Discord meme history` 로그에는 조회한 메시지 ID, 발언 번호가 붙은 대화 본문과 이미지 참조, 읽지 못한 이미지 참조가 남는다. `Discord meme search`에는 같은 요청의 검색어, 검색에 사용한 발언 번호, 선택한 결과 번호, 원본 다운로드 여부가 남는다. 입력 사진은 JPEG, PNG, WebP, HEIC, HEIF를 지원한다. 대화 이미지는 최대 8초 동안 총 13 MiB까지 가져온다.

`Discord meme selection failed.` 로그에는 요청 ID와 모드, 실패 단계, 해당 단계의 소요 시간과 오류 분류가 남는다. 해당하는 경우 HTTP 상태, Gemini 응답 종료 사유 또는 네트워크 오류 코드도 확인할 수 있다.

개발용 `.env`에 `MEME_DISCORD_SEARCH_PREVIEW=true`를 설정하고 봇을 다시 실행하면, `/밈`은 후보 선택 후 검색어, 후보 최대 5개의 제목과 썸네일, 선택 번호를 실행자에게만 보여준다. 국내 커뮤니티식 짤로 다시 검색했으면 두 번째 검색의 후보를 보여준다. 채널 게시는 `MEME_DISCORD_SEARCH_PREVIEW=false`일 때만 수행한다.

프롬프트를 다듬을 때는 빌드 후 `npm run meme:search -- "$query"`로 검색어의 Brave 후보를 브라우저에서 확인할 수 있다. `query`에는 AI Studio가 반환한 검색어를 넣는다. macOS에서는 미리보기를 자동으로 열고, 이미지를 클릭하면 원본으로 이동한다.

테스트용 대화는 `닉네임 — 어제 17:11`처럼 이름과 시간이 들어간 줄 바로 아래에 본문이 이어지는 형식으로 한 메시지에 붙여넣을 수 있다. 그 메시지가 최신이면 붙여넣은 대화의 마지막 10개 발언을 화자별로 읽는다. `:이모티콘이름:`은 현재 서버에서 이름이 정확히 일치하는 이모티콘이 하나 있을 때 이미지로 바꾼다. 로그의 `pastedMessageCount`로 분석한 발언 수를 확인할 수 있다.

Gemini 모델의 후보 선택은 예시 한국어 대화와 테스트 후보로 확인할 수 있다. `.env`에 `GEMINI_API_KEY`를 설정한 뒤 실행한다. 기본 모델은 `gemini-3.5-flash-lite`이며 `GEMINI_MODEL`로 바꿀 수 있다.

```sh
npm run test:meme:quality
```

실제 채팅을 연결할 때는 사용하는 Gemini 플랜의 데이터 처리 조건과 [Discord 개발자 약관](https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service)을 확인한다. Gemini 무료 약관에서는 입력과 응답을 제품 개선에 사용할 수 있다. [Gemini 데이터 사용 약관](https://aistudio.google.com/docs/terms#data-use-unpaid)

Brave 대시보드에서 **Search** 플랜을 활성화한다. 무료 크레딧으로 테스트하려면 카드 등록 후 선불액을 `$0`으로 설정하고 자동 충전을 끈다. **API Keys → Add API Key**에서 키를 발급해 `.env`에 넣는다. [Brave 무료 크레딧 안내](https://api-dashboard.search.brave.com/documentation/resources/help-feedback) · [API 키 발급 안내](https://api-dashboard.search.brave.com/documentation/guides/authentication)

```dotenv
BRAVE_SEARCH_API_KEY=발급받은_키
MEME_DISCORD_ENABLED=true
```

`GEMINI_API_KEY`와 `BRAVE_SEARCH_API_KEY`를 설정한 뒤 `npm run dev`를 다시 실행한다. Discord Developer Portal에서 **Message Content Intent**를 활성화하고, 봇에 채널 보기, 메시지 기록 보기, 메시지 보내기, 파일 첨부 권한을 부여한다. 스레드와 포럼 포스트에서는 스레드에 메시지 보내기 권한이 필요하다. [밈 기능 intent](intent/밈답장-intent.md)

## 배포

GitHub Actions는 `main`에 변경이 들어오면 GHCR에 이미지를 게시하고, VM B에 직접 SSH로 접속해 그 이미지의 다이제스트로 [Compose 프로젝트](compose.production.yaml)를 갱신한다. 봇은 VM B에서 Discord Gateway에 직접 연결한다.

### VM B

1. Docker Engine과 Compose 플러그인을 설치한다. GitHub Actions가 접속할 배포 계정에서 `docker info`와 `docker compose version`을 실행해 권한과 설치 상태를 확인한다. VM B에서 DNS와 Docker Hub, GHCR, Discord로 나가는 HTTPS 연결을 허용한다.
2. `discord` 배포 계정의 `~/discord`에 `postgres.env`와 `bot.env`를 만든다. 아래 초기화는 **새 디렉터리에 한 번** 실행한다. 생성 후 `bot.env`에 실제 Discord 토큰과 앱 ID를 채운다. 운영 환경에 기존 정산 DB나 응답 암호화 키가 있다면 배포 전 그 데이터를 보존하고 키를 이어서 사용한다.

   ```sh
   install -d -m 700 "$HOME/discord"
   cd "$HOME/discord"
   (
     set -euC
     umask 077
     test ! -e postgres.env && test ! -e bot.env
     db_password=$(openssl rand -hex 32)
     response_key=$(openssl rand -base64 32)
     printf 'POSTGRES_DB=discord\nPOSTGRES_USER=discord\nPOSTGRES_PASSWORD=%s\n' "$db_password" > postgres.env
     printf 'DISCORD_TOKEN=\nDISCORD_CLIENT_ID=\nDISCORD_RESPONSE_KEY=%s\nDATABASE_URL=postgresql://discord:%s@postgres:5432/discord\n' \
       "$response_key" "$db_password" > bot.env
   )
   ```

   PostgreSQL 데이터는 `discord-settlement_postgres-data` 볼륨에 저장된다. 한 서버에만 명령을 등록하려면 `bot.env`에 `DISCORD_GUILD_ID`를 추가한다. 배포 설정과 DB 백업은 함께 관리한다.
3. 첫 배포 전 기존 `docker run`으로 만든 `discord-bot`이 실행 중이라면 `docker stop discord-bot`으로 멈춘다. 기존 컨테이너는 첫 배포를 확인할 때까지 보관할 수 있다.

### GitHub Actions

| GitHub Actions 시크릿 | 값 |
| --- | --- |
| `GCE_IP`, `GCE_USERNAME` | GitHub Actions에서 접속할 수 있는 VM B의 SSH 주소와 배포 계정 `discord`. |
| `GCE_SSH_SECRET_KEY`, `GCE_SSH_FINGERPRINT` | VM B 계정에 등록한 배포용 키의 개인 키와 VM B SSH 서버 호스트 키 지문. |

배포 키의 공개 키는 `discord` 계정의 `~/.ssh/authorized_keys`에 등록한다. VM B에서 SSH Action이 협상하는 호스트 키의 `SHA256:…` 지문을 확인한다. 기본 Ubuntu 구성에서 ECDSA 호스트 키를 제공하면 `sudo ssh-keygen -E sha256 -lf /etc/ssh/ssh_host_ecdsa_key.pub`를 사용한다. VM B는 GitHub Actions에서 SSH 포트 22로 접속할 수 있어야 한다.

VM 준비를 마친 뒤 릴리스 PR을 `main`에 머지한다. CD는 PostgreSQL과 Discord Gateway 준비 상태를 확인한다. 이후 VM B에서 아래 명령으로 컨테이너 상태와 기동 로그를 볼 수 있다.

```sh
cd "$HOME/discord"
docker compose --env-file image.env ps
docker compose --env-file image.env logs --tail 100 bot
```

이미 한 번 성공한 Compose 배포가 있으면 다음 시작 검증 실패 시 이전 이미지로 복구를 시도한다. 적용된 DB 마이그레이션은 그대로 유지된다.

## 검증

`npm test`는 빌드와 로컬 테스트를 실행한다. 통합 테스트에는 별도의 로컬 테스트 DB가 필요하다. 테스트 DB 이름은 `_test`로 끝나야 한다.

```sh
export TEST_DATABASE_URL='postgresql://discord_test:discord_test@127.0.0.1:5432/discord_test'
DATABASE_URL="$TEST_DATABASE_URL" npm run db:deploy
npm test
```

실제 Discord에서는 테스트 서버 포럼에 글을 하나 만든 뒤 두 계정으로 확인한다. 결제자가 `/정산`을 등록하고, 상대가 `/정산확인`을 실행해 자기 송금액만 보이는지 확인한다. 결제자가 계좌나 기록을 바꾼 뒤 상대의 이전 답장이 사라지고 최신 확인에 변경값이 나오는지 확인한다. 1분 뒤 공개 등록 답장이 포스트에 남고 비공개 답장은 삭제되는지 확인한다.

[기능 의도](intent/정산기능-intent.md) · [구현 명세와 ERD](spec/정산기능-spec.md) · [ORM과 SQL 실행 방식](spec/정산기능-sql.md)
