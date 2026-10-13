<div align="center">

# Redis Iris Demos

**Redis Iris 기반의 재사용 가능한 데모 애플리케이션**

[Redis Iris](https://redis.io/iris/)는 AI 에이전트를 위한 Redis의 통합 컨텍스트 엔진입니다. 이 저장소는 여러 산업 분야의 AI 에이전트 데모를 제공합니다.

모든 도메인은 Context Retriever, Agent Memory, LangCache, Semantic Routing을 사용합니다.

[한국어](Readme-ko.md) · [English — origin GitHub의 영문 원본](https://github.com/nethippo/redis-iris-demos/blob/db7445eb35f0f4741fd4acc83016a0f090f2c95f/README.md)

</div>

---

## 데모에 사용되는 Iris 구성 요소

| 솔루션 | 역할 |
|--------|------|
| **Semantic Routing** | 주제에서 벗어난 질문이 LLM에 전달되기 전에 차단합니다. |
| **LangCache** | 의미가 유사한 질문에 캐시된 응답을 반환합니다. |
| **Agent Memory** | 단기 세션 컨텍스트와 장기 사용자 지식을 프롬프트에 반영합니다. |
| **Context Retriever** | 에이전트가 모든 비즈니스 데이터에 접근할 수 있도록 스키마 기반의 명확한 경로를 제공합니다. |

## 도메인

| 산업 분야 | 애플리케이션 | 스크린샷 |
|-----------|--------------|----------|
| 음식 배달 | Redis Eats | <img src="docs/screenshots/Demo_Redis_Eats.png" width="300" /> |
| 전자제품 유통 | ElectroHub | <img src="docs/screenshots/Demo_ElectroHub.png" width="300" /> |
| 금융 리서치 | ShiftIQ | <img src="docs/screenshots/Demo_ShiftIQ.png" width="300" /> |
| 헬스케어 | RedHealthConnect | <img src="docs/screenshots/Demo_RedHealthConnect.png" width="300" /> |
| 소매 금융 | Radish Bank | <img src="docs/screenshots/Demo_Radish_Bank.png" width="300" /> |
| 통신 | R-Mobile | <img src="docs/screenshots/Demo_R-Mobile.png" width="300" /> |
| 스포츠 베팅 | Sports Desk | <img src="docs/screenshots/Demo_Sports_Desk.png" width="300" /> |

## 이전 버전

`legacy/context-engine-demos/` 디렉터리는 원본 `redis/context-engine-demos` 저장소의 보관 사본을 담고 있습니다. 이 1세대 데모는 Context Retriever만 보여 주었습니다. 현재 저장소는 여기에 Semantic Routing, LangCache, Agent Memory와 도메인별 브랜딩을 추가한 후속 버전입니다.

## 시작하기

Sports Desk와 Radish Bank 컨테이너를 동시에 실행하는 방법과 실시간 3D Data Flow 화면은 [Docker 가이드](docker/README.ko.md)를 참고하세요.

한국 고객용 데모 개선 계획, 자동 메모리 연동의 미완성 부분, 제안된 30일 보존 요구사항은 [한국어 데모 로드맵](docs/korean-demo-roadmap.ko.md)을 참고하세요. 보존 정책은 아직 구현되지 않았습니다.

### 사전 준비

- Python 3.11 이상
- Node.js 18 이상
- [uv](https://docs.astral.sh/uv/) (Python 패키지 관리자)

### 필요한 Redis Cloud 서비스 및 API 정보

| 서비스 | 필요한 정보 |
|--------|-------------|
| Redis 데이터베이스 | 호스트, 포트, 비밀번호 |
| [Context Surfaces](https://redis.io/docs/latest/develop/ai/context-engine/context-retriever/) | 관리자 키 |
| [Agent Memory](https://redis.io/docs/latest/develop/ai/context-engine/agent-memory/) | 기본 URL, 스토어 ID, API 키 |
| [LangCache](https://redis.io/docs/latest/develop/ai/context-engine/langcache/) | 호스트, 캐시 ID, API 키 |
| OpenAI | [API 키](https://platform.openai.com/api-keys) |

### 처음 실행할 때

```bash
make install                      # Python 및 JS 의존성 설치
cp .env.example .env              # 복사한 .env에 인증 정보 입력
make setup                        # 데이터 생성, Redis 적재, 메모리 및 캐시 초기 데이터 등록
make dev                          # localhost:3040에서 시작
```

### 같은 도메인을 다시 실행할 때

```bash
make dev                          # Redis에 저장된 데이터 재사용
```

Redis 데이터가 삭제되었거나 인스턴스가 교체되어 에이전트에 도구가 없다면 데이터를 다시 적재하세요.

```bash
make reset                        # 데이터 재적재 및 초기 데이터 재등록
make dev
```

### 도메인 변경하기

```bash
# .env의 DEMO_DOMAIN 값을 변경
make setup
make dev
```

`radish-bank`로 변경할 때는 `MEMORY_SIMILARITY_THRESHOLD`를 설정하지 않거나 주석 처리하여 Radish Bank Agent Memory의 기본값인 `0.5`를 사용하세요. 이전 로컬 `.env` 파일에는 `MEMORY_SIMILARITY_THRESHOLD=0.7`이 남아 있을 수 있습니다. Radish의 기본 설정을 명시적으로 덮어쓰려는 경우에만 이 값을 유지하세요.

## `make setup`의 실행 단계

1. `.env`에 `DEMO_DOMAIN`을 설정합니다.
2. 도메인 스키마에서 Context Surface 모델을 생성합니다.
3. 합성 데이터(JSONL 파일)를 생성합니다.
4. Redis 데이터베이스의 데이터를 모두 삭제합니다.
5. 새 Context Surface를 생성하고 `.env`에 `CTX_SURFACE_ID`와 `MCP_AGENT_KEY`를 기록합니다.
6. Redis에 데이터를 적재하고 검색 인덱스를 생성합니다.
7. Agent Memory의 기존 메모리를 지우고 도메인별 장기 메모리 2개를 등록합니다.
8. LangCache를 비우고 도메인별 캐시 응답 1개를 등록합니다.
9. 서버가 시작되면 Semantic Routing이 자동으로 초기화됩니다.

`make reset`은 4~9단계만 실행합니다. 기존 모델과 데이터 파일을 재사용하므로 더 빠릅니다.

## 새 도메인 만들기

통신, 여행, 보험 등 새로운 산업 분야를 추가할 수 있습니다. 모든 도메인은 같은 구조를 따르므로 동일한 절차를 반복할 수 있습니다.

### 만들어야 할 파일

| 파일 | 내용 |
|------|------|
| `domains/<id>/schema.py` | 고객, 주문, 제품 등 Redis 데이터 엔터티 |
| `domains/<id>/domain.py` | 브랜딩, 테마, 가드레일 라우트, 초기 메모리 및 캐시를 정의하는 매니페스트 |
| `domains/<id>/prompt.py` | 도구 사용 안내와 워크플로를 포함한 에이전트 시스템 프롬프트 |
| `domains/<id>/data_generator.py` | 현실적인 이름, 금액, 시나리오를 포함한 합성 데모 데이터 |
| `domains/<id>/assets/logo.svg` | 도메인 로고 (상단 바에서 28×28 크기로 표시) |
| `domains/<id>/docs/demo_paths.md` | 미리 작성한 데모 대화 시나리오 2~4개 |
| `frontend/public/backgrounds/<id>/left.svg` | 시작 화면의 왼쪽 일러스트 (약 590×817, 35KB 미만) |
| `frontend/public/backgrounds/<id>/right.svg` | 시작 화면의 오른쪽 일러스트 (약 632×817, 35KB 미만) |

각 도메인은 `backend/app/core/domain_contract.py`에 정의된 `DomainPack` 프로토콜을 구현합니다.

### AI로 도메인 만들기

새로운 산업 분야의 데모는 AI 코딩 어시스턴트로 빠르게 만들 수 있습니다. 두 도구 모두 상세한 작성 스킬을 제공합니다.

- **Claude Code**: `.claude/skills/domain-pack-authoring.md`
- **Codex**: `.codex/skills/domain-pack-authoring/SKILL.md`

*“[원하는 산업 분야]의 새 도메인을 만들어 줘”*라고 요청하세요. 스킬은 엔터티 설계, 브랜딩, 현실적인 가드레일 라우트, 초기 데이터, 프롬프트, 데모 시나리오까지 전체 과정을 안내합니다.

## 프로젝트 구조

```text
backend/
  app/
    main.py                  # FastAPI 앱, SSE 스트리밍, 7단계 파이프라인
    langgraph_agent.py       # LangGraph ReAct 에이전트
    memory_service.py        # Redis Agent Memory 클라이언트
    context_surface_service.py  # MCP 도구 래퍼
    guardrail_service.py     # Semantic Routing 가드레일
    langcache_service.py     # 시맨틱 캐시 클라이언트
    settings.py              # Pydantic BaseSettings
    core/
      domain_contract.py     # DomainPack 프로토콜 및 설정
      domain_schema.py       # EntitySpec 정의

domains/
  reddash/                   # 음식 배달
  electrohub/                # 전자제품 유통
  finance-researcher/        # 금융 리서치
  healthcare/                # 환자 포털
  radish-bank/               # 소매 금융
  rmobile/                   # 이동통신
  sports-betting/            # 스포츠 베팅

frontend/
  src/
    App.tsx                  # React 채팅 UI, SSE 처리기
    components/              # ConversationView, ActivityPanel, EmptyState

scripts/                     # 설정, 데이터 적재, 초기 데이터 등록, 검증

.codex/skills/
  domain-pack-authoring/     # 새 도메인을 만드는 AI 스킬
```

## Make 명령어

| 명령어 | 역할 |
|--------|------|
| `make domains` | 사용 가능한 도메인 목록 표시 |
| `make setup [DOMAIN=X]` | 모델, 데이터, Redis 적재, 초기 데이터 등록을 포함한 전체 설정 |
| `make reset` | 현재 도메인의 데이터를 Redis에 재적재하고 초기 데이터 재등록 |
| `make dev` | 백엔드(:8040)와 프런트엔드(:3040) 시작 |
| `make install` | Python 및 JS 의존성 설치 |
| `make create-domain DOMAIN=X` | 새 도메인의 기본 구조 생성 |
| `make seed-memories` | 현재 도메인의 장기 메모리 재등록 |
| `make seed-langcache` | 현재 도메인의 LangCache 항목 재등록 |
| `make flush-redis` | Redis 데이터베이스의 데이터 모두 삭제 |

모든 명령어는 `.env`에서 `DEMO_DOMAIN`을 읽습니다. 도메인을 바꾸는 경우가 아니라면 `DOMAIN=`을 전달할 필요가 없습니다.

---

## 라이선스

MIT
