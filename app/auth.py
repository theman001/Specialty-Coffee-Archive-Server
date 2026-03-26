import os
import jwt
import uuid
from datetime import datetime, timedelta
from fastapi import Request, HTTPException, Response, APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlmodel import Session, select
import pyotp
from .database import get_session, AllowedDevice, AdminSecret

router = APIRouter(prefix="/api/auth")

def auth_error(status_code: int, code: str, message: str):
    raise HTTPException(status_code=status_code, detail={"code": code, "message": message})

# Ensure data directory exists
DATA_DIR = "data"
os.makedirs(DATA_DIR, exist_ok=True)
SECRET_FILE = os.path.join(DATA_DIR, "secret.key")

def get_jwt_secret():
    if os.path.exists(SECRET_FILE):
        with open(SECRET_FILE, "r") as f:
            return f.read().strip()
    else:
        new_secret = os.urandom(32).hex()
        with open(SECRET_FILE, "w") as f:
            f.write(new_secret)
        return new_secret

JWT_SECRET = get_jwt_secret()
ALGORITHM = "HS256"
COOKIE_NAME = "admin_token"

def extract_client_ip(request: Request) -> str:
    # Check Cloudflare first
    cf_ip = request.headers.get("CF-Connecting-IP")
    if cf_ip: return cf_ip
    
    # Check standard proxy header
    x_forwarded = request.headers.get("X-Forwarded-For")
    if x_forwarded: return x_forwarded
    
    # Fallback to direct client host
    if request.client and request.client.host:
        return request.client.host
        
    return ""


def is_localhost_request(request: Request) -> bool:
    """
    Auto-login via whitelist is allowed only for localhost access.
    Accepts: localhost / 127.0.0.1 / ::1
    """
    host_header = (request.headers.get("host") or "").split(":")[0].strip().lower()
    localhost_set = {"localhost", "127.0.0.1", "::1"}
    # If Host header exists, trust it first.
    if host_header:
        return host_header in localhost_set

    host = ""
    try:
        host = (request.url.hostname or "").strip().lower()
    except Exception:
        host = ""
    if host in localhost_set:
        return True

    client_ip = (extract_client_ip(request) or "").split(",")[0].strip().lower()
    return client_ip in localhost_set

def create_admin_token() -> str:
    # Long lived token for permanent device login (e.g., 10 years)
    expire = datetime.utcnow() + timedelta(days=3650)
    to_encode = {"role": "admin", "exp": expire}
    return jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)

def check_is_whitelisted(request: Request, session: Session) -> bool:
    """True only if device_id is registered in AllowedDevice (no LAN/IP auto-trust)."""
    device_id = request.headers.get("X-Device-Id") or request.cookies.get("device_id")
    if not device_id:
        return False
    allowed = session.exec(select(AllowedDevice).where(AllowedDevice.device_id == device_id)).first()
    return bool(allowed)

def get_current_user(request: Request) -> dict:
    client_ip = extract_client_ip(request)
    # JWT Session Token is now the only source of authority for 'admin' role
    token = request.cookies.get(COOKIE_NAME)
    if token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
            if payload.get("role") == "admin":
                return {"role": "admin", "method": "cookie", "ip": client_ip}
        except jwt.PyJWTError:
            pass 
            
    return {"role": "guest", "method": "none", "ip": client_ip}

def require_admin(user: dict = Depends(get_current_user)):
    if user["role"] != "admin":
        auth_error(403, "ADMIN_REQUIRED", "Admin permissions required.")
    return user

ORIGIN = os.getenv("RP_ORIGIN", "http://localhost:8000")
COOKIE_SECURE = ORIGIN.startswith("https://")

OTP_ATTEMPT_WINDOW_SECONDS = 300
OTP_MAX_ATTEMPTS = 5
OTP_ATTEMPTS = {}
LOGIN_ATTEMPT_WINDOW_SECONDS = 300
LOGIN_MAX_ATTEMPTS = 10
LOGIN_ATTEMPTS = {}

def _get_otp_attempt_key(request: Request) -> str:
    client_ip = extract_client_ip(request) or "unknown"
    device_id = request.headers.get("X-Device-Id") or request.cookies.get("device_id") or "no-device"
    return f"{client_ip}:{device_id}"

def _is_otp_limited(request: Request) -> bool:
    key = _get_otp_attempt_key(request)
    now = datetime.utcnow()
    entry = OTP_ATTEMPTS.get(key)
    if not entry:
        return False
    locked_until = entry.get("locked_until")
    if locked_until and now < locked_until:
        return True
    if locked_until and now >= locked_until:
        OTP_ATTEMPTS.pop(key, None)
        return False
    if now > entry["window_expires_at"]:
        OTP_ATTEMPTS.pop(key, None)
        return False
    return False

