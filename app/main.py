from fastapi import FastAPI, Depends, Request, Form, UploadFile, File 
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlmodel import Session, select
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
    result = []
    for s in stores:
        reviews = session.exec(select(Review).where(Review.store_id == s.id)).all()
        has_review = len(reviews) > 0
        
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
            default_color = "#dcdde1"
            
        color = s.marker_color if s.marker_color else default_color
        
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
            "reviews_count": len(reviews)
        })
    return JSONResponse(content=result)

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
    
    if front_image and front_image.filename:
        front_path = f"{upload_dir}/{timestamp}_front_{front_image.filename}"
        with open(front_path, "wb") as buffer:
            buffer.write(front_image.file.read())
            
    if back_image and back_image.filename:
        back_path = f"{upload_dir}/{timestamp}_back_{back_image.filename}"
        with open(back_path, "wb") as buffer:
            buffer.write(back_image.file.read())
            
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
