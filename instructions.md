# ☕ Project Mission: Specialty Coffee Archive Server

**목표**: Leaflet 지도와 네이버 검색 API를 연동하고, 정형화된 테이스팅 노트와 원두 카드 사진을 관리하는 감성적인 개인용 커피 기록 웹 서버 구축.

---

## 🛠 [Phase 0] 에이전트 기본 작동 원칙
- **의존성 관리**: 새로운 라이브러리 설치 시 즉시 `requirements.txt`를 업데이트할 것. (```python-multipart ```, ```pyproj ```, ```fastapi ```, ```uvicorn ```, ```sqlalchemy ``` 등 필수 포함)
- **형상 관리**: 각 Phase 완료 시 의미 있는 메시지와 함께 ```git commit ```을 수행할 것.
- **보안**: API 키 등 민감 정보는 반드시 ```.env ```에서 관리하고 ```.gitignore ```에 포함할 것.

---

## 📂 [Phase 1] 프로젝트 스캐폴딩 (Scaffolding)
1.  **폴더 구조 생성**: 
    - ```app/ ```: 백엔드 로직 및 API 엔드포인트
    - ```static/uploads/bean_cards/ ```: 원두 카드 이미지(앞/뒤) 저장소
    - ```templates/ ```: HTML/JinJa2 템플릿 파일
2.  **기본 파일 생성**: ```main.py ```, ```models.py ```, ```database.py ```, ```requirements.txt ```, ```.gitignore ``` 생성.
3.  **.env 템플릿 작성**: 아래 내용을 포함한 ```.env ``` 파일을 생성한다 (값은 비워둠).
    ```env
    NAVER_CLIENT_ID=
    NAVER_CLIENT_SECRET=
    DATABASE_URL=sqlite:///./coffee_archive.db
    ```

---

## 🔑 [Phase 2] 사용자 환경 설정 및 검증
1. **사용자 대기**: 에이전트는 아래 메시지를 출력하고 사용자 응답을 대기한다.
   > **[환경 설정 안내]** > 프로젝트 기본 구조 생성이 완료되었습니다. 루트 디렉토리의 **``.env``** 파일에 네이버 API ID와 Secret을 입력한 후 **"세팅 완료"**라고 말씀해 주세요.
2. **연결성 테스트**: 세팅 완료 응답 시, 네이버 검색 API에 테스트 요청을 보내 통신 성공 여부를 확인하고 결과를 보고한다.

---

## 💾 [Phase 3] 핵심 기능 및 데이터 구조 구현

### 1. 최종 데이터 구조 (Database Schema)
에이전트는 아래 관계형 구조를 바탕으로 DB 모델을 정의한다.

| Table | Column | Type | Description |
| :--- | :--- | :--- | :--- |
| **Store** | `id`, `name`, `brand`, `branch`, `address`, `lat`, `lng` | PK, Str, Float | 매장 정보 (네이버 API 연동) |
| **Review** | `id`, `store_id` (FK), `bean_name`, `brew_method` | PK, FK, Str | 원두명 및 추출 방식 (Select Box) |
| **Review** | `content` | Text | 테이스팅 노트 본문 |
| **Review** | `front_card_path`, `back_card_path` | String | 카드 이미지 파일 경로 (앞/뒤) |
| **Review** | `created_at` | DateTime | 작성 일시 |
| **Tag** | `id`, `name` | PK, Str | 필터링용 태그 (브랜드, 원두, 방식 등) |
| **ReviewTag** | `review_id`, `tag_id` | FK, FK | N:M 관계 조인 테이블 |

### 2. 주요 로직 구현
- **좌표 변환**: 네이버 API의 KATECH 좌표를 Leaflet 지도용 WGS84(위경도)로 변환하는 유틸리티 작성.
- **이미지 업로드**: 원두 카드의 앞면(Front)과 뒷면(Back) 사진을 각각 업로드받아 저장하고 경로를 DB에 매핑.
- **정형화 템플릿**: 게시글 작성 시 `textarea` 의 `defaultValue`로 아래 템플릿을 미리 삽입.

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

---

## 🎨 [Phase 4] 시각적 디테일 및 카페 테마
1. **디자인 시스템**: 베이지, 웜 화이트, 딥 브라운 기반의 따뜻한 '카페 감성' UI 적용.
2. **컬러 스펙트럼**: 저장된 맛 키워드에 따라 태그 색상을 자동 매핑하는 JS 로직 구현.
   - *Bitter/Chocolate*: `#3D2B1F`
   - *Floral/Berry*: `#D67272`
   - *Citrus/Acidity*: `#E4D00A`
3. **목록화**: 사이드바에 **주소별 계층형(시/도 > 구/군) 아코디언 메뉴**를 구현하여 지역별 필터링 기능 제공.

---

## ✅ [Phase 5] 최종 검증 및 시연
1. **통합 시나리오 테스트**: 에이전트 자율적으로 '장소 검색 → 이미지 업로드 → 템플릿 작성 → 저장 → 태그 필터링' 과정을 수행하여 무결성 검증.
2. **완료 보고**: 모든 기능이 정상임을 확인하면 서버 실행 방법(uvicorn 등)과 함께 최종 결과 보고.