def _record_otp_failure(request: Request):
    key = _get_otp_attempt_key(request)
    now = datetime.utcnow()
    entry = OTP_ATTEMPTS.get(key)
    if not entry or now > entry["window_expires_at"] or (entry.get("locked_until") and now >= entry["locked_until"]):
        OTP_ATTEMPTS[key] = {
            "count": 1,
            "window_expires_at": now + timedelta(seconds=OTP_ATTEMPT_WINDOW_SECONDS),
            "locked_until": None,
        }
        return
    entry["count"] += 1
    if entry["count"] >= OTP_MAX_ATTEMPTS:
        entry["locked_until"] = now + timedelta(seconds=OTP_ATTEMPT_WINDOW_SECONDS)
    OTP_ATTEMPTS[key] = entry

def _clear_otp_failures(request: Request):
    OTP_ATTEMPTS.pop(_get_otp_attempt_key(request), None)

def _get_login_attempt_key(request: Request) -> str:
    client_ip = extract_client_ip(request) or "unknown"
    device_id = request.headers.get("X-Device-Id") or request.cookies.get("device_id") or "no-device"
    return f"{client_ip}:{device_id}"

def _is_login_limited(request: Request) -> bool:
    key = _get_login_attempt_key(request)
    now = datetime.utcnow()
    entry = LOGIN_ATTEMPTS.get(key)
    if not entry:
        return False
    locked_until = entry.get("locked_until")
    if locked_until and now < locked_until:
        return True
    if locked_until and now >= locked_until:
        LOGIN_ATTEMPTS.pop(key, None)
        return False
    if now > entry["window_expires_at"]:
        LOGIN_ATTEMPTS.pop(key, None)
        return False
    return False

def _record_login_failure(request: Request):
    key = _get_login_attempt_key(request)
    now = datetime.utcnow()
    entry = LOGIN_ATTEMPTS.get(key)
    if not entry or now > entry["window_expires_at"] or (entry.get("locked_until") and now >= entry["locked_until"]):
        LOGIN_ATTEMPTS[key] = {
            "count": 1,
            "window_expires_at": now + timedelta(seconds=LOGIN_ATTEMPT_WINDOW_SECONDS),
            "locked_until": None,
        }
        return
    entry["count"] += 1
    if entry["count"] >= LOGIN_MAX_ATTEMPTS:
        entry["locked_until"] = now + timedelta(seconds=LOGIN_ATTEMPT_WINDOW_SECONDS)
    LOGIN_ATTEMPTS[key] = entry

def _clear_login_failures(request: Request):
    LOGIN_ATTEMPTS.pop(_get_login_attempt_key(request), None)

def get_cookie_kwargs():
    return {
        "httponly": True,
        "max_age": 315360000,
        "path": "/",
        "samesite": "lax",
        "secure": COOKIE_SECURE,
    }

# --- TOTP (OTP) & Device Registration Endpoints ---

@router.get("/otp/generate")
def generate_otp_uri(admin: dict = Depends(require_admin)):
    # Create temporary secret (not saved yet)
    secret = pyotp.random_base32()
    uri = pyotp.totp.TOTP(secret).provisioning_uri(name="admin", issuer_name="Specialty Coffee Archive")
    return {"secret": secret, "uri": uri}

@router.post("/otp/verify")
async def verify_and_save_otp(request: Request, session: Session = Depends(get_session), admin: dict = Depends(require_admin)):
    data = await request.json()
    secret = data.get("secret")
    code = data.get("code")
    if not secret or not code:
        auth_error(400, "OTP_SETUP_INPUT_MISSING", "Missing secret or code")
    
    totp = pyotp.TOTP(secret)
    if totp.verify(code):
        # Save to DB (Primary secret)
        # Clear old ones
        old = session.exec(select(AdminSecret)).all()
        for s in old: session.delete(s)
        
        new_secret = AdminSecret(totp_secret=secret)
        session.add(new_secret)
        session.commit()
        return {"status": "success"}
    else:
        auth_error(400, "OTP_SETUP_INVALID_CODE", "Invalid OTP code")

