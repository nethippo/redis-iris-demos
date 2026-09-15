# Sports Desk / Radish Bank Docker 실행

프로젝트 루트에서 실행합니다. Docker Compose, OpenAI 키, Redis Database,
Context Retriever 관리자 키, Agent Memory 및 LangCache 설정이 필요합니다.

| 데모 | Compose | 환경 파일 | 웹 | API |
|---|---|---|---|---|
| Sports Desk | `compose.yaml` | `.env` | http://localhost:3040 | http://localhost:8040 |
| Radish Bank | `compose.radish.yaml` | `.env.radish` | http://localhost:3041 | http://localhost:8041 |

포트는 `127.0.0.1`에 바인딩됩니다. Nginx가 `/api`를 각 백엔드의 내부 8040 포트로 전달합니다.

## 환경 설정 및 첫 실행

`.env.example`을 `.env`로 복사하고 키와 서비스 연결 정보를 입력합니다.
Sports Desk는 `DEMO_DOMAIN=sports-betting`으로 설정합니다.

```bash
cp .env.example .env
chmod 600 .env
# .env 편집 후:
docker compose build
docker compose --profile setup run --rm setup
docker compose up -d --wait --wait-timeout 180
```

Radish Bank는 `.env`를 `.env.radish`로 복사하여 공유 Redis Database,
OpenAI, Context Retriever 관리자 키, Agent Memory store 및 LangCache cache 설정을 재사용할 수 있습니다.
복사 후 다음 항목을 변경합니다. `CTX_SURFACE_ID`와 `MCP_AGENT_KEY`는 비워서 은행 스키마용 Surface를 생성합니다.
`DEMO_USER_ID`, `DEMO_USER_NAME`, `DEMO_USER_EMAIL`도 비워서 은행 샘플 고객을 선택합니다.

```dotenv
DEMO_DOMAIN=radish-bank
CTX_SURFACE_ID=
MCP_AGENT_KEY=
DEMO_USER_ID=
DEMO_USER_NAME=
DEMO_USER_EMAIL=
MEMORY_NAMESPACE=radish-bank-demo
MEMORY_OWNER_ID=CUST001
LANGCACHE_NAMESPACE=radish-bank
LANGCACHE_THRESHOLD=0.95
CORS_ORIGIN=http://localhost:3041
```

```bash
chmod 600 .env.radish
docker compose -f compose.radish.yaml build
docker compose -f compose.radish.yaml --profile setup run --rm setup
docker compose -f compose.radish.yaml up -d --wait --wait-timeout 180
```

Setup은 실제 정책 임베딩을 생성하고 샘플·메모리·FAQ를 적재합니다.
기존 Surface 설정은 재사용하며 Redis, Agent Memory, LangCache를 전체 삭제하지 않습니다.
같은 샘플 ID는 덮어쓰므로 샘플 재적재가 필요할 때만 실행합니다.
도메인별 데이터·체크포인트·라우팅 인덱스와 메모리 namespace를 사용합니다.
Radish Bank의 데모 작업 상태는 `output/radish-bank`에 보존됩니다.
은행 캐시는 공개 정기예금 금리 FAQ만 대상으로 하며 개인 계좌·잔액 질문은 도구로 조회합니다.
LangCache 접두사 필터는 응답 혼동을 줄이기 위한 데모 처리이며 접근 권한 경계가 아닙니다.

## Data Flow

`Real-time Context` 모드에서 `Redis Iris → Data Flow`를 엽니다.

- **Agent 큐브:** LangGraph와 Semantic Router. 두 컴포넌트는 FastAPI와 같은 Python 프로세스에서 실행됩니다.
- **Redis Cloud 큐브:** LangCache, Agent Memory, Context Retriever, Redis Database, RDI.
- **외부 노드:** OpenAI, Source DB, 브라우저, Nginx, FastAPI.
- 녹색 Redis 경로는 SDK 호출, 보라색 경로는 MCP 활동과 연계한 표시입니다.
- 황색 `Source DB → RDI → Redis Database`는 가정한 수집 구조이며 실제 RDI를 구축하거나 계측하지 않습니다.
- 관리형 서비스 그룹은 해당 서비스들이 동일한 Redis Database를 저장소로 사용한다는 의미가 아닙니다.

드래그·방향키로 회전하고 휠·`+`/`-`로 확대합니다. `Reset view`로 시점을 복원합니다.
완료된 요청은 `Replay trace`로 재생할 수 있습니다. 요청 기록은 현재 브라우저 대화 범위입니다.

## 변경 반영 및 확인

```bash
docker compose build
docker compose up -d --wait --wait-timeout 180
docker compose ps
# Radish Bank는 각 명령에 -f compose.radish.yaml 추가
```

`/api/health`는 앱 상태와 설정 여부를 표시합니다. 외부 서비스의 실제 동작은 채팅으로 확인합니다.
Sports Desk: `Why has my football bet not settled yet?`
Radish Bank: `What are my account balances and product holdings?`
은행 거래와 스포츠 베팅 데이터는 합성 데모입니다.

환경 파일, 키, 생성 데이터와 로컬 검증 기록은 Git 및 Docker 빌드 컨텍스트에서 제외됩니다.
