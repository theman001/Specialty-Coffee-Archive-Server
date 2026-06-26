from fastapi import FastAPI, Depends, Request, Form, UploadFile, File, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from typing import Optional, List
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlmodel import Session, select
from sqlalchemy import func
from sqlalchemy import text
from pydantic import BaseModel, Field
import os
import json
import time
import requests
from dotenv import load_dotenv

def get_naver_client_id():
    load_dotenv(dotenv_path=".env", override=True)
    val = os.getenv("NAVER_CLIENT_ID")
    if val: return val
    load_dotenv(dotenv_path="/app/.env", override=True)
    return os.getenv("NAVER_CLIENT_ID", "")

from datetime import datetime, timezone

from .database import (
    create_db_and_tables, get_session, Store, Review, WikiPost, WikiCategory, engine,
    HomeCafeRecipe, HomeCafeRecipeVersion, HomeCafePourStep, HomeCafeEquipment,
    HomeCafeBrewLog, HomeCafeBrewLogStep,
)
from .utils import search_naver_local, extract_flavor_color
from .auth import get_current_user, require_admin

app = FastAPI(title="Specialty Coffee Archive")

class _NoCacheStaticMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        p = request.url.path
        if p.startswith("/static/") and (p.endswith(".js") or p.endswith(".css")):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
        return response

app.add_middleware(_NoCacheStaticMiddleware)

from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=["*"])

from .auth import router as auth_router
app.include_router(auth_router)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

class StoreCreateRequest(BaseModel):
    name: str = Field(..., max_length=200)
    brand: Optional[str] = Field(None, max_length=200)
    address: str = Field(..., max_length=500)
    lat: float
    lng: float
    is_wishlist: bool = False


class WikiPostCreateRequest(BaseModel):
    title: str = Field(..., max_length=500)
    content: str = Field(..., max_length=50000)
    category: Optional[str] = Field(None, max_length=200)
    category_id: Optional[int] = None


class PourStepInput(BaseModel):
    step_order: int
    label: Optional[str] = Field(None, max_length=50)
    water_g: Optional[float] = Field(None, ge=0, le=500)
    duration_s: Optional[int] = Field(None, ge=0, le=600)
    memo: Optional[str] = Field(None, max_length=200)


class HomeCafeRecipeCreateRequest(BaseModel):
    bean_name: str = Field(..., max_length=200)
    review_id: Optional[int] = None
    roast_level: Optional[str] = Field(None, max_length=50)
    brew_type: Optional[str] = Field(None, pattern="^(hot|ice)$")
    water_temp_c: Optional[float] = Field(None, ge=50, le=100)
    dose_g: Optional[float] = Field(None, gt=0, le=100)
    total_water_g: Optional[float] = Field(None, gt=0, le=2000)
    ratio_n: Optional[float] = Field(None, gt=0, le=30)
    extraction_mode: str = Field(default="dose", pattern="^(dose|ratio)$")
    grinder_name: Optional[str] = Field(None, max_length=100)
    grind_clicks: Optional[int] = Field(None, ge=0, le=500)
    grind_note: Optional[str] = Field(None, max_length=100)
    dripper: str = Field(..., max_length=100)
    filter_type: Optional[str] = Field(None, max_length=100)
    water_type: Optional[str] = Field(None, max_length=100)
    result_memo: Optional[str] = Field(None, max_length=2000)
    result_rating: Optional[int] = Field(None, ge=1, le=5)
    change_note: Optional[str] = Field(None, max_length=1000)
    pour_steps: List[PourStepInput] = Field(default=[])


class HomeCafeRecipeUpdateRequest(HomeCafeRecipeCreateRequest):
    bean_name: Optional[str] = Field(None, max_length=200)
    dripper: Optional[str] = Field(None, max_length=100)
    result_only: bool = False


class EquipmentCreateRequest(BaseModel):
    equipment_type: str = Field(..., pattern="^(grinder|dripper)$")
    name: str = Field(..., min_length=1, max_length=100)
    max_clicks: Optional[int] = Field(None, ge=1, le=500)


class BrewLogStepInput(BaseModel):
    step_order: int
    label: Optional[str] = Field(None, max_length=50)
    actual_water_g: Optional[float] = Field(None, ge=0, le=500)
    actual_duration_s: Optional[int] = Field(None, ge=0, le=600)


class BrewLogCreateRequest(BaseModel):
    version_id: int
    taste_note: Optional[str] = Field(None, max_length=1000)
    overall_rating: Optional[int] = Field(None, ge=1, le=5)
    steps: List[BrewLogStepInput] = Field(default=[])


def error_response(status_code: int, code: str, message: str):
    return JSONResponse(
        status_code=status_code,
        content={"status": "error", "code": code, "message": message},
    )


def _unlink_upload_path(path: Optional[str]) -> None:
    if not path:
        return
    rel = path.lstrip("/").replace("\\", "/")
    if os.path.isfile(rel):
        try:
            os.remove(rel)
        except OSError:
            pass


def _save_review_image(upload: UploadFile, suffix: str, upload_dir: str, timestamp: str) -> str:
    if not upload or not upload.filename:
        raise ValueError("Empty upload.")
    if not upload.content_type or not upload.content_type.startswith("image/"):
        raise ValueError("Only image uploads are allowed.")
    data = upload.file.read()
    max_bytes = 5 * 1024 * 1024
    if len(data) > max_bytes:
        raise ValueError("Image file is too large. Max 5MB.")
    safe_name = os.path.basename(upload.filename).replace(" ", "_")
    file_path = f"{upload_dir}/{timestamp}_{suffix}_{safe_name}"
    with open(file_path, "wb") as buffer:
        buffer.write(data)
    return "/" + file_path


