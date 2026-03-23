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
### 1.  **폴더 구조 생성**: 
    - `app/ `: FastAPI 소스 코드
    - `data/`: SQLite DB 저장 (볼륨 마운트용)
    - `static/uploads/bean_cards/ `: 원두 카드 이미지 저장소
    - `templates/ `: HTML 템플릿 파일
### 2.  **환경 설정 파일 생성**: 
    - `Dockerfile `: Python 3.11-slim 기반 이미지 빌드 설정
    - `docker-compose.yml `: 앱 서비스 및 볼륨 마운팅 설정
    - `requirements.txt `, `.gitignore `, `main.py ` 등 기본 파일 생성.
### 3.  **.env 템플릿 작성**:
    ```env
    NAVER_CLIENT_ID=
    NAVER_CLIENT_SECRET=
    DATABASE_URL=sqlite:///./data/coffee_archive.db
    ```

---

## 🔑 [Phase 2] 사용자 환경 설정 및 컨테이너 가동
### 1. **사용자 대기**: 에이전트는 아래 메시지를 출력하고 사용자 응답을 대기한다.
   > **[환경 설정 안내]** > 프로젝트 구조와 Docker 설정이 완료되었습니다. 루트의 **``.env``** 파일에 네이버 API 정보를 입력한 후 **"세팅 완료"**라고 말씀해 주세요.
### 2. **컨테이너 실행 및 검증**: 
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

### 3. [네이버 개발자 센터 API - 검색 및 좌표 상세]
- **검색 UX**: 사용자 검색어에 '카페'를 자동 조합하여 호출하되, 검색 결과가 여러 개일 경우 **상위 5개를 리스트로 보여주고 사용자가 선택**하게 할 것. (선택 시 해당 매장의 정보가 입력 폼에 자동 채워짐)
- **결과 정제**: `category` 필드를 검사하여 카페 관련 결과만 남기고, `title`의 HTML 태그(`<b>` 등)는 제거할 것.
- **좌표 변환**: 네이버 TM128 좌표(정수형)를 **`EPSG:3857` 계열에서 위경도(`EPSG:4326`)**로 변환하기 위해 `pyproj` 라이브러리를 정확히 사용할 것.

---

## 🎨 [Phase 4] 시각적 디테일 및 프리미엄 카페 테마 구현
에이전트는 단순히 기능을 구현하는 것을 넘어, 아래의 구체적인 디자인 시스템과 컴포넌트 스타일을 적용하여 사용자 경험(UX)을 극대화한다.

### 1. 디자인 시스템 (CSS Variables)
모든 스타일은 아래 정의된 변수를 기반으로 하여 일관성을 유지할 것.
- **Colors**:
  - `--bg-warm-white`: `#F9F7F2` (전체 배경)
  - `--bg-beige`: `#F5F5DC` (카드 및 모달 배경)
  - `--point-brown`: `#4B3621` (주요 텍스트 및 로고)
  - `--accent-chocolate`: `#D2691E` (버튼 및 강조선)
  - `--text-muted`: `#8C7B6C` (부연 설명)
- **Fonts**: 
  - 제목: `'Nanum Myeongjo', serif` (우아한 분위기)
  - 본문: `'Pretendard', sans-serif` (가독성 중심)

### 2. 맛 스펙트럼 시각화 알고리즘 (Flavor-to-Color)
게시글의 테두리나 태그에 적용할 색상 매핑 로직을 구현할 것.
- **Keywords Dictionary**:
  - **Floral**: `#D67272` (키워드: 꽃, 장미, 자스민, 허브)
  - **Fruity**: `#F1C40F` (키워드: 산미, 과일, 상큼, 베리, 레몬)
  - **Nutty**: `#D2B48C` (키워드: 고소, 견과류, 아몬드, 보리)
  - **Sweet**: `#3D2B1F` (키워드: 초콜릿, 카라멜, 단맛, 묵직)
- **Logic**: `content`에서 가장 많이 등장하는 키워드군을 찾아 대표색으로 지정하거나, 상위 2개를 섞어 `linear-gradient`를 생성하여 카드 상단 보더에 적용할 것.

### 3. 지도 UI 상세 커스텀 (Leaflet Advanced)
- **Tile**: CartoDB Positron을 기본으로 사용하되, CSS `filter: sepia(0.3) brightness(1.05);`를 적용해 종이 질감을 연출할 것.
- **Popup**: 팝업창 모서리를 15px로 둥글게 처리하고, 내부 텍스트에 `Nanum Myeongjo` 폰트 적용.
- **Zoom Control**: 기본 파란색 버튼을 제거하고, `background: var(--bg-beige); color: var(--point-brown);` 스타일의 둥근 버튼으로 커스텀할 것.

### 4. 컴포넌트 디자인 상세
- **게시글 카드 (Post Card)**: 
  - 마우스 오버 시 살짝 위로 뜨는 애니메이션 (`transform: translateY(-5px); transition: 0.3s;`) 추가.
  - 원두 카드의 앞면 사진은 좌측에, 뒷면 사진은 마우스 오버 시 페이드 인(Fade-in) 되도록 구현.
- **사이드바 아코디언 (Location Sidebar)**:
  - '시/도 > 구/군 > 매장' 계층형 메뉴.
  - 현재 보고 있는 매장은 `font-weight: bold;`와 함께 왼쪽에 작은 커피잔 아이콘(☕) 표시.
- **입력 모달 (Modal)**: 
  - 뒷배경은 `backdrop-filter: blur(5px);`를 적용하여 몰입감 조성.
  - 폼 입력 시 테두리 색상이 `--accent-chocolate`로 부드럽게 변하는 효과 추가.

### 5. 마이크로 인터랙션 (Micro-interactions)
- **로딩 애니메이션**: 페이지 로딩 시 커피잔에 김이 모락모락 나는 형태의 단순한 CSS 애니메이션 노출.
- **저장 완료 피드백**: 기록 저장 시 "기록이 아카이브에 안전하게 보관되었습니다."라는 토스트 메시지 출력.

---

## ✅ [Phase 5] 최종 검증 및 시연
1. **Docker 통합 테스트**: 컨테이너 환경에서 모든 기능(검색, 업로드, 저장, 필터링) 작동 확인.
2. **완료 보고**: 서버 접속 주소(예: `http://localhost:8000 `)와 함께 최종 구축 현황 보고.
