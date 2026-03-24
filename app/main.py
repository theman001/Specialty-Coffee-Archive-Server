from fastapi import FastAPI, Depends, Request, Form, UploadFile, File 
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlmodel import Session, select
from sqlalchemy import func
import os
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

from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=["*"])

from .auth import router as auth_router
app.include_router(auth_router)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

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
        }
    )

@app.get("/api/search")
def search_local(query: str):
    return search_naver_local(query)

@app.get("/api/stores")
def get_stores(session: Session = Depends(get_session)):
    stores = session.exec(select(Store)).all()
    review_count_rows = session.exec(
        select(Review.store_id, func.count(Review.id)).group_by(Review.store_id)
    ).all()
    review_count_map = {store_id: count for store_id, count in review_count_rows}
    result = []
    for s in stores:
        review_count = review_count_map.get(s.id, 0)
        has_review = review_count > 0
        
        # 3-Type Logic
        if has_review and s.is_wishlist:
            type_status = "record_wish"  # 기록+위시 (핑크)
            default_color = "#e84393"
        elif has_review and not s.is_wishlist:
            type_status = "record_only"  # 기록 전용 (노란색)
            default_color = "#f1c40f"
        elif not has_review and s.is_wishlist:
            type_status = "wish_only"    # 위시 전용 (회색)
            default_color = "#7f8fa6"
        else:
            type_status = "none"
        # Use Type-specific color for the map pin (strictly follow 3-Type Logic)
        color = default_color
        
        result.append({
            "id": s.id,
            "name": s.name,
            "brand": s.brand,
            "address": s.address,
            "lat": s.lat,
            "lng": s.lng,
            "is_wishlist": s.is_wishlist,
            "type": type_status,
            "color": color,
            "reviews_count": review_count
        })
    return JSONResponse(content=result)

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
        return JSONResponse(status_code=404, content={"message": "Store not found"})
    store.is_wishlist = not store.is_wishlist
    session.add(store)
    session.commit()
    session.refresh(store)
    return {"status": "success", "is_wishlist": store.is_wishlist}

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
    
    front_path, back_path = None, None
    timestamp = datetime.now().strftime('%Y%m%d%H%M%S')

    def save_image(upload: UploadFile, suffix: str):
        if not upload or not upload.filename:
            return None
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
        return file_path
    
    try:
        front_path = save_image(front_image, "front")
        back_path = save_image(back_image, "back")
    except ValueError as e:
        return JSONResponse(status_code=400, content={"message": str(e)})
            
    color = extract_flavor_color(content)
    
    review = Review(
        store_id=store_id,
        bean_name=bean_name,
        content=content,
        front_card_path=("/"+front_path) if front_path else None,
        back_card_path=("/"+back_path) if back_path else None
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