@router.post("/login/otp")
async def login_via_otp(request: Request, session: Session = Depends(get_session)):
    if _is_otp_limited(request):
        auth_error(429, "AUTH_OTP_LOCKED", f"Too many OTP attempts. Try again in {OTP_ATTEMPT_WINDOW_SECONDS // 60} minutes.")

    data = await request.json()
    code = data.get("code")
    
    admin_sec = session.exec(select(AdminSecret)).first()
    if not admin_sec:
        auth_error(400, "OTP_SETUP_REQUIRED", "OTP가 서버에 설정되지 않았습니다. 등록된 기기로 관리자 로그인 후 환경 설정에서 OTP를 등록하세요.")
    
    totp = pyotp.TOTP(admin_sec.totp_secret)
    if totp.verify(code):
        _clear_otp_failures(request)
        token = create_admin_token()
        response = JSONResponse(content={"status": "success"})
        response.set_cookie(key=COOKIE_NAME, value=token, **get_cookie_kwargs())
        return response
    else:
        _record_otp_failure(request)
        auth_error(400, "OTP_INVALID_CODE", "Invalid code.")

@router.post("/logout")
async def logout():
    # Return explicit response with cookie clearing
    response = JSONResponse(content={"status": "success"})
    response.delete_cookie(key=COOKIE_NAME, path="/", samesite="lax", secure=COOKIE_SECURE)
    return response

@router.post("/login/whitelist")
async def login_whitelist(request: Request, response: Response, session: Session = Depends(get_session)):
    if not is_localhost_request(request):
        auth_error(403, "LOCALHOST_ONLY", "화이트리스트 자동 로그인은 localhost 접근에서만 허용됩니다.")

    if _is_login_limited(request):
        auth_error(429, "AUTH_WHITELIST_LOCKED", f"Too many login attempts. Try again in {LOGIN_ATTEMPT_WINDOW_SECONDS // 60} minutes.")

    if check_is_whitelisted(request, session):
        # Create persistent JWT token
        token = create_admin_token()
        response.set_cookie(key=COOKIE_NAME, value=token, **get_cookie_kwargs())
        _clear_login_failures(request)
        return {"status": "success"}
    _record_login_failure(request)
    auth_error(403, "WHITELIST_NOT_MET", "등록된 기기(화이트리스트)가 아닙니다.")

@router.post("/device/register")
async def register_device(request: Request, session: Session = Depends(get_session), admin: dict = Depends(require_admin)):
    data = await request.json()
    dev_id = data.get("device_id")
    desc = data.get("description", "Registered Device")
    if not dev_id:
        auth_error(400, "DEVICE_ID_MISSING", "Missing DeviceID")
    
    # Check if already exists
    exists = session.exec(select(AllowedDevice).where(AllowedDevice.device_id == dev_id)).first()
    if exists:
        exists.description = desc
        session.add(exists)
    else:
        new_dev = AllowedDevice(device_id=dev_id, description=desc)
        session.add(new_dev)
    session.commit()
    
    response = JSONResponse(content={"status": "success"})
    # Also set the cookie for the user immediately if they are on Home network
    response.set_cookie(key="device_id", value=dev_id, **get_cookie_kwargs())
    return response


@router.post("/device/bootstrap-localhost")
async def bootstrap_localhost_device(request: Request, session: Session = Depends(get_session)):
    """
    Localhost-only emergency bootstrap:
    - Ensure device_id cookie exists
    - Upsert that device into whitelist
    - Issue admin token for immediate local recovery
    """
    if not is_localhost_request(request):
        auth_error(403, "LOCALHOST_ONLY", "localhost 접근에서만 허용됩니다.")

    device_id = request.cookies.get("device_id") or request.headers.get("X-Device-Id")
    if not device_id:
        device_id = str(uuid.uuid4())

    exists = session.exec(select(AllowedDevice).where(AllowedDevice.device_id == device_id)).first()
    if exists:
        exists.description = exists.description or "Temporary Localhost Bootstrap"
        session.add(exists)
    else:
        session.add(AllowedDevice(device_id=device_id, description="Temporary Localhost Bootstrap"))
    session.commit()

    token = create_admin_token()
    response = JSONResponse(content={"status": "success", "device_id": device_id, "bootstrapped": True})
    response.set_cookie(key="device_id", value=device_id, **get_cookie_kwargs())
    response.set_cookie(key=COOKIE_NAME, value=token, **get_cookie_kwargs())
    return response

@router.get("/device/list")
def list_devices(session: Session = Depends(get_session), admin: dict = Depends(require_admin)):
    devices = session.exec(select(AllowedDevice).order_by(AllowedDevice.created_at.desc())).all()
    return [{"id": d.id, "device_id": d.device_id, "description": d.description, "created_at": d.created_at.isoformat()} for d in devices]

@router.delete("/device/{device_id}")
def delete_device(device_id: str, session: Session = Depends(get_session), admin: dict = Depends(require_admin)):
    dev = session.exec(select(AllowedDevice).where(AllowedDevice.device_id == device_id)).first()
    if not dev:
        auth_error(404, "DEVICE_NOT_FOUND", "Device not found")
    session.delete(dev)
    session.commit()
    return {"status": "success"}
