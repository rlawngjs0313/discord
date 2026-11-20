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

## 배포

GitHub Actions는 `main`에 변경이 들어오면 GHCR에 이미지를 게시하고, VM B에서 그 이미지의 다이제스트로 [Compose 프로젝트](compose.production.yaml)를 갱신한다. VM B가 사설망에 있으면 VM A를 SSH 점프 호스트로 사용할 수 있다. 봇이 VM B에서 Discord Gateway에 직접 연결하므로 Nginx에 봇용 HTTP 경로를 추가할 필요가 없다.

### VM B

1. Docker Engine과 Compose 플러그인을 설치한다. GitHub Actions가 접속할 배포 계정에서 `docker info`와 `docker compose version`을 실행해 권한과 설치 상태를 확인한다. VM B에서 DNS와 Docker Hub, GHCR, Discord로 나가는 HTTPS 연결을 허용한다.
2. 배포 계정으로 `~/discord-deploy`에 `postgres.env`와 `bot.env`를 만든다. 아래 초기화는 **새 디렉터리에 한 번** 실행한다. 생성 후 `bot.env`에 실제 Discord 토큰과 앱 ID를 채운다. 운영 환경에 기존 정산 DB나 응답 암호화 키가 있다면 배포 전 그 데이터를 보존하고 키를 이어서 사용한다.

   ```sh
   install -d -m 700 "$HOME/discord-deploy"
   cd "$HOME/discord-deploy"
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

### VM A 및 GitHub Actions

| GitHub Actions 시크릿 | 값 |
| --- | --- |
| `GCE_IP`, `GCE_USERNAME` | VM B의 SSH 주소와 배포 계정. 점프 호스트를 쓰면 VM A에서 닿는 VM B 사설 IP를 입력한다. |
| `GCE_SSH_SECRET_KEY`, `GCE_SSH_FINGERPRINT` | VM B 계정에 등록한 배포용 키의 개인 키와 VM B SSH 서버 호스트 키 지문. |
| `GCE_PROXY_HOST`, `GCE_PROXY_USERNAME` | VM B로 직접 SSH 접속할 수 없을 때 사용하는 VM A의 SSH 주소와 계정. |
| `GCE_PROXY_SSH_KEY`, `GCE_PROXY_FINGERPRINT` | VM A 계정에 등록한 점프 호스트용 키의 개인 키와 VM A SSH 서버 호스트 키 지문. |

배포 키의 공개 키는 해당 계정의 `~/.ssh/authorized_keys`에 등록한다. 각 VM에서 `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`로 호스트 키의 `SHA256:…` 지문을 확인한다. 점프 호스트를 쓰는 경우 VM A에서 VM B의 SSH 포트로 전달을 허용하고 VM B의 SSH 인바운드를 VM A 사설 IP로 제한한다. 워크플로는 SSH 포트 22를 사용한다. PostgreSQL과 봇 포트는 호스트에 공개하지 않는다.

VM 준비를 마친 뒤 릴리스 PR을 `main`에 머지한다. CD는 PostgreSQL과 Discord Gateway 준비 상태를 확인한다. 이후 VM B에서 아래 명령으로 컨테이너 상태와 기동 로그를 볼 수 있다.

```sh
cd "$HOME/discord-deploy"
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
