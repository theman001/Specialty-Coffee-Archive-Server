from fastapi import FastAPI, Depends, Request, Form, UploadFile, File, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from typing import Optional
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlmodel import Session, select
from sqlalchemy import func
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

from datetime import datetime

from .database import create_db_and_tables, get_session, Store, Review, WikiPost
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
            "front_card_path": review.front_card_path,
            "back_card_path": review.back_card_path
        }
        for review, store_name, store_id in rows
    ]

@app.post("/api/stores")
async def create_store(request: Request, session: Session = Depends(get_session), admin=Depends(require_admin)):
    data = await request.json()
    new_store = Store(**data)
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
    return reviews


@app.patch("/api/reviews/{review_id}")
async def update_review(
    review_id: int,
    bean_name: Optional[str] = Form(None),
    content: Optional[str] = Form(None),
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
def get_wiki_posts(session: Session = Depends(get_session)):
    return session.exec(select(WikiPost).order_by(WikiPost.created_at.desc())).all()

@app.post("/api/wiki")
async def create_wiki_post(request: Request, session: Session = Depends(get_session), admin=Depends(require_admin)):
    data = await request.json()
    new_post = WikiPost(**data)
    session.add(new_post)
    session.commit()
    session.refresh(new_post)
    return new_post
