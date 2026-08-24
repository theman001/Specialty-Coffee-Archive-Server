from typing import Optional, List
from sqlmodel import SQLModel, Field, Session, create_engine
import os
from datetime import datetime, timezone

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
    tags: Optional[str] = None
    front_card_path: Optional[str] = None
    back_card_path: Optional[str] = None

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
    category_id: Optional[int] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class WikiCategory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    parent_id: Optional[int] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)

class HomeCafeRecipe(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: Optional[str] = Field(default=None, max_length=200)
    bean_name: str = Field(..., max_length=200)  # legacy — kept for NOT NULL compat, no longer bean-specific
    review_id: Optional[int] = Field(default=None, index=True)  # legacy — unused by new flows
    roast_level: Optional[str] = Field(default=None, max_length=50)  # legacy — unused by new flows
    brew_type: Optional[str] = Field(default=None, max_length=20)
    current_version_id: Optional[int] = Field(default=None)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class HomeCafeRecipeVersion(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    recipe_id: int = Field(foreign_key="homecaferecipe.id", index=True)
    version_number: int
    water_temp_c: Optional[float] = None
    dose_g: Optional[float] = None
    total_water_g: Optional[float] = None
    ratio_n: Optional[float] = None
    extraction_mode: str = Field(default="dose")
    grinder_name: Optional[str] = Field(default=None, max_length=100)
    grind_clicks: Optional[int] = None
    grind_note: Optional[str] = Field(default=None, max_length=100)
    dripper: str = Field(..., max_length=100)
    filter_type: Optional[str] = Field(default=None, max_length=100)
    water_type: Optional[str] = Field(default=None, max_length=100)
    result_memo: Optional[str] = Field(default=None, max_length=2000)
    result_rating: Optional[int] = Field(default=None)
    change_note: Optional[str] = Field(default=None, max_length=1000)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class HomeCafePourStep(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    version_id: int = Field(foreign_key="homecaferecipeversion.id", index=True)
    step_order: int
    label: Optional[str] = Field(default=None, max_length=50)
    water_g: Optional[float] = None
    duration_s: Optional[int] = None
    memo: Optional[str] = Field(default=None, max_length=200)


class HomeCafeEquipment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    equipment_type: str = Field(..., max_length=20)  # 'grinder' | 'dripper'
    name: str = Field(..., max_length=100)
    max_clicks: Optional[int] = Field(default=None)  # grinder only
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class HomeCafeBrewLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    recipe_id: int = Field(foreign_key="homecaferecipe.id", index=True)
    version_id: int = Field(foreign_key="homecaferecipeversion.id", index=True)
    bean_name: Optional[str] = Field(default=None, max_length=200)
    roast_level: Optional[str] = Field(default=None, max_length=50)
    review_id: Optional[int] = Field(default=None, index=True)
    taste_note: Optional[str] = Field(default=None, max_length=1000)
    overall_rating: Optional[int] = Field(default=None)
    brewed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class HomeCafeBrewLogStep(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    log_id: int = Field(foreign_key="homecafebrewlog.id", index=True)
    step_order: int
    label: Optional[str] = Field(default=None, max_length=50)
    actual_water_g: Optional[float] = None
    actual_duration_s: Optional[int] = None


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session
