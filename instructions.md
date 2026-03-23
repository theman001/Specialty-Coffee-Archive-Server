# ☕ Project Mission: Docker-based Coffee Archive Server (Monolithic)

**목표**: Docker 컨테이너 기반으로 Leaflet 지도, 네이버 API, 정형화된 테이스팅 노트를 관리하는 감성적인 커피 기록 서버 구축.

---

## 🛠 [Phase 0] 에이전트 기본 작동 원칙
- **컨테이너화**: 모든 실행 환경은 Docker를 기준으로 한다. (`Dockerfile`, `docker-compose.yml` 필수)
- **의존성 관리**: 새로운 라이브러리 설치 시 즉시 `requirements.txt`를 업데이트할 것.
- **형상 관리**: 각 Phase 완료 시 의미 있는 메시지와 함께 `git commit `을 수행할 것.
- **데이터 보존**: SQLite DB와 업로드 이미지는 Docker 볼륨(Volume)을 통해 호스트에 보존되도록 설정할 것.

---

## 📂 [Phase 1] 프로젝트 스캐폴딩 (Docker 포함)
1.  **폴더 구조 생성**: 
    - `app/ `: FastAPI 소스 코드
    - `static/uploads/bean_cards/ `: 원두 카드 이미지 저장소
    - `templates/ `: HTML 템플릿 파일
2.  **환경 설정 파일 생성**: 
    - `Dockerfile `: Python 3.11-slim 기반 이미지 빌드 설정
    - `docker-compose.yml `: 앱 서비스 및 볼륨 마운팅 설정
    - `requirements.txt `, `.gitignore `, `main.py ` 등 기본 파일 생성.
3.  **.env 템플릿 작성**:
    ```env
    NAVER_CLIENT_ID=
    NAVER_CLIENT_SECRET=
    DATABASE_URL=sqlite:///./data/coffee_archive.db
    ```

---

## 🔑 [Phase 2] 사용자 환경 설정 및 컨테이너 가동
1. **사용자 대기**: 에이전트는 아래 메시지를 출력하고 사용자 응답을 대기한다.
   > **[환경 설정 안내]** > 프로젝트 구조와 Docker 설정이 완료되었습니다. 루트의 **``.env``** 파일에 네이버 API 정보를 입력한 후 **"세팅 완료"**라고 말씀해 주세요.
2. **컨테이너 실행 및 검증**: 
   - 사용자가 응답하면 `docker-compose up --build -d `를 실행한다.
   - 컨테이너 내부에서 네이버 API 통신 테스트를 수행하고 결과를 보고한다.

---

## 💾 [Phase 3] 핵심 기능 및 데이터 구조 구현

### 1. 최종 데이터 구조 (Database Schema)
| Table | Column | Type | Description |
| :--- | :--- | :--- | :--- |
| **Store** | `id`, `name`, `brand`, `branch`, `address`, `lat`, `lng` | PK, Str, Float | 매장 정보 |
| **Review** | `id`, `store_id` (FK), `bean_name`, `brew_method` | PK, FK, Str | 원두 및 추출 방식 |
| **Review** | `content` | Text | 테이스팅 본문 |
| **Review** | `front_card_path`, `back_card_path` | String | 카드 이미지 경로 |
| **Tag** | `id`, `name` | PK, Str | 필터링용 태그 |

### 2. 주요 로직
- **볼륨 마운트**: 업로드된 이미지가 컨테이너 재시작 후에도 유지되도록 `static/uploads ` 폴더를 호스트와 연결.
- **정형화 템플릿**: 게시글 작성 시 아래 양식을 `textarea `에 기본 삽입.

```text
[Aroma] (향): (가이드: 코로 느끼는 첫 향)
[Flavor] (풍미): (가이드: 입안에서 느껴지는 맛의 총체)
[Acidity] (산미/산도): (가이드: 밝고 주시한 신맛의 정도)
[Sweetness] (단맛/당도): (가이드: 캐러멜, 과일 같은 단맛)
[Body] (바디감/촉감): (가이드: 입안에서의 무게감과 질감)
[Aftertaste] (여운/후미): (가이드: 삼킨 후 남는 지속성)

[Temperature Change] (온도별 변화)
 - 고온 (Hot): 
 - 중온 (Warm): 
 - 저온 (Cool): 

[Overall] (총평): 
```

[네이버 개발자 센터 API - 검색 로직 상세]
 - 사용자의 검색어 뒤에 자동으로 '카페' 키워드를 조합하여 네이버 지역 검색 API를 호출할 것.
 - API 응답 데이터 중 category 필드를 확인하여, 카페와 관련 없는 결과는 리스트에서 제외할 것.
 - 검색 결과의 title에 포함된 <b>, </b> 등 HTML 태그는 정규표현식으로 제거하여 저장할 것.
 - 네이버 검색 API에서 받은 TM128(KATECH) 좌표를 WGS84 위경도로 변환하는 로직을 Python의 pyproj 라이브러리를 사용해 작성할 것.

---

## 🎨 [Phase 4] 시각적 디테일 및 카페 테마
1. **디자인**: 베이지, 웜 화이트, 딥 브라운 기반의 '카페 감성' UI 적용.
2. **컬러 스펙트럼**: 맛 키워드(Bitter, Floral 등)에 따른 자동 태그 색상 매핑.
3. **목록화**: 사이드바에 **주소별 계층형(시/도 > 구/군)** 아코디언 메뉴 구현.
4. 지도 UI 상세 커스텀
 - Leaflet 타일 레이어는 CartoDB Positron 스타일을 기본으로 사용할 것.
 - 전체 지도 컨테이너에 약간의 sepia 필터를 적용하여 카페 특유의 따뜻한 톤을 유지할 것.
 - 지도 내 팝업창(Popup)과 줌 컨트롤(Zoom Control)의 색상을 프로젝트 메인 컬러인 베이지와 브라운으로 커스텀할 것.

---

## ✅ [Phase 5] 최종 검증 및 시연
1. **Docker 통합 테스트**: 컨테이너 환경에서 모든 기능(검색, 업로드, 저장, 필터링) 작동 확인.
2. **완료 보고**: 서버 접속 주소(예: ````http://localhost:8000 ````)와 함께 최종 구축 현황 보고.
