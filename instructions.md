# ☕ Project Mission: Docker-based Coffee Archive Server (Monolithic)

**목표**: Docker 컨테이너 기반으로 Leaflet 지도, 네이버 API, 정형화된 테이스팅 노트를 관리하는 감성적인 커피 기록 서버 구축.

---

## 🛠 [Phase 0] 에이전트 기본 작동 원칙
- **컨테이너화**: 모든 실행 환경은 Docker를 기준으로 한다. (`Dockerfile`, `docker-compose.yml` 필수)
- **의존성 관리**: 새로운 라이브러리 설치 시 즉시 `requirements.txt`를 업데이트할 것. (`pyproj`, `sqlmodel`, `python-multipart` 필수 포함)
- **형상 관리**: 각 Phase 완료 시 의미 있는 메시지와 함께 `git commit`을 수행할 것.
- **데이터 보존**: SQLite DB와 업로드 이미지는 Docker 볼륨(Volume)을 통해 호스트에 보존되도록 설정할 것.

---

## 📂 [Phase 1] 프로젝트 스캐폴딩 (Docker 포함)
### 1.  **폴더 구조 생성**: 
    - `app/`: FastAPI 소스 코드
    - `data/`: SQLite DB 저장 (볼륨 마운트용)
    - `static/uploads/bean_cards/`: 원두 카드 이미지 저장소
    - `templates/`: HTML 템플릿 파일
### 2.  **환경 설정 파일 생성**: 
    - `Dockerfile`: Python 3.11-slim 기반 이미지 빌드 설정
    - `docker-compose.yml`: 앱 서비스 및 볼륨 마운팅 설정
    - `requirements.tx `, `.gitignore`, `main.py` 등 기본 파일 생성.
### 3.  **.env 템플릿 작성**:
    ```env
    NAVER_CLIENT_ID=
    NAVER_CLIENT_SECRET=
    DATABASE_URL=sqlite:///./data/coffee_archive.db
    ```

---

## 🔑 [Phase 2] 사용자 환경 설정 및 컨테이너 가동
### 1. **사용자 대기**: 에이전트는 아래 메시지를 출력하고 사용자 응답을 대기한다.
   > **[환경 설정 안내]** > 프로젝트 구조와 Docker 설정이 완료되었습니다. 루트의 **`.env`** 파일에 네이버 API 정보를 입력한 후 **"세팅 완료"**라고 말씀해 주세요.
### 2. **컨테이너 실행 및 검증**: 
   - 사용자가 응답하면 `docker-compose up --build -d`를 실행한다.
   - 컨테이너 내부에서 네이버 API 통신 테스트를 수행하고 결과를 보고한다.

---

## 💾 [Phase 3] 핵심 기능 및 데이터 구조 구현

### 1. 최종 데이터 구조 (Database Schema)
| Table | Column | Type | Description |
| :--- | :--- | :--- | :--- |
| **Store** | `id`, `name`, `brand`, `address`, `lat`, `lng` | PK, Str, Float | 매장 기본 정보 |
| **Store** | `is_wishlist` | Boolean | 위시리스트 등록 여부 (기본값: False) |
| **Store** | `marker_color` | String | 매장별 커스텀 마커 색상 (기본값: 로직에 따른 지정색) |
| **Review** | `id`, `store_id` (FK), `bean_name`, `content` | PK, FK, Str, Text | 테이스팅 노트 및 원두 정보 |
| **Review** | `front_card_path`, `back_card_path` | String | 카드 이미지 경로 |

### 2. 주요 로직
- **볼륨 마운트**: 업로드된 이미지가 컨테이너 재시작 후에도 유지되도록 `static/uploads` 폴더를 호스트와 연결.
- **정형화 템플릿**: 게시글 작성 시 테이스팅 가이드 양식을 `textarea`에 기본 삽입.