def _parse_tags(raw: Optional[str]) -> str:
    if raw is None:
        return ""
    parts = [x.strip().lstrip("#") for x in str(raw).replace("\n", ",").split(",")]
    uniq = []
    for p in parts:
        if not p:
            continue
        if p not in uniq:
            uniq.append(p)
    return ",".join(uniq)


def _tags_to_list(raw: Optional[str]) -> list:
    if not raw:
        return []
    return [x for x in [s.strip() for s in str(raw).split(",")] if x]

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if isinstance(exc.detail, dict):
        code = exc.detail.get("code", f"HTTP_{exc.status_code}")
        message = exc.detail.get("message", "Request failed.")
        return error_response(exc.status_code, code, message)
    message = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return error_response(exc.status_code, f"HTTP_{exc.status_code}", message)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return error_response(422, "VALIDATION_ERROR", "Invalid request payload.")

@app.on_event("startup")
def on_startup():
    create_db_and_tables()
    _ensure_legacy_columns()


def _ensure_legacy_columns():
    """
    Lightweight migration for existing SQLite files.
    """
    try:
        with engine.begin() as conn:
            cols = {row[1] for row in conn.execute(text("PRAGMA table_info('review')")).fetchall()}
            if "tags" not in cols:
                conn.execute(text("ALTER TABLE review ADD COLUMN tags TEXT"))
            wiki_cols = {row[1] for row in conn.execute(text("PRAGMA table_info('wikipost')")).fetchall()}
            if "category_id" not in wiki_cols:
                conn.execute(text("ALTER TABLE wikipost ADD COLUMN category_id INTEGER"))
            for tbl in ["homecaferecipe", "homecaferecipeversion", "homecafepourstep", "homecafeequipment", "homecafebrewlog", "homecafebrewlogstep"]:
                try:
                    conn.execute(text(f"SELECT 1 FROM {tbl} LIMIT 1"))
                except Exception:
                    try:
                        from sqlmodel import SQLModel as _SM
                        _SM.metadata.tables[tbl].create(bind=conn, checkfirst=True)
                    except Exception:
                        pass
    except Exception:
        # no-op for non-sqlite / first-boot race
        pass

@app.get("/")
def read_root(request: Request, user: dict = Depends(get_current_user)):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "naver_map_client_id": get_naver_client_id(),
            "user_role": user["role"]
        },
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
        },
    )

@app.get("/api/search")
def search_local(query: str):
    return search_naver_local(query)


def _metro_cache_path() -> str:
    # 서버 실행 CWD와 무관하게 고정 경로 사용 (static mount 아래에 둬서 디버깅/배포도 단순화)
    base = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    out_dir = os.path.join(base, "static", "data")
    os.makedirs(out_dir, exist_ok=True)
    return os.path.join(out_dir, "metro_osm_lines.geojson")


def _metro_routes_cache_path() -> str:
    base = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    out_dir = os.path.join(base, "static", "data")
    os.makedirs(out_dir, exist_ok=True)
    return os.path.join(out_dir, "metro_osm_routes.geojson")


def _build_overpass_query() -> str:
    # 수도권 전철: OSM relation(route=subway|train) 기반으로 노선 선형을 가져옵니다.
    # bbox: (south,west,north,east) - 서울/수도권 커버
    bbox = "37.0,126.3,38.2,128.3"
    return f"""
[out:json][timeout:180];
(
  way["railway"="subway"]({bbox});
  way["railway"="light_rail"]({bbox});
  way["railway"="rail"]["tunnel"="subway"]({bbox});
);
out body geom;
""".strip()


def _build_overpass_routes_query() -> str:
    # 수도권 전철 "노선 관계(relation)" 기반. relation 태그(ref/colour/name)를 쓰면 호선 분류가 쉬워집니다.
    # bbox: (south,west,north,east)
    bbox = "37.0,126.3,38.2,128.3"
    return f"""
[out:json][timeout:180];
(
  relation["route"="subway"]["network"~"Seoul|Incheon|KORAIL|Korail|Metropolitan|Metro"]({bbox});
  relation["route"="subway"]["name"~"호선|Line|공항|신분당|경의|중앙|분당|수인|경춘|서해|김포|의정부|인천"]({bbox});
  relation["route"="subway"]["ref"]({bbox});
  relation["route"="train"]["service"~"commuter|regional"]["network"~"Seoul|Incheon|KORAIL|Korail"]({bbox});
);
out body;
way(r);
out body geom;
""".strip()


def _overpass_routes_to_geojson(payload: dict) -> dict:
    elements = payload.get("elements") or []
    ways = {}
    relations = []
    for el in elements:
        t = el.get("type")
        if t == "way":
            ways[el.get("id")] = el
        elif t == "relation":
            relations.append(el)

    features = []
    for rel in relations:
        tags = rel.get("tags") or {}
        ref = str(tags.get("ref") or "")
        name = str(tags.get("name") or "")
        colour = str(tags.get("colour") or tags.get("color") or "")
        network = str(tags.get("network") or "")
        route = str(tags.get("route") or "")

        for mem in rel.get("members") or []:
            if mem.get("type") != "way":
                continue
            wid = mem.get("ref")
            w = ways.get(wid)
            if not w:
                continue
            geom = w.get("geometry") or []
            coords = []
            for p in geom:
                lon = p.get("lon")
                lat = p.get("lat")
                if lon is None or lat is None:
                    continue
                coords.append([lon, lat])
            if len(coords) < 2:
                continue
            features.append({
                "type": "Feature",
                "properties": {
                    "ref": ref,
                    "name": name,
                    "colour": colour,
                    "network": network,
                    "route": route,
                    "way_id": int(wid) if wid is not None else None,
                },
                "geometry": {"type": "LineString", "coordinates": coords},
            })

    return {"type": "FeatureCollection", "features": features}


