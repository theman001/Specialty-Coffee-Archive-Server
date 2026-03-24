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
from webauthn.helpers.structs import RegistrationCredential, AuthenticationCredential
import pyotp
import uuid
from .database import get_session, WebAuthnCredential, AllowedDevice, AdminSecret

router = APIRouter(prefix="/api/auth")

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

def get_current_user(request: Request, session: Session = Depends(get_session)) -> dict:
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
        raise HTTPException(status_code=403, detail="Admin permissions required.")
    return user

# WebAuthn Configuration
RP_ID = os.getenv("RP_ID", "localhost")
RP_NAME = "Specialty Coffee Archive"
ORIGIN = os.getenv("RP_ORIGIN", "http://localhost:8000")

# For a single-user app, storing the active challenge globally is acceptable.
ACTIVE_CHALLENGES = {}

@router.get("/register/generate")
def generate_register_opts(request: Request):
    user = get_current_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only Admins (Home Network) can register a new device.")
    
    options = generate_registration_options(
        rp_id=RP_ID,
        rp_name=RP_NAME,
        user_id=b"admin_user_id_1",
        user_name="admin",
    )
    ACTIVE_CHALLENGES["register"] = options.challenge
    return Response(content=options_to_json(options), media_type="application/json")

@router.post("/register/verify")
async def verify_register(request: Request, session: Session = Depends(get_session)):
    user = get_current_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
        
    data = await request.json()
    challenge = ACTIVE_CHALLENGES.get("register")
    if not challenge:
        raise HTTPException(status_code=400, detail="No active challenge")
        
    try:
        verification = verify_registration_response(
            credential=data,
            expected_challenge=challenge,
            expected_rp_id=RP_ID,
            expected_origin=ORIGIN,
        )
        
        # Save credential
        cred = WebAuthnCredential(
            credential_id=base64.urlsafe_b64encode(verification.credential_id).decode('utf-8'),
            public_key=base64.urlsafe_b64encode(verification.credential_public_key).decode('utf-8'),
            sign_count=verification.sign_count
        )
        session.add(cred)
        session.commit()
        return {"status": "success", "message": "Device registered successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/login/generate")
def generate_login_opts():
    options = generate_authentication_options(
        rp_id=RP_ID,
    )
    ACTIVE_CHALLENGES["login"] = options.challenge
    return Response(content=options_to_json(options), media_type="application/json")

@router.post("/login/verify")
async def verify_login(request: Request, session: Session = Depends(get_session)):
    data = await request.json()
    challenge = ACTIVE_CHALLENGES.get("login")
    if not challenge:
        raise HTTPException(status_code=400, detail="No active challenge")
        
    cred_id_b64 = data.get("id")
    if not cred_id_b64:
        raise HTTPException(status_code=400, detail="Missing credential ID")
        
    # Find credential
    cred = session.exec(select(WebAuthnCredential).where(WebAuthnCredential.credential_id == cred_id_b64)).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Device not recognized.")
        
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
        response.set_cookie(key=COOKIE_NAME, value=token, httponly=True, max_age=315360000)
        return response
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

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
        raise HTTPException(status_code=400, detail="Missing Secret or Code")
    
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
        raise HTTPException(status_code=400, detail="Invalid OTP Code")

@router.post("/login/otp")
async def login_via_otp(request: Request, session: Session = Depends(get_session)):
    data = await request.json()
    code = data.get("code")
    
    admin_sec = session.exec(select(AdminSecret)).first()
    if not admin_sec:
        raise HTTPException(status_code=400, detail="OTP setup required on Home IP first.")
    
    totp = pyotp.TOTP(admin_sec.totp_secret)
    if totp.verify(code):
        token = create_admin_token()
        response = JSONResponse(content={"status": "success"})
        response.set_cookie(key=COOKIE_NAME, value=token, httponly=True, max_age=315360000)
        return response
    else:
        raise HTTPException(status_code=400, detail="Invalid code.")

@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)
    return {"status": "success"}

@router.post("/login/whitelist")
async def login_whitelist(request: Request, response: Response, session: Session = Depends(get_session)):
    if check_is_whitelisted(request, session):
        # Create persistent JWT token
        token = create_admin_token()
        response.set_cookie(key=COOKIE_NAME, value=token, max_age=315360000, httponly=True)
        return {"status": "success"}
    raise HTTPException(status_code=403, detail="Whitelist (IP/DeviceID) not met")

@router.post("/device/register")
async def register_device(request: Request, session: Session = Depends(get_session), admin: dict = Depends(require_admin)):
    data = await request.json()
    dev_id = data.get("device_id")
    desc = data.get("description", "Registered Device")
    if not dev_id:
        raise HTTPException(status_code=400, detail="Missing DeviceID")
    
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
    response.set_cookie(key="device_id", value=dev_id, max_age=315360000, httponly=True)
    return response

@router.get("/device/list")
def list_devices(session: Session = Depends(get_session), admin: dict = Depends(require_admin)):
    devices = session.exec(select(AllowedDevice).order_by(AllowedDevice.created_at.desc())).all()
    return [{"id": d.id, "device_id": d.device_id, "description": d.description, "created_at": d.created_at.isoformat()} for d in devices]

@router.delete("/device/{device_id}")
def delete_device(device_id: str, session: Session = Depends(get_session), admin: dict = Depends(require_admin)):
    dev = session.exec(select(AllowedDevice).where(AllowedDevice.device_id == device_id)).first()
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")
    session.delete(dev)
    session.commit()
    return {"status": "success"}
