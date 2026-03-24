import os
import ipaddress
import jwt
import base64
from datetime import datetime, timedelta
from fastapi import Request, HTTPException, Response, APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlmodel import Session, select
from webauthn import (
    generate_registration_options,
    verify_registration_response,
    generate_authentication_options,
    verify_authentication_response,
    options_to_json
)
import pyotp
from .database import get_session, WebAuthnCredential, AllowedDevice, AdminSecret

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

def is_home_network(ip_str: str) -> bool:
    if not ip_str:
        return False
    # If it's multiple IPs (X-Forwarded-For chain), take the first one
    ip_str = ip_str.split(",")[0].strip()
    
    if ip_str in ("127.0.0.1", "::1", "localhost"):
        return True
        
    try:
        ip = ipaddress.ip_address(ip_str)
        # 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12 are private
        return ip.is_private
    except ValueError:
        return False

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

def create_admin_token() -> str:
    # Long lived token for permanent device login (e.g., 10 years)
    expire = datetime.utcnow() + timedelta(days=3650)
    to_encode = {"role": "admin", "exp": expire}
    return jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)

def check_is_whitelisted(request: Request, session: Session) -> bool:
    client_ip = extract_client_ip(request)
    if is_home_network(client_ip):
        return True
    
    # Check DeviceID (either from header or cookie)
    device_id = request.headers.get("X-Device-Id") or request.cookies.get("device_id")
    if device_id:
        allowed = session.exec(select(AllowedDevice).where(AllowedDevice.device_id == device_id)).first()
        if allowed:
            return True
    return False

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

# WebAuthn Configuration
RP_ID = os.getenv("RP_ID", "localhost")
RP_NAME = "Specialty Coffee Archive"
ORIGIN = os.getenv("RP_ORIGIN", "http://localhost:8000")
COOKIE_SECURE = ORIGIN.startswith("https://")

ACTIVE_CHALLENGES = {}
CHALLENGE_TTL_SECONDS = 300
OTP_ATTEMPT_WINDOW_SECONDS = 300
OTP_MAX_ATTEMPTS = 5
OTP_ATTEMPTS = {}
LOGIN_ATTEMPT_WINDOW_SECONDS = 300
LOGIN_MAX_ATTEMPTS = 10
LOGIN_ATTEMPTS = {}

def set_active_challenge(key: str, challenge: bytes):
    ACTIVE_CHALLENGES[key] = {
        "challenge": challenge,
        "expires_at": datetime.utcnow() + timedelta(seconds=CHALLENGE_TTL_SECONDS),
    }

def pop_active_challenge(key: str):
    entry = ACTIVE_CHALLENGES.pop(key, None)
    if not entry:
        return None
    if datetime.utcnow() > entry["expires_at"]:
        return None
    return entry["challenge"]

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

@router.get("/register/generate")
def generate_register_opts(request: Request):
    user = get_current_user(request)
    if user["role"] != "admin":
        auth_error(403, "REGISTER_ADMIN_ONLY", "Only admins can register a new device.")
    
    options = generate_registration_options(
        rp_id=RP_ID,
        rp_name=RP_NAME,
        user_id=b"admin_user_id_1",
        user_name="admin",
    )
    set_active_challenge("register", options.challenge)
    return Response(content=options_to_json(options), media_type="application/json")

@router.post("/register/verify")
async def verify_register(request: Request, session: Session = Depends(get_session)):
    user = get_current_user(request)
    if user["role"] != "admin":
        auth_error(403, "REGISTER_FORBIDDEN", "Forbidden")
        
    data = await request.json()
    challenge = pop_active_challenge("register")
    if not challenge:
        auth_error(400, "REGISTER_CHALLENGE_MISSING", "No active challenge")
        
    try:
        verification = verify_registration_response(
            credential=data,
            expected_challenge=challenge,
            expected_rp_id=RP_ID,
            expected_origin=ORIGIN,
        )
        
        # Save credential
        cred = WebAuthnCredential(
            id=base64.urlsafe_b64encode(verification.credential_id).decode('utf-8'),
            public_key=base64.urlsafe_b64encode(verification.credential_public_key).decode('utf-8'),
            sign_count=verification.sign_count
        )
        session.add(cred)
        session.commit()
        return {"status": "success", "message": "Device registered successfully"}
    except Exception as e:
        auth_error(400, "REGISTER_VERIFY_FAILED", str(e))

@router.get("/login/generate")
def generate_login_opts():
    options = generate_authentication_options(
        rp_id=RP_ID,
    )
    set_active_challenge("login", options.challenge)
    return Response(content=options_to_json(options), media_type="application/json")

@router.post("/login/verify")
async def verify_login(request: Request, session: Session = Depends(get_session)):
    if _is_login_limited(request):
        auth_error(429, "AUTH_LOGIN_LOCKED", f"Too many login attempts. Try again in {LOGIN_ATTEMPT_WINDOW_SECONDS // 60} minutes.")

    data = await request.json()
    challenge = pop_active_challenge("login")
    if not challenge:
        auth_error(400, "LOGIN_CHALLENGE_MISSING", "No active challenge")
        
    cred_id_b64 = data.get("id")
    if not cred_id_b64:
        auth_error(400, "LOGIN_CREDENTIAL_ID_MISSING", "Missing credential ID")
        
    # Find credential
    cred = session.exec(select(WebAuthnCredential).where(WebAuthnCredential.id == cred_id_b64)).first()
    if not cred:
        _record_login_failure(request)
        auth_error(404, "LOGIN_DEVICE_NOT_RECOGNIZED", "Device not recognized.")
        
    try:
        verification = verify_authentication_response(
            credential=data,
            expected_challenge=challenge,
            expected_rp_id=RP_ID,
            expected_origin=ORIGIN,
            credential_public_key=base64.urlsafe_b64decode(cred.public_key + "=="),
            credential_current_sign_count=cred.sign_count,
        )
        
        # Update sign count
        cred.sign_count = verification.new_sign_count
        session.add(cred)
        session.commit()
        
        # Issue permanent JWT Cookie
        token = create_admin_token()
        response = JSONResponse(content={"status": "success"})
        response.set_cookie(key=COOKIE_NAME, value=token, **get_cookie_kwargs())
        _clear_login_failures(request)
        return response
    except Exception as e:
        _record_login_failure(request)
        auth_error(400, "LOGIN_VERIFY_FAILED", str(e))

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
        auth_error(400, "OTP_SETUP_REQUIRED", "OTP setup required on Home IP first.")
    
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
    if _is_login_limited(request):
        auth_error(429, "AUTH_WHITELIST_LOCKED", f"Too many login attempts. Try again in {LOGIN_ATTEMPT_WINDOW_SECONDS // 60} minutes.")

    if check_is_whitelisted(request, session):
        # Create persistent JWT token
        token = create_admin_token()
        response.set_cookie(key=COOKIE_NAME, value=token, **get_cookie_kwargs())
        _clear_login_failures(request)
        return {"status": "success"}
    _record_login_failure(request)
    auth_error(403, "WHITELIST_NOT_MET", "Whitelist (IP/DeviceID) not met")

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
