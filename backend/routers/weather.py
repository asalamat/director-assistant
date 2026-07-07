"""Weather — current conditions for a user-configured location.

Uses the free Open-Meteo API (no API key required):
  - Geocoding:  https://geocoding-api.open-meteo.com/v1/search
  - Forecast:   https://api.open-meteo.com/v1/forecast

Temperature is always fetched in Celsius; the frontend converts to °F as needed,
so the C/F toggle is instant with no refetch.
"""

import httpx
from fastapi import APIRouter, HTTPException, Request

from routers.config import load_app_config, save_app_config

router = APIRouter(prefix="/api/weather", tags=["weather"])

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

# WMO weather interpretation codes → (label, emoji)
_WMO = {
    0: ("Clear sky", "☀️"),
    1: ("Mainly clear", "🌤️"), 2: ("Partly cloudy", "⛅"), 3: ("Overcast", "☁️"),
    45: ("Fog", "🌫️"), 48: ("Rime fog", "🌫️"),
    51: ("Light drizzle", "🌦️"), 53: ("Drizzle", "🌦️"), 55: ("Dense drizzle", "🌧️"),
    56: ("Freezing drizzle", "🌧️"), 57: ("Freezing drizzle", "🌧️"),
    61: ("Light rain", "🌦️"), 63: ("Rain", "🌧️"), 65: ("Heavy rain", "🌧️"),
    66: ("Freezing rain", "🌧️"), 67: ("Freezing rain", "🌧️"),
    71: ("Light snow", "🌨️"), 73: ("Snow", "🌨️"), 75: ("Heavy snow", "❄️"),
    77: ("Snow grains", "🌨️"),
    80: ("Light showers", "🌦️"), 81: ("Showers", "🌧️"), 82: ("Violent showers", "⛈️"),
    85: ("Snow showers", "🌨️"), 86: ("Snow showers", "❄️"),
    95: ("Thunderstorm", "⛈️"), 96: ("Thunderstorm w/ hail", "⛈️"), 99: ("Thunderstorm w/ hail", "⛈️"),
}


def _describe(code: int) -> dict:
    label, emoji = _WMO.get(int(code), ("Unknown", "🌡️"))
    return {"code": int(code), "label": label, "emoji": emoji}


@router.get("/search")
async def search_location(q: str = ""):
    """Geocode a city name → list of matching locations for the settings picker."""
    q = (q or "").strip()
    if len(q) < 2:
        return {"results": []}
    try:
        async with httpx.AsyncClient(timeout=15.0) as http:
            r = await http.get(GEOCODE_URL, params={"name": q, "count": 5, "language": "en", "format": "json"})
        if r.status_code >= 400:
            return {"results": []}
        data = r.json() or {}
    except Exception as e:
        raise HTTPException(502, f"Geocoding failed: {e}")

    results = []
    for m in (data.get("results") or []):
        parts = [m.get("name"), m.get("admin1"), m.get("country")]
        label = ", ".join(p for p in parts if p)
        results.append({
            "name": m.get("name", ""),
            "label": label,
            "latitude": m.get("latitude"),
            "longitude": m.get("longitude"),
            "country": m.get("country", ""),
            "admin1": m.get("admin1", ""),
        })
    return {"results": results}


@router.get("")
async def get_weather(request: Request):
    """Current conditions for the saved location. Temperature returned in °C."""
    cfg = load_app_config()
    lat = cfg.get("weather_lat")
    lon = cfg.get("weather_lon")
    location = cfg.get("weather_location", "")
    unit = cfg.get("weather_unit", "C")

    if lat is None or lon is None:
        return {"configured": False, "unit": unit}

    try:
        async with httpx.AsyncClient(timeout=15.0) as http:
            r = await http.get(FORECAST_URL, params={
                "latitude": lat,
                "longitude": lon,
                "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
                "temperature_unit": "celsius",
                "wind_speed_unit": "kmh",
            })
        if r.status_code >= 400:
            raise HTTPException(502, f"Weather API returned {r.status_code}")
        data = r.json() or {}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Weather fetch failed: {e}")

    cur = data.get("current") or {}
    return {
        "configured": True,
        "location": location,
        "unit": unit,
        "temp_c": cur.get("temperature_2m"),
        "feels_c": cur.get("apparent_temperature"),
        "humidity": cur.get("relative_humidity_2m"),
        "wind_kmh": cur.get("wind_speed_10m"),
        "weather": _describe(cur.get("weather_code", 0)),
    }