def _overpass_to_geojson(payload: dict) -> dict:
    elements = payload.get("elements") or []
    features = []

    for el in elements:
        if el.get("type") != "way":
            continue
        geom = el.get("geometry") or []
        coords = []
        for p in geom:
            lon = p.get("lon")
            lat = p.get("lat")
            if lon is None or lat is None:
                continue
            coords.append([lon, lat])
        if len(coords) < 2:
            continue
        tags = el.get("tags") or {}
        features.append({
            "type": "Feature",
            "properties": {
                "name": str(tags.get("name") or ""),
                "ref": str(tags.get("ref") or ""),
                "colour": str(tags.get("colour") or tags.get("color") or ""),
                "railway": str(tags.get("railway") or ""),
                "tunnel": str(tags.get("tunnel") or ""),
            },
            "geometry": {"type": "LineString", "coordinates": coords},
        })

    return {"type": "FeatureCollection", "features": features}


@app.get("/api/metro/osm-lines")
def get_metro_osm_lines(force: int = 0):
    """
    옵션 A: Overpass API에서 수도권 전철 노선 선형을 가져와 GeoJSON으로 캐시한 뒤 제공합니다.
    - force=1: 캐시 무시하고 재생성
    """
    cache_path = _metro_cache_path()
    if not force and os.path.isfile(cache_path):
        with open(cache_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return JSONResponse(content=data, headers={"Cache-Control": "public, max-age=86400"})

    q = _build_overpass_query()
    overpass_urls = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.nchc.org.tw/api/interpreter",
    ]
    last_err = None
    raw = None
    headers = {
        "Content-Type": "text/plain; charset=utf-8",
        "User-Agent": "SpecialtyCoffeeArchive/1.0 (local dev)",
    }
    for url in overpass_urls:
        try:
            r = requests.post(url, data=q.encode("utf-8"), headers=headers, timeout=360)
            if not r.ok:
                last_err = f"{url} -> HTTP {r.status_code}"
                continue
            raw = r.json()
            break
        except requests.RequestException as e:
            last_err = f"{url} -> {type(e).__name__}"
            continue

    if raw is None:
        return error_response(502, "OVERPASS_FAILED", f"Overpass failed ({last_err or 'unknown'}). Try again later.")

    geo = _overpass_to_geojson(raw)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(geo, f, ensure_ascii=False)
    return JSONResponse(content=geo, headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/metro/osm-routes")
def get_metro_osm_routes(force: int = 0):
    """
    노선 관계(relation) 기반으로 호선별 속성(ref/colour/name)을 유지한 GeoJSON을 생성/캐시합니다.
    - force=1: 캐시 무시하고 재생성
    """
    cache_path = _metro_routes_cache_path()
    if not force and os.path.isfile(cache_path):
        with open(cache_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        # 빈 캐시는 의미가 없으므로 자동 재생성 시도
        if len(data.get("features") or []) > 0:
            return JSONResponse(content=data, headers={"Cache-Control": "public, max-age=86400"})

    q = _build_overpass_routes_query()
    overpass_urls = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
    ]
    last_err = None
    raw = None
    headers = {
        "Content-Type": "text/plain; charset=utf-8",
        "User-Agent": "SpecialtyCoffeeArchive/1.0 (local dev)",
    }
    for url in overpass_urls:
        try:
            r = requests.post(url, data=q.encode("utf-8"), headers=headers, timeout=360)
            if not r.ok:
                last_err = f"{url} -> HTTP {r.status_code}"
                continue
            raw = r.json()
            break
        except requests.RequestException as e:
            last_err = f"{url} -> {type(e).__name__}"
            continue

    if raw is None:
        return error_response(502, "OVERPASS_FAILED", f"Overpass failed ({last_err or 'unknown'}). Try again later.")

    geo = _overpass_routes_to_geojson(raw)
    # 생성 중 재로딩/네트워크 변동으로 간헐적으로 빈 결과가 나올 수 있어,
    # 빈 결과는 캐시하지 않고 에러로 처리합니다.
    if len(geo.get("features") or []) == 0:
        return error_response(502, "OVERPASS_EMPTY", "Overpass returned empty route features. Retry.")
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(geo, f, ensure_ascii=False)
    return JSONResponse(content=geo, headers={"Cache-Control": "public, max-age=86400"})

@app.get("/api/metro/osm-lines/meta")
def get_metro_osm_lines_meta():
    cache_path = _metro_cache_path()
    if not os.path.isfile(cache_path):
        return {"cached": False, "features": 0}
    try:
        with open(cache_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {"cached": True, "features": len(data.get("features") or [])}
    except Exception:
        return {"cached": True, "features": -1}


def serialize_stores_for_client(session: Session) -> list:
    stores = session.exec(select(Store)).all()
    review_count_rows = session.exec(
        select(Review.store_id, func.count(Review.id)).group_by(Review.store_id)
    ).all()
    review_count_map = {store_id: count for store_id, count in review_count_rows}
    result = []
    for s in stores:
        review_count = int(review_count_map.get(s.id, 0) or 0)
        wish = bool(getattr(s, "is_wishlist", False))
        has_review = review_count > 0
        if not has_review and not wish:
            continue
        if has_review and wish:
            type_status = "record_wish"
            default_color = "#e84393"
        elif has_review and not wish:
            type_status = "record_only"
            default_color = "#f1c40f"
        elif not has_review and wish:
            type_status = "wish_only"
            default_color = "#7f8fa6"
        else:
            type_status = "none"
        color = default_color
        result.append({
            "id": s.id,
            "name": s.name,
            "brand": s.brand,
            "address": s.address,
            "lat": s.lat,
            "lng": s.lng,
            "is_wishlist": wish,
            "type": type_status,
            "color": color,
            "reviews_count": review_count,
        })
    return result


@app.get("/api/stores")
def get_stores(session: Session = Depends(get_session)):
    result = serialize_stores_for_client(session)
    return JSONResponse(
        content=result,
        headers={"Cache-Control": "no-store, max-age=0", "Pragma": "no-cache"},
    )

@app.get("/api/feed")
def get_feed(session: Session = Depends(get_session)):
    rows = session.exec(
        select(Review, Store.name, Store.id)
        .join(Store, Review.store_id == Store.id)
        .order_by(Review.id.desc())
    ).all()
    return [
        {
            "id": review.id,
            "store_id": store_id,
            "store_name": store_name,
            "bean_name": review.bean_name,
            "content": review.content,
            "tags": _tags_to_list(getattr(review, "tags", "")),
            "front_card_path": review.front_card_path,
            "back_card_path": review.back_card_path
        }
        for review, store_name, store_id in rows
    ]

@app.post("/api/stores")
async def create_store(payload: StoreCreateRequest, session: Session = Depends(get_session), admin=Depends(require_admin)):
    new_store = Store(**payload.model_dump())
    session.add(new_store)
    session.commit()
    session.refresh(new_store)
    return new_store


@app.post("/api/stores/{store_id}/toggle-wishlist")
def toggle_wishlist(store_id: int, session: Session = Depends(get_session), admin=Depends(require_admin)):
    store = session.get(Store, store_id)
    if not store:
        return error_response(404, "STORE_NOT_FOUND", "Store not found")
    deleted = False
    if bool(getattr(store, "is_wishlist", False)):
        review_ids = session.exec(
            select(Review.id).where(Review.store_id == store_id)
        ).all()
        review_n = len(review_ids)
        if review_n == 0:
            session.delete(store)
            session.commit()
            deleted = True
        else:
            store.is_wishlist = False
            session.add(store)
            session.commit()
    else:
        store.is_wishlist = True
        session.add(store)
        session.commit()
    session.expire_all()
    fresh_list = serialize_stores_for_client(session)
    return JSONResponse(
        content={
            "status": "success",
            "deleted": deleted,
            "id": store_id,
            "stores": fresh_list,
        },
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/reviews")
def create_review(
    store_id: int = Form(...),
    bean_name: str = Form(...),
    content: str = Form(...),
    tags: Optional[str] = Form(""),
    front_image: UploadFile = File(None),
    back_image: UploadFile = File(None),
    session: Session = Depends(get_session),
    admin=Depends(require_admin)
):
    upload_dir = "static/uploads/bean_cards"
    os.makedirs(upload_dir, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d%H%M%S')

    try:
        front_path = None
        back_path = None
        if front_image and front_image.filename:
            front_path = _save_review_image(front_image, "front", upload_dir, timestamp)
        if back_image and back_image.filename:
            back_path = _save_review_image(back_image, "back", upload_dir, timestamp)
    except ValueError as e:
        return error_response(400, "INVALID_UPLOAD", str(e))

    color = extract_flavor_color(content)

    review = Review(
        store_id=store_id,
        bean_name=bean_name,
        content=content,
        tags=_parse_tags(tags),
        front_card_path=front_path,
        back_card_path=back_path
    )
    session.add(review)
    
    store = session.get(Store, store_id)
    if store:
        store.marker_color = color
        session.add(store)
        
    session.commit()
    return {"status": "success"}

@app.get("/api/stores/{store_id}/reviews")
def get_store_reviews(store_id: int, session: Session = Depends(get_session)):
    reviews = session.exec(select(Review).where(Review.store_id == store_id)).all()
    return [
        {
            "id": r.id,
            "store_id": r.store_id,
            "bean_name": r.bean_name,
            "content": r.content,
            "tags": _tags_to_list(getattr(r, "tags", "")),
            "front_card_path": r.front_card_path,
            "back_card_path": r.back_card_path,
        }
        for r in reviews
    ]


@app.patch("/api/reviews/{review_id}")
async def update_review(
    review_id: int,
    bean_name: Optional[str] = Form(None),
    content: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),
    front_image: UploadFile = File(None),
    back_image: UploadFile = File(None),
    session: Session = Depends(get_session),
    admin=Depends(require_admin),
):
    review = session.get(Review, review_id)
    if not review:
        return error_response(404, "REVIEW_NOT_FOUND", "Review not found")
    upload_dir = "static/uploads/bean_cards"
    os.makedirs(upload_dir, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
    try:
        if bean_name is not None and str(bean_name).strip():
            review.bean_name = str(bean_name).strip()
        if content is not None and str(content).strip():
            review.content = str(content).strip()
        if tags is not None:
            review.tags = _parse_tags(tags)
        if front_image is not None and getattr(front_image, "filename", None):
            _unlink_upload_path(review.front_card_path)
            review.front_card_path = _save_review_image(front_image, "front", upload_dir, timestamp)
        if back_image is not None and getattr(back_image, "filename", None):
            _unlink_upload_path(review.back_card_path)
            review.back_card_path = _save_review_image(back_image, "back", upload_dir, timestamp)
    except ValueError as e:
        return error_response(400, "INVALID_UPLOAD", str(e))
    session.add(review)
    session.commit()
    session.refresh(review)
    store = session.get(Store, review.store_id)
    if store:
        all_r = session.exec(select(Review).where(Review.store_id == store.id)).all()
        if all_r:
            last = max(all_r, key=lambda r: r.id or 0)
            store.marker_color = extract_flavor_color(last.content)
            session.add(store)
            session.commit()
    return {"status": "success"}


@app.delete("/api/reviews/{review_id}")
def delete_review(review_id: int, session: Session = Depends(get_session), admin=Depends(require_admin)):
    review = session.get(Review, review_id)
    if not review:
        return error_response(404, "REVIEW_NOT_FOUND", "Review not found")
    store_id = review.store_id
    _unlink_upload_path(review.front_card_path)
    _unlink_upload_path(review.back_card_path)
    session.delete(review)
    session.commit()

    store_deleted = False
    store = session.get(Store, store_id)
    if store:
        remaining = session.exec(select(Review).where(Review.store_id == store_id)).all()
        if len(remaining) == 0:
            if not store.is_wishlist:
                session.delete(store)
                store_deleted = True
            else:
                store.marker_color = "#7f8fa6"
                session.add(store)
        else:
            last = max(remaining, key=lambda r: r.id or 0)
            store.marker_color = extract_flavor_color(last.content)
            session.add(store)
        session.commit()
    return {"status": "success", "store_deleted": store_deleted}


@app.get("/api/wiki")
def get_wiki_posts(
    q: Optional[str] = None,
    category_id: Optional[int] = None,
    session: Session = Depends(get_session),
):
    posts = session.exec(select(WikiPost).order_by(WikiPost.created_at.desc())).all()
    if category_id is not None:
        posts = [p for p in posts if int(getattr(p, "category_id", 0) or 0) == int(category_id)]
    if q:
        needle = q.strip().lower()
        posts = [
            p for p in posts
            if needle in (p.title or "").lower()
            or needle in (p.content or "").lower()
            or needle in (p.category or "").lower()
        ]
    return posts

@app.post("/api/wiki")
async def create_wiki_post(payload: WikiPostCreateRequest, session: Session = Depends(get_session), admin=Depends(require_admin)):
    category_id = payload.category_id
    category_name = payload.category
    if category_id is not None:
        cat = session.get(WikiCategory, category_id)
        if cat:
            category_name = cat.name
    new_post = WikiPost(
        title=payload.title,
        content=payload.content,
        category=category_name or "미분류",
        category_id=category_id,
    )
    session.add(new_post)
    session.commit()
    session.refresh(new_post)
    return new_post


@app.patch("/api/wiki/{post_id}")
async def update_wiki_post(post_id: int, request: Request, session: Session = Depends(get_session), admin=Depends(require_admin)):
    post = session.get(WikiPost, post_id)
    if not post:
        return error_response(404, "WIKI_NOT_FOUND", "Wiki post not found")
    data = await request.json()
    if "title" in data and str(data["title"]).strip():
        post.title = str(data["title"]).strip()
    if "content" in data and str(data["content"]).strip():
        post.content = str(data["content"]).strip()
    if "category_id" in data and data["category_id"] is not None:
        cat = session.get(WikiCategory, int(data["category_id"]))
        if cat:
            post.category_id = cat.id
            post.category = cat.name
    elif "category" in data and str(data["category"]).strip():
        post.category = str(data["category"]).strip()
    session.add(post)
    session.commit()
    session.refresh(post)
    return post


@app.delete("/api/wiki/{post_id}")
def delete_wiki_post(post_id: int, session: Session = Depends(get_session), admin=Depends(require_admin)):
    post = session.get(WikiPost, post_id)
    if not post:
        return error_response(404, "WIKI_NOT_FOUND", "Wiki post not found")
    session.delete(post)
    session.commit()
    return {"status": "success"}


@app.get("/api/wiki/categories")
def get_wiki_categories(session: Session = Depends(get_session)):
    rows = session.exec(select(WikiCategory).order_by(WikiCategory.created_at.asc())).all()
    return rows


@app.post("/api/wiki/categories")
async def create_wiki_category(request: Request, session: Session = Depends(get_session), admin=Depends(require_admin)):
    data = await request.json()
    name = str(data.get("name", "")).strip()
    if not name:
        return error_response(400, "CATEGORY_NAME_REQUIRED", "Category name is required")
    parent_id = data.get("parent_id")
    row = WikiCategory(name=name, parent_id=int(parent_id) if parent_id is not None else None)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@app.patch("/api/wiki/categories/{category_id}")
async def update_wiki_category(category_id: int, request: Request, session: Session = Depends(get_session), admin=Depends(require_admin)):
    row = session.get(WikiCategory, category_id)
    if not row:
        return error_response(404, "CATEGORY_NOT_FOUND", "Category not found")
    data = await request.json()
    if "name" in data and str(data["name"]).strip():
        row.name = str(data["name"]).strip()
        # keep legacy category text in sync
        posts = session.exec(select(WikiPost).where(WikiPost.category_id == category_id)).all()
        for p in posts:
            p.category = row.name
            session.add(p)
    if "parent_id" in data:
        row.parent_id = int(data["parent_id"]) if data["parent_id"] is not None else None
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@app.delete("/api/wiki/categories/{category_id}")
def delete_wiki_category(category_id: int, session: Session = Depends(get_session), admin=Depends(require_admin)):
    row = session.get(WikiCategory, category_id)
    if not row:
        return error_response(404, "CATEGORY_NOT_FOUND", "Category not found")
    children = session.exec(select(WikiCategory).where(WikiCategory.parent_id == category_id)).all()
    if children:
        return error_response(400, "CATEGORY_HAS_CHILDREN", "Delete child categories first")
    posts = session.exec(select(WikiPost).where(WikiPost.category_id == category_id)).all()
    for p in posts:
        p.category_id = None
        p.category = "미분류"
        session.add(p)
    session.delete(row)
    session.commit()
    return {"status": "success"}


# ── HomeCafe helpers ──────────────────────────────────────────────────

def _get_store_name_for_review(review_id: Optional[int], session: Session) -> Optional[str]:
    if not review_id:
        return None
    review = session.get(Review, review_id)
    if not review:
        return None
    store = session.get(Store, review.store_id)
    return store.name if store else None


def _serialize_pour_steps(version_id: int, session: Session) -> list:
    steps = session.exec(
        select(HomeCafePourStep)
        .where(HomeCafePourStep.version_id == version_id)
        .order_by(HomeCafePourStep.step_order)
    ).all()
    return [
        {
            "id": s.id,
            "step_order": s.step_order,
            "label": s.label,
            "water_g": s.water_g,
            "duration_s": s.duration_s,
            "memo": s.memo,
        }
        for s in steps
    ]


def _serialize_version_full(version: HomeCafeRecipeVersion, session: Session) -> dict:
    return {
        "id": version.id,
        "version_number": version.version_number,
        "water_temp_c": version.water_temp_c,
        "dose_g": version.dose_g,
        "total_water_g": version.total_water_g,
        "ratio_n": version.ratio_n,
        "extraction_mode": version.extraction_mode,
        "grinder_name": version.grinder_name,
        "grind_clicks": version.grind_clicks,
        "grind_note": version.grind_note,
        "dripper": version.dripper,
        "filter_type": version.filter_type,
        "water_type": version.water_type,
        "result_memo": version.result_memo,
        "result_rating": version.result_rating,
        "change_note": version.change_note,
        "created_at": version.created_at.isoformat() if version.created_at else None,
        "pour_steps": _serialize_pour_steps(version.id, session),
    }


def _serialize_recipe_with_version(recipe: HomeCafeRecipe, session: Session) -> dict:
    all_versions = session.exec(
        select(HomeCafeRecipeVersion).where(HomeCafeRecipeVersion.recipe_id == recipe.id)
    ).all()
    version_count = len(all_versions)

    current_version = None
    if recipe.current_version_id:
        cv = session.get(HomeCafeRecipeVersion, recipe.current_version_id)
        if cv:
            current_version = _serialize_version_full(cv, session)

    store_name = _get_store_name_for_review(recipe.review_id, session)

    return {
        "id": recipe.id,
        "bean_name": recipe.bean_name,
        "review_id": recipe.review_id,
        "store_name": store_name,
        "roast_level": recipe.roast_level,
        "brew_type": recipe.brew_type,
        "current_version_id": recipe.current_version_id,
        "version_count": version_count,
        "current_version": current_version,
        "created_at": recipe.created_at.isoformat() if recipe.created_at else None,
        "updated_at": recipe.updated_at.isoformat() if recipe.updated_at else None,
    }


def _create_version_and_steps(
    recipe_id: int,
    version_number: int,
    payload: HomeCafeRecipeCreateRequest,
    fallback_dripper: str,
    session: Session,
) -> HomeCafeRecipeVersion:
    version = HomeCafeRecipeVersion(
        recipe_id=recipe_id,
        version_number=version_number,
        water_temp_c=payload.water_temp_c,
        dose_g=payload.dose_g,
        total_water_g=payload.total_water_g,
        ratio_n=payload.ratio_n,
        extraction_mode=payload.extraction_mode or "dose",
        grinder_name=payload.grinder_name,
        grind_clicks=payload.grind_clicks,
        grind_note=payload.grind_note,
        dripper=payload.dripper or fallback_dripper,
        filter_type=payload.filter_type,
        water_type=payload.water_type,
        result_memo=payload.result_memo,
        result_rating=payload.result_rating,
        change_note=payload.change_note,
    )
    session.add(version)
    session.flush()
    for step_in in (payload.pour_steps or []):
        step = HomeCafePourStep(
            version_id=version.id,
            step_order=step_in.step_order,
            label=step_in.label,
            water_g=step_in.water_g,
            duration_s=step_in.duration_s,
            memo=step_in.memo,
        )
        session.add(step)
    return version


# ── HomeCafe endpoints ────────────────────────────────────────────────

@app.get("/api/homecafe/bean-options")
def list_bean_options(session: Session = Depends(get_session)):
    rows = session.exec(
        select(Review, Store.name)
        .join(Store, Review.store_id == Store.id)
        .order_by(Store.name, Review.bean_name)
    ).all()
    return [
        {"review_id": review.id, "store_name": store_name, "bean_name": review.bean_name}
        for review, store_name in rows
    ]


@app.get("/api/homecafe/recipes")
def list_homecafe_recipes(session: Session = Depends(get_session)):
    recipes = session.exec(
        select(HomeCafeRecipe).order_by(HomeCafeRecipe.updated_at.desc())
    ).all()
    return [_serialize_recipe_with_version(r, session) for r in recipes]


@app.post("/api/homecafe/recipes")
def create_homecafe_recipe(
    payload: HomeCafeRecipeCreateRequest,
    session: Session = Depends(get_session),
    admin=Depends(require_admin),
):
    recipe = HomeCafeRecipe(
        bean_name=payload.bean_name,
        review_id=payload.review_id,
        roast_level=payload.roast_level,
        brew_type=payload.brew_type,
    )
    session.add(recipe)
    session.flush()

    version = _create_version_and_steps(
        recipe_id=recipe.id,
        version_number=1,
        payload=payload,
        fallback_dripper=payload.dripper,
        session=session,
    )

    recipe.current_version_id = version.id
    session.add(recipe)
    session.commit()
    session.refresh(recipe)
    return _serialize_recipe_with_version(recipe, session)


@app.get("/api/homecafe/recipes/{recipe_id}")
def get_homecafe_recipe(recipe_id: int, session: Session = Depends(get_session)):
    recipe = session.get(HomeCafeRecipe, recipe_id)
    if not recipe:
        return error_response(404, "RECIPE_NOT_FOUND", "레시피를 찾을 수 없습니다.")
    return _serialize_recipe_with_version(recipe, session)


@app.patch("/api/homecafe/recipes/{recipe_id}")
def update_homecafe_recipe(
    recipe_id: int,
    payload: HomeCafeRecipeUpdateRequest,
    session: Session = Depends(get_session),
    admin=Depends(require_admin),
):
    recipe = session.get(HomeCafeRecipe, recipe_id)
    if not recipe:
        return error_response(404, "RECIPE_NOT_FOUND", "레시피를 찾을 수 없습니다.")

    if payload.result_only:
        if not recipe.current_version_id:
            return error_response(400, "NO_CURRENT_VERSION", "현재 버전이 없습니다.")
        cv = session.get(HomeCafeRecipeVersion, recipe.current_version_id)
        if not cv:
            return error_response(404, "VERSION_NOT_FOUND", "현재 버전을 찾을 수 없습니다.")
        if payload.result_memo is not None:
            cv.result_memo = payload.result_memo
        if payload.result_rating is not None:
            cv.result_rating = payload.result_rating
        session.add(cv)
        session.commit()
        return {"status": "success"}

    existing_versions = session.exec(
        select(HomeCafeRecipeVersion).where(HomeCafeRecipeVersion.recipe_id == recipe_id)
    ).all()
    next_version_number = max((v.version_number for v in existing_versions), default=0) + 1

    fallback_dripper = ""
    if recipe.current_version_id:
        cv = session.get(HomeCafeRecipeVersion, recipe.current_version_id)
        if cv:
            fallback_dripper = cv.dripper

    version = _create_version_and_steps(
        recipe_id=recipe_id,
        version_number=next_version_number,
        payload=payload,
        fallback_dripper=fallback_dripper,
        session=session,
    )

    if payload.bean_name is not None:
        recipe.bean_name = payload.bean_name
    if payload.review_id is not None:
        recipe.review_id = payload.review_id
    if payload.roast_level is not None:
        recipe.roast_level = payload.roast_level
    if payload.brew_type is not None:
        recipe.brew_type = payload.brew_type
    recipe.current_version_id = version.id
    recipe.updated_at = datetime.now(timezone.utc)
    session.add(recipe)
    session.commit()
    session.refresh(recipe)
    return _serialize_recipe_with_version(recipe, session)


@app.delete("/api/homecafe/recipes/{recipe_id}")
def delete_homecafe_recipe(
    recipe_id: int,
    session: Session = Depends(get_session),
    admin=Depends(require_admin),
):
    recipe = session.get(HomeCafeRecipe, recipe_id)
    if not recipe:
        return error_response(404, "RECIPE_NOT_FOUND", "레시피를 찾을 수 없습니다.")

    versions = session.exec(
        select(HomeCafeRecipeVersion).where(HomeCafeRecipeVersion.recipe_id == recipe_id)
    ).all()
    for v in versions:
        steps = session.exec(
            select(HomeCafePourStep).where(HomeCafePourStep.version_id == v.id)
        ).all()
        for s in steps:
            session.delete(s)
        session.delete(v)
    session.delete(recipe)
    session.commit()
    return {"status": "success"}


@app.get("/api/homecafe/recipes/{recipe_id}/versions")
def list_homecafe_versions(recipe_id: int, session: Session = Depends(get_session)):
    recipe = session.get(HomeCafeRecipe, recipe_id)
    if not recipe:
        return error_response(404, "RECIPE_NOT_FOUND", "레시피를 찾을 수 없습니다.")
    versions = session.exec(
        select(HomeCafeRecipeVersion)
        .where(HomeCafeRecipeVersion.recipe_id == recipe_id)
        .order_by(HomeCafeRecipeVersion.version_number.desc())
    ).all()
    return [
        {
            "id": v.id,
            "version_number": v.version_number,
            "created_at": v.created_at.isoformat() if v.created_at else None,
            "change_note": v.change_note,
            "result_rating": v.result_rating,
            "result_memo": v.result_memo,
            "grind_clicks": v.grind_clicks,
            "dose_g": v.dose_g,
            "total_water_g": v.total_water_g,
            "water_temp_c": v.water_temp_c,
            "dripper": v.dripper,
            "is_current": v.id == recipe.current_version_id,
        }
        for v in versions
    ]


@app.get("/api/homecafe/recipes/{recipe_id}/versions/{version_id}")
def get_homecafe_version(
    recipe_id: int, version_id: int, session: Session = Depends(get_session)
):
    version = session.get(HomeCafeRecipeVersion, version_id)
    if not version or version.recipe_id != recipe_id:
        return error_response(404, "VERSION_NOT_FOUND", "버전을 찾을 수 없습니다.")
    return _serialize_version_full(version, session)


@app.delete("/api/homecafe/recipes/{recipe_id}/versions/{version_id}")
def delete_homecafe_version(
    recipe_id: int,
    version_id: int,
    session: Session = Depends(get_session),
    admin=Depends(require_admin),
):
    recipe = session.get(HomeCafeRecipe, recipe_id)
    if not recipe:
        return error_response(404, "RECIPE_NOT_FOUND", "레시피를 찾을 수 없습니다.")
    version = session.get(HomeCafeRecipeVersion, version_id)
    if not version or version.recipe_id != recipe_id:
        return error_response(404, "VERSION_NOT_FOUND", "버전을 찾을 수 없습니다.")

    all_versions = session.exec(
        select(HomeCafeRecipeVersion).where(HomeCafeRecipeVersion.recipe_id == recipe_id)
    ).all()
    if len(all_versions) <= 1:
        return error_response(
            400, "LAST_VERSION", "마지막 버전은 삭제할 수 없습니다. 레시피 전체를 삭제하세요."
        )
    if recipe.current_version_id == version_id:
        return error_response(
            400, "CURRENT_VERSION", "현재 버전은 삭제할 수 없습니다. 먼저 다른 버전으로 복원하세요."
        )

    steps = session.exec(
        select(HomeCafePourStep).where(HomeCafePourStep.version_id == version_id)
    ).all()
    for s in steps:
        session.delete(s)
    session.delete(version)
    session.commit()
    return {"status": "success", "remaining_versions": len(all_versions) - 1}


# ── Equipment endpoints ────────────────────────────────────────────────

@app.get("/api/homecafe/equipment")
def list_equipment(equipment_type: Optional[str] = None, session: Session = Depends(get_session)):
    query = select(HomeCafeEquipment).order_by(HomeCafeEquipment.name)
    if equipment_type:
        query = query.where(HomeCafeEquipment.equipment_type == equipment_type)
    items = session.exec(query).all()
    return [
        {"id": e.id, "equipment_type": e.equipment_type, "name": e.name, "max_clicks": e.max_clicks}
        for e in items
    ]


@app.post("/api/homecafe/equipment")
def create_equipment(
    body: EquipmentCreateRequest,
    session: Session = Depends(get_session),
    admin=Depends(require_admin),
):
    existing = session.exec(
        select(HomeCafeEquipment).where(
            HomeCafeEquipment.equipment_type == body.equipment_type,
            HomeCafeEquipment.name == body.name,
        )
    ).first()
    if existing:
        return {"id": existing.id, "equipment_type": existing.equipment_type, "name": existing.name, "max_clicks": existing.max_clicks}
    eq = HomeCafeEquipment(equipment_type=body.equipment_type, name=body.name, max_clicks=body.max_clicks)
    session.add(eq)
    session.commit()
    session.refresh(eq)
    return {"id": eq.id, "equipment_type": eq.equipment_type, "name": eq.name, "max_clicks": eq.max_clicks}


@app.delete("/api/homecafe/equipment/{eq_id}")
def delete_equipment(
    eq_id: int,
    session: Session = Depends(get_session),
    admin=Depends(require_admin),
):
    eq = session.get(HomeCafeEquipment, eq_id)
    if not eq:
        return error_response(404, "NOT_FOUND", "장비를 찾을 수 없습니다.")
    session.delete(eq)
    session.commit()
    return {"status": "success"}


# ── Brew log helpers & endpoints ──────────────────────────────────────

def _serialize_brew_log(log: HomeCafeBrewLog, session: Session) -> dict:
    steps = session.exec(
        select(HomeCafeBrewLogStep)
        .where(HomeCafeBrewLogStep.log_id == log.id)
        .order_by(HomeCafeBrewLogStep.step_order)
    ).all()
    return {
        "id": log.id,
        "recipe_id": log.recipe_id,
        "version_id": log.version_id,
        "taste_note": log.taste_note,
        "overall_rating": log.overall_rating,
        "brewed_at": log.brewed_at.isoformat() if log.brewed_at else None,
        "steps": [
            {
                "id": s.id,
                "step_order": s.step_order,
                "label": s.label,
                "actual_water_g": s.actual_water_g,
                "actual_duration_s": s.actual_duration_s,
            }
            for s in steps
        ],
    }


@app.get("/api/homecafe/recipes/{recipe_id}/logs")
def list_brew_logs(recipe_id: int, session: Session = Depends(get_session)):
    recipe = session.get(HomeCafeRecipe, recipe_id)
    if not recipe:
        return error_response(404, "RECIPE_NOT_FOUND", "레시피를 찾을 수 없습니다.")
    logs = session.exec(
        select(HomeCafeBrewLog)
        .where(HomeCafeBrewLog.recipe_id == recipe_id)
        .order_by(HomeCafeBrewLog.brewed_at.desc())
    ).all()
    return [_serialize_brew_log(log, session) for log in logs]


@app.post("/api/homecafe/recipes/{recipe_id}/logs")
def create_brew_log(
    recipe_id: int,
    body: BrewLogCreateRequest,
    session: Session = Depends(get_session),
    admin=Depends(require_admin),
):
    recipe = session.get(HomeCafeRecipe, recipe_id)
    if not recipe:
        return error_response(404, "RECIPE_NOT_FOUND", "레시피를 찾을 수 없습니다.")
    version = session.get(HomeCafeRecipeVersion, body.version_id)
    if not version or version.recipe_id != recipe_id:
        return error_response(404, "VERSION_NOT_FOUND", "버전을 찾을 수 없습니다.")
    log = HomeCafeBrewLog(
        recipe_id=recipe_id,
        version_id=body.version_id,
        taste_note=body.taste_note,
        overall_rating=body.overall_rating,
    )
    session.add(log)
    session.flush()
    for step_in in body.steps:
        session.add(HomeCafeBrewLogStep(
            log_id=log.id,
            step_order=step_in.step_order,
            label=step_in.label,
            actual_water_g=step_in.actual_water_g,
            actual_duration_s=step_in.actual_duration_s,
        ))
    session.commit()
    session.refresh(log)
    return _serialize_brew_log(log, session)


@app.delete("/api/homecafe/recipes/{recipe_id}/logs/{log_id}")
def delete_brew_log(
    recipe_id: int,
    log_id: int,
    session: Session = Depends(get_session),
    admin=Depends(require_admin),
):
    log = session.get(HomeCafeBrewLog, log_id)
    if not log or log.recipe_id != recipe_id:
        return error_response(404, "NOT_FOUND", "추출 기록을 찾을 수 없습니다.")
    steps = session.exec(
        select(HomeCafeBrewLogStep).where(HomeCafeBrewLogStep.log_id == log_id)
    ).all()
    for s in steps:
        session.delete(s)
    session.delete(log)
    session.commit()
    return {"status": "success"}