### 3. [네이버 개발자 센터 API - 검색 및 좌표 상세]
- **검색 UX**: 사용자 검색어에 '카페'를 자동 조합하여 호출하되, **상위 5개를 리스트로 노출하여 사용자가 선택**하게 할 것. 선택 시 해당 매장의 정보가 입력 폼에 자동 매핑됨.
- **결과 정제**: `category` 필드를 검사하여 카페 관련 결과만 남기고, `title`의 HTML 태그는 정규표현식으로 제거할 것.
- **좌표 변환**: 네이버 TM128 좌표(정수형)를 `pyproj`를 사용하여 **`EPSG:4326`(위경도)**로 정확히 변환할 것. 데이터 손실 방지를 위해 `Float64` 정밀도를 유지할 것.

### 4. 저장 및 매장 관리 로직 (3-Type Logic)
지도의 마커는 아래 세 가지 상태를 실시간으로 반영하여 표시한다.
- **유형 1 [위시리스트]**: 리뷰가 없고 `is_wishlist`가 **True**인 매장. (기본색: 회색)
- **유형 2 [기록+위시]**: 리뷰가 존재하고 `is_wishlist`가 **True**인 매장. (기본색: 핑크색)
- **유형 3 [기록 전용]**: 리뷰가 존재하고 `is_wishlist`가 **False**인 매장. (기본색: 노란색)

### 5. 상세 프로세스 (UX Flow)
- **글 작성 시 매장 선택**: 즐겨찾기(Store DB) 목록에서 선택하거나 네이버 검색 API로 새로 선택 가능.
- **신규 매장 기록 시**: 즐겨찾기에 없는 매장일 경우, 글 저장 완료 전 **"이 매장을 위시리스트(즐겨찾기)에도 추가할까요?"**라는 컨펌창을 띄워 `is_wishlist` 상태를 결정함.
- **간편 토글 기능**: 지도 팝업이나 게시글 상세 보기에서 클릭 한 번으로 `is_wishlist` 상태(등록/해제)를 즉시 변경할 수 있는 토글 버튼 구현. (변경 시 마커 색상 즉시 업데이트)

---

## 🎨 [Phase 4] 시각적 디테일 및 프리미엄 카페 테마 구현
에이전트는 단순히 기능을 구현하는 것을 넘어, 아래의 구체적인 디자인 시스템과 컴포넌트 스타일을 적용하여 사용자 경험(UX)을 극대화한다.

### 1. 디자인 시스템 (CSS Variables)
모든 스타일은 정의된 CSS 변수와 `Nanum Myeongjo`(제목), `Pretendard`(본문) 폰트를 적용하여 일관성을 유지할 것.

### 2. 맛 스펙트럼 시각화 알고리즘 (Flavor-to-Color)
- **Logic**: `content`에서 가장 많이 등장하는 키워드군(Floral, Fruity, Nutty, Sweet)을 찾아 대표색으로 지정하거나 상위 2개를 섞어 `linear-gradient`를 생성하여 카드 상단 보더에 적용할 것.

### 3. 지도 UI 상세 커스텀 (Leaflet Advanced)
- **Tile**: CartoDB Positron 타일에 CSS `filter: sepia(0.3) brightness(1.05);`를 적용해 종이 질감을 연출할 것.
- **마커 색상 전략**: 마커는 HEX 코드 색상 변경이 용이하도록 **SVG 마커 또는 `L.divIcon`**으로 구현할 것. 사용자가 마커 설정에서 색상을 변경하면 DB의 `marker_color`가 즉시 업데이트되어 지도에 반영되어야 함.
- **Popup**: 팝업창 내에 **위시리스트 토글 스위치**를 배치하고 브라운 톤 UI 적용.

### 4. 컴포넌트 디자인 상세
- **게시글 카드**: 마우스 오버 시 부상 애니메이션 및 원두 카드 뒷면 페이드 인 효과 적용.
- **사이드바**: '시/도 > 구/군 > 매장' 계층형 메뉴 구현.

---

## ✅ [Phase 5] 최종 검증 및 시연
1. **3-Type 로직 테스트**: 리뷰 작성 전/후 및 토글 변경에 따른 마커 색상 변화 확인.
2. **Docker 통합 테스트**: 컨테이너 환경에서 모든 기능(검색, 업로드, 저장, 필터링) 작동 확인.
3. **완료 보고**: 서버 접속 주소와 함께 최종 구축 현황 보고.
