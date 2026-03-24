from pyproj import Proj, Transformer
import os
import requests
import re

# Naver TM128 Projection String
naver_tm128 = Proj('+proj=tmerc +lat_0=38 +lon_0=128 +k=0.9999 +x_0=400000 +y_0=600000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43')
wgs84 = Proj(proj='latlong', datum='WGS84')
# Use Transformer to convert x(lng), y(lat) from TM128 to WGS84
transformer = Transformer.from_proj(naver_tm128, wgs84, always_xy=True)

import math

def convert_tm128_to_wgs84(mapx: int, mapy: int):
    """
    네이버 API에서 반환하는 mapx, mapy (TM128 또는 1e7 WGS84)를 위경도(EPSG:4326/WGS84)로 변환합니다.
    """
    if mapx > 10000000 and mapy > 10000000:
        return mapy / 1e7, mapx / 1e7
        
    try:
        lng, lat = transformer.transform(mapx, mapy)
        if math.isinf(lat) or math.isnan(lat):
            return 37.5665, 126.9780
        return lat, lng
    except Exception:
        return 37.5665, 126.9780

def clean_html_tags(text: str) -> str:
    """HTML 태그 제거"""
    if not text:
        return text
    clean = re.compile('<.*?>')
    return re.sub(clean, '', text)

def search_naver_local(query: str):
    """
    네이버 지역 검색 API (카페 자동 조합) 및 결과 파싱 함수
    - 상위 5개 가져와서 반환
    - '카페' 키워드가 들어가지 않으면 자동 조합
    """
    if '카페' not in query:
        query = f"{query} 카페"
    
    client_id = os.getenv('NAVER_CLIENT_ID')
    client_secret = os.getenv('NAVER_CLIENT_SECRET')
    
    headers = {
        'X-Naver-Client-Id': client_id,
        'X-Naver-Client-Secret': client_secret
    }
    
    url = "https://openapi.naver.com/v1/search/local.json"
    resp = requests.get(
        url,
        headers=headers,
        params={"query": query, "display": 5},
        timeout=8
    )
    
    if resp.status_code != 200:
        return []
    
    data = resp.json()
    items = data.get('items', [])
    fixed_items = []
    
    for item in items:
        # 카페 관련 필터: 보통 category 필드에 '음식점>카페,디저트' 같은 값이 들어있음
        if '카페' in item.get('category', ''):
            lat, lng = convert_tm128_to_wgs84(int(item['mapx']), int(item['mapy']))
            fixed_items.append({
                "title": clean_html_tags(item['title']),
                "category": item['category'],
                "roadAddress": item['roadAddress'],
                "lat": lat,
                "lng": lng
            })
            
    return fixed_items

def extract_flavor_color(content: str) -> str:
    """
    본문 내용에서 가장 많이 등장하는 키워드군을 찾아 대표색을 지정해주는 스펙트럼 로직
    """
    content = content.lower()
    flavors = {
        "floral": "#fbc531",  # 노란색 베이스
        "fruity": "#e84118",  # 붉은 오렌지 베이스
        "nutty": "#e1b12c",   # 갈색-노랑 베이스
        "sweet": "#e7aecb",   # 핑크 베이스
        "chocolate": "#2f3640", # 짙은 회-검정 계열
        "earthy": "#7f8fa6",  # 흙빛-회색 계열
        "꽃": "#fbc531",
        "과일": "#e84118",
        "견과류": "#e1b12c",
        "달콤": "#e7aecb",
        "초코": "#2f3640"
    }
    found = []
    for k, v in flavors.items():
        if k in content and v not in found:
            found.append(v)
            
    if len(found) == 0:
        return "#dcdde1" # Default neutral
    elif len(found) == 1:
        return found[0]
    else:
        return f"linear-gradient(135deg, {found[0]} 0%, {found[1]} 100%)"
