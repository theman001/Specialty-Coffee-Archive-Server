# ☕ Specialty Coffee Archive Server (Docker Edition)

이 프로젝트는 나만의 커피 취향을 기록하고, 지도 위에서 스페셜티 카페 방문기를 관리하기 위한 **Docker 기반 모놀리식 웹 서버**입니다. 홈랩 서버(Beelink 등)에 최적화되어 있으며, 컨테이너 기술을 통해 복잡한 설정 없이 즉시 실행 가능합니다.

---

## 🚀 주요 기능
- **Naver Maps API 연동**: 검색한 매장을 지도(Leaflet) 위에 마킹 및 자동 좌표 변환.
- **정형화된 테이스팅 노트**: 전문가급 커핑 시트를 기반으로 한 객관적 맛 기록.
- **원두 카드 아카이빙**: 스페셜티 원두 정보 카드(앞/뒤) 사진 업로드 및 보관.
- **태그 기반 필터링**: 추출 방식, 원두, 지역별 게시글 모아보기.

---

## 🛠 테크 스택
- **Backend**: FastAPI (Python 3.11)
- **Frontend**: Jinja2 Templates, Leaflet.js, TailwindCSS
- **Database**: SQLite (SQLModel)
- **Infrastructure**: Docker, Docker Compose

---

## 📦 설치 및 실행 방법

### 1. 사전 준비
- 시스템에 **Docker**와 **Docker Compose**가 설치되어 있어야 합니다.
- [네이버 개발자 센터](https://developers.naver.com/)에서 '검색 API' 권한이 있는 Client ID와 Secret을 발급받으세요.

### 2. 환경 설정 (.env)
프로젝트 루트에 `.env ` 파일을 생성하고 아래 내용을 입력합니다.
```env
NAVER_CLIENT_ID=your_ID
NAVER_CLIENT_SECRET=your_Secret
DATABASE_URL=sqlite:///./data/coffee_archive.db
```

### 3. 컨테이너 빌드 및 실행
터미널에서 아래 명령어를 입력합니다.
```bash
# 컨테이너 빌드 및 백그라운드 실행
docker-compose up --build -d
```
- `--build `: 소스 코드가 변경되었을 때 이미지를 새로 빌드합니다.
- `-d `: 데몬(백그라운드) 모드로 실행합니다.

---

## 🐳 꼭 알아두어야 할 Docker 명령어

홈랩 서버에서 운영할 때 자주 사용하게 될 명령어들입니다.

| 기능 | 명령어 | 설명 |
| :--- | :--- | :--- |
| **로그 확인** | `docker-compose logs -f ` | 서버 내부에서 발생하는 로그(에러 등)를 실시간으로 확인합니다. |
| **서버 중지** | `docker-compose stop ` | 데이터를 보존하며 컨테이너만 잠시 멈춥니다. |
| **서버 재시작** | `docker-compose restart ` | 설정 변경 후 프로세스를 다시 시작할 때 사용합니다. |
| **완전 삭제** | `docker-compose down ` | 컨테이너를 삭제합니다. (볼륨 설정 덕분에 DB와 이미지는 유지됩니다.) |
| **상태 확인** | `docker ps ` | 현재 실행 중인 컨테이너 목록과 포트 번호를 확인합니다. |

---

## 📂 프로젝트 구조
```text
.
├── app/                # 백엔드 소스 코드
├── static/             # 정적 파일 (CSS, JS, Images)
│   └── uploads/        # 업로드된 원두 카드 이미지가 저장되는 곳 (볼륨 마운트)
├── templates/          # HTML 템플릿 파일
├── data/               # SQLite 데이터베이스 파일 저장 (볼륨 마운트)
├── Dockerfile          # 앱 빌드 설정
├── docker-compose.yml  # 서비스 구성 및 볼륨 설정
└── requirements.txt    # 파이썬 의존성 목록
```

---

## ⚠️ 주의 사항
- **데이터 백업**: `./data/ ` 폴더와 `./static/uploads/ ` 폴더는 Docker 외부(호스트)와 연결되어 있으므로, 이 폴더들만 백업하면 모든 기록이 보존됩니다.
- **API 쿼터**: 네이버 지역 검색 API의 일일 한도를 초과하지 않도록 주의하세요.

---
**Happy Brewing!** ☕
