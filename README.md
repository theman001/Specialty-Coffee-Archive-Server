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

## 📦 설치 및 실행 방법 (Deployment)

### 1. 일반 서버 (Docker Standard)
시스템에 Docker와 Docker Compose가 설치된 환경에서 아래 단계를 따릅니다.

1.  **환경 설정**: 루트 디렉토리에 `.env` 파일을 생성합니다.
2.  **컨테이너 실행**:
    ```bash
    docker-compose up --build -d
    ```

### 2. NAS 서버 배포 (NAS Dedicated)
NAS(Synology, QNAP 등)에서 운영할 경우, 데이터의 영구 보존을 위해 물리적 경로를 직접 지정하는 것이 좋습니다.

**`docker-compose.yml` 볼륨 매핑 예시**:
```yaml
volumes:
  # NAS 저장소 실제 경로 : 컨테이너 내부 경로 (고정)
  - /volume1/docker/coffee_archive/data:/app/data
  - /volume1/docker/coffee_archive/static/uploads:/app/static/uploads
```
*   **주의**: NAS 제어판에서 해당 폴더에 대한 읽기/쓰기 권한이 Docker 그룹에 부여되어 있어야 합니다.

---

## ⚙️ 환경 설정 (.env)
서버 구동에 필요한 핵심 설정값들입니다.

```env
NAVER_CLIENT_ID=발급받은_ID
NAVER_CLIENT_SECRET=발급받은_Secret
# DB는 컨테이너 내부 경로(/app/data/...) 기준으로 설정하면 볼륨 매핑된 NAS 폴더에 저장됩니다.
DATABASE_URL=sqlite:///./data/coffee_archive.db
```

---

## 🐳 주요 운영 명령어

| 상황 | 명령어 | 설명 |
| :--- | :--- | :--- |
| **최초 실행/빌드** | `docker-compose up --build -d` | 이미지를 빌드하고 백그라운드에서 실행합니다. |
| **실시간 로그** | `docker-compose logs -f` | 서버 내부 로그 및 에러 상황을 모니터링합니다. |
| **설정 반영** | `docker-compose restart` | `.env`나 소스 수정 후 프로세스만 재시작합니다. |
| **완전 재시작** | `docker-compose down && docker-compose up -d` | 컨테이너 구성을 완전히 새로 고침합니다. |

---

## 📂 프로젝트 구조
```text
.
├── app/                # 백엔드 핵심 소스 (Main API, Auth, Database Model)
├── static/             # 정적 파일 및 업로드 이미지 (볼륨 마운트)
├── templates/          # HTML 레이아웃 및 UI 컴포넌트
├── data/               # SQLite 데이터베이스 (볼륨 마운트)
├── docker-compose.yml  # 서비스 올인원 구성 설정
└── Dockerfile          # 파이썬 3.11 환경 빌드 설정
```

---

## 💾 데이터 백업 및 보안
*   **백업 대상**: NAS에 매핑된 `data/` 폴더와 `static/uploads/` 폴더만 정기적으로 백업하면 모든 데이터가 보존됩니다.
*   **보안**: 외부망 접속 시 Admin 접근을 위해 **장치 ID(Device ID)** 등록 혹은 **OTP** 설정을 반드시 권장합니다.

---
**Happy Brewing!** ☕

