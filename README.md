# Discord 포럼 정산 봇

사용자가 만든 포럼 포스트에서 여러 사람이 결제한 비용을 기록하고, 각자의 송금액을 비공개로 확인한다.

| 명령 | 동작 |
| --- | --- |
| `/정산` | 참여자와 총액을 입력한다. 결제자 본인 몫까지 포함해 나누고, 받을 금액만 답장한다. |
| `/정산확인` | 현재 포스트에서 상대별로 보낼 금액과 등록된 계좌를 확인한다. |
| `/정산세부` | 본인과 관련된 기록을 같은 비공개 답장에서 한 건씩 보며, 자신의 기록은 수정하거나 취소할 수 있다. |
| `/계좌등록` | 폼에서 국내 은행 하나를 고르고, 계좌번호와 예금주명을 입력한다. 주요 은행이 목록 상단에 표시된다. |
| `/계좌삭제` | 본인 계좌를 삭제한다. |

정산 답장은 14분 뒤 삭제된다. 정산이나 계좌가 바뀌면 이전 정보를 담은 답장은 즉시 삭제를 예약한다. 실제 송금 여부는 추적하지 않는다.

## 실행

Node.js 22.18 이상과 전용 PostgreSQL 데이터베이스가 필요하다. `.env.example`을 참고해 로컬 `.env`에 값을 설정한다. `DISCORD_RESPONSE_KEY`는 `openssl rand -base64 32`로 만들고 재시작 시에도 같은 값을 사용한다.

Discord Developer Portal에서 앱을 서버에 설치할 때 `bot`, `applications.commands` 범위를 허용한다. 포럼 포스트를 볼 수 있는 권한이 필요하다. `DISCORD_GUILD_ID`를 지정하면 테스트 서버에만 명령을 등록한다. 앱 설치 후 사용자가 포럼에 직접 포스트를 만들고 그 안에서 명령을 사용한다.

```sh
npm ci
npm run db:deploy
npm run build
npm start
```

`db:deploy`는 Graphile Worker 스키마를 준비한 뒤 Prisma 마이그레이션을 적용한다. Docker 이미지도 시작할 때 같은 순서로 검사한다. 배포 워크플로에는 전용 DB 접속 주소를 `DISCORD_DATABASE_URL`, 암호화 키를 `DISCORD_RESPONSE_KEY`로 등록한다.

## 검증

`npm test`는 빌드와 로컬 테스트를 실행한다. 통합 테스트에는 별도의 로컬 테스트 DB가 필요하다. 테스트 DB 이름은 `_test`로 끝나야 한다.

```sh
export TEST_DATABASE_URL='postgresql://discord_test:discord_test@127.0.0.1:5432/discord_test'
DATABASE_URL="$TEST_DATABASE_URL" npm run db:deploy
npm test
```

실제 Discord에서는 테스트 서버 포럼에 글을 하나 만든 뒤 두 계정으로 확인한다. 결제자가 `/정산`을 등록하고, 상대가 `/정산확인`을 실행해 자기 송금액만 보이는지 확인한다. 결제자가 계좌나 기록을 바꾼 뒤 상대의 이전 답장이 사라지고 최신 확인에 변경값이 나오는지 확인한다. 별도의 답장은 변경 없이 14분이 지난 뒤 삭제되는지 확인한다.

[기능 의도](intent/정산기능-intent.md) · [구현 명세와 ERD](spec/정산기능-spec.md) · [ORM과 SQL 실행 방식](spec/정산기능-sql.md)
