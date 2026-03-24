from typing import Optional, List
from sqlmodel import SQLModel, Field, Session, create_engine
import os
from datetime import datetime

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/coffee_archive.db")
# check if sqlite URL needs special connect args
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, echo=False, connect_args=connect_args)

class Store(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    brand: Optional[str] = None
    address: str
    lat: float
    lng: float
    is_wishlist: bool = Field(default=False)
    marker_color: Optional[str] = None

class Review(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    store_id: int = Field(foreign_key="store.id")
    bean_name: str
    content: str
    front_card_path: Optional[str] = None
    back_card_path: Optional[str] = None

class WebAuthnCredential(SQLModel, table=True):
    id: str = Field(primary_key=True)
    public_key: str = Field(...)
    sign_count: int = Field(default=0)
    user_handle: Optional[str] = Field(default=None)

class AllowedDevice(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    device_id: str = Field(index=True, unique=True)
    description: str = Field(default="Registered Device")
    created_at: datetime = Field(default_factory=datetime.utcnow)

class AdminSecret(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    totp_secret: str = Field(...)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)

class WikiPost(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str = Field(index=True)
    content: str = Field(...)
    category: str = Field(index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session
