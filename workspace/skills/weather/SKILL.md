---
name: weather
description: "Get current weather and forecasts. Use when: user asks about weather, temperature, or forecasts for any location. NOT for: historical weather data, severe weather alerts, or detailed meteorological analysis. No API key needed."
homepage: https://wttr.in/:help
metadata: { "openclaw": { "emoji": "🌤️", "requires": { "bins": ["curl"] } } }
---

# Weather Skill

Get current weather conditions and forecasts.

## When to Use

✅ **USE this skill when:**

- "What's the weather?"
- "Will it rain today/tomorrow?"
- "Temperature in [city]"
- "Weather forecast for the week"
- Travel planning weather checks

## When NOT to Use

❌ **DON'T use this skill when:**

- Historical weather data → use weather archives/APIs
- Climate analysis or trends → use specialized data sources
- Hyper-local microclimate data → use local sensors
- Severe weather alerts → check official NWS sources
- Aviation/marine weather → use specialized services (METAR, etc.)

## Location

Always include a city, region, or airport code in weather queries.

## ⚠️ 网络诊断（服务器环境必看）

服务器访问境外网站可能超时，**获取天气前先做网络探测**：

```bash
# 步骤1：测试 wttr.in 连通性（2秒超时）
curl -s --max-time 5 "wttr.in/Beijing?format=3"
```

- 若有输出 → wttr.in 可用，继续用下方 wttr.in 命令
- 若超时/失败 → 立即切换 **备用方案 open-meteo**（见下方）

## Primary: wttr.in Commands

### Current Weather

```bash
# One-line summary
curl -s --max-time 10 "wttr.in/London?format=3"

# Detailed current conditions
curl -s --max-time 10 "wttr.in/London?0"

# Specific city (中文城市名需 URL 编码，或用拼音)
curl -s --max-time 10 "wttr.in/Shanghai?format=3"
```

### Forecasts

```bash
# 3-day forecast
curl -s --max-time 10 "wttr.in/London"

# JSON output（易于解析）
curl -s --max-time 10 "wttr.in/London?format=j1"
```

### Format Codes

- `%c` — Weather condition emoji
- `%t` — Temperature
- `%f` — "Feels like"
- `%w` — Wind
- `%h` — Humidity
- `%p` — Precipitation
- `%l` — Location

## Fallback: open-meteo（备用，国内服务器友好）

当 wttr.in 不可用时，使用 open-meteo。需要先将城市名转换为经纬度。

```bash
# 步骤1：通过 geocoding API 获取城市经纬度
# 张家港 → Zhangjiagang
curl -s --max-time 10 "https://geocoding-api.open-meteo.com/v1/search?name=Zhangjiagang&count=1&language=zh&format=json"

# 步骤2：用经纬度获取天气（替换 latitude/longitude）
curl -s --max-time 10 "https://api.open-meteo.com/v1/forecast?latitude=31.87&longitude=120.56&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Asia%2FShanghai&forecast_days=3"
```

### open-meteo 天气代码 (weather_code) 解读

| 代码 | 天气 | 代码 | 天气 |
|------|------|------|------|
| 0 | 晴天 ☀️ | 61-67 | 雨 🌧️ |
| 1-3 | 多云 ⛅ | 71-77 | 雪 ❄️ |
| 45,48 | 雾 🌫️ | 80-82 | 阵雨 🌦️ |
| 51-57 | 毛毛雨 🌦️ | 95-99 | 雷雨 ⛈️ |

## Notes

- wttr.in: 无需 API key，支持全球城市，但境外服务器访问可能受限
- open-meteo: 无需 API key，国内服务器通常可正常访问
- 优先尝试 wttr.in，失败时自动切换 open-meteo

