#!/usr/bin/env python3
"""
fetch_etf_data.py — 获取 ETF 实时价格和 MA20 均线

用法:
    python3 fetch_etf_data.py
    python3 fetch_etf_data.py --codes sh510310 sz159338
    python3 fetch_etf_data.py --json

输出示例:
    510310 (沪深300ETF): 当前价=3.985, MA20=3.921, 偏离度=+1.63%
    159338 (中证A500ETF): 当前价=1.152, MA20=1.178, 偏离度=-2.21%
"""

import argparse
import json
import sys
import time
import urllib.request
from datetime import datetime, timedelta


ETF_CONFIGS = {
    "sh510310": {"name": "沪深300ETF", "display_code": "510310"},
    "sz159338": {"name": "中证A500ETF", "display_code": "159338"},
}

SINA_URL = "https://hq.sinajs.cn/list={codes}"
HEADERS = {
    "Referer": "https://finance.sina.com.cn",
    "User-Agent": "Mozilla/5.0",
}


def fetch_realtime_price(codes: list[str]) -> dict:
    """通过新浪财经接口获取实时行情"""
    url = SINA_URL.format(codes=",".join(codes))
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("gbk")
    except Exception as e:
        raise RuntimeError(f"新浪接口请求失败: {e}")

    result = {}
    for line in raw.strip().splitlines():
        # 格式: var hq_str_sh510310="沪深300ETF,3.985,3.980,...";
        if "=" not in line:
            continue
        key_part, val_part = line.split("=", 1)
        code = key_part.strip().replace("var hq_str_", "")
        fields = val_part.strip().strip('"').strip(";").split(",")
        if len(fields) < 4:
            continue
        try:
            current_price = float(fields[3])  # 当前价（今日最新）
            if current_price == 0:
                current_price = float(fields[2])  # 昨收价 fallback
            result[code] = current_price
        except (ValueError, IndexError):
            continue
    return result


def fetch_ma20_tencent(display_code: str, market_prefix: str) -> float | None:
    """通过腾讯财经接口获取近 30 日收盘价，计算 MA20（无需第三方库，国内稳定可用）"""
    # 腾讯接口：sh510310 用 qfqday，sz159338 用 day
    url = (
        f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
        f"?_var=kline_dayqfq&param={market_prefix}{display_code},day,,,30,qfq&r=0.1"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8")
        json_str = raw.split("=", 1)[1].strip().rstrip(";")
        data = json.loads(json_str)
        stock_data = data.get("data", {}).get(f"{market_prefix}{display_code}", {})
        # sh 系列走 qfqday，sz 系列走 day（实测）
        klines = stock_data.get("qfqday") or stock_data.get("day") or []
        if not klines or len(klines) < 5:
            return None
        # 每条格式: [日期, 开盘, 收盘, 最高, 最低, 成交量]
        closes = []
        for kl in klines:
            try:
                closes.append(float(kl[2]))
            except (IndexError, ValueError):
                pass
        if len(closes) < 5:
            return None
        last20 = closes[-20:] if len(closes) >= 20 else closes
        return sum(last20) / len(last20)
    except Exception:
        return None


def fetch_ma20_akshare(display_code: str, market_prefix: str) -> float | None:
    """通过 akshare 获取近 20 日收盘价，计算 MA20（备用，需 pip install akshare）"""
    try:
        import akshare as ak
        df = ak.fund_etf_hist_em(symbol=display_code, period="daily",
                                  start_date="", end_date="", adjust="")
        if df is None or len(df) < 20:
            return None
        closes = df["收盘"].tail(20).astype(float).tolist()
        return sum(closes) / len(closes)
    except Exception:
        return None


def get_etf_data(codes: list[str]) -> list[dict]:
    """主函数：获取实时价格 + MA20，计算偏离度"""
    # Step 1: 实时价格
    prices = fetch_realtime_price(codes)

    results = []
    for code in codes:
        cfg = ETF_CONFIGS.get(code, {})
        display_code = cfg.get("display_code", code.replace("sh", "").replace("sz", ""))
        name = cfg.get("name", display_code)
        market_prefix = code[:2]

        current_price = prices.get(code)
        if current_price is None:
            results.append({"code": display_code, "name": name,
                            "error": "无法获取实时价格"})
            continue

        # Step 2: MA20（优先腾讯财经接口，备用 akshare）
        ma20 = fetch_ma20_tencent(display_code, market_prefix)
        if ma20 is None:
            ma20 = fetch_ma20_akshare(display_code, market_prefix)

        deviation = None
        if ma20 and ma20 > 0:
            deviation = (current_price - ma20) / ma20

        results.append({
            "code": display_code,
            "name": name,
            "current_price": round(current_price, 4),
            "ma20": round(ma20, 4) if ma20 else None,
            "deviation": round(deviation, 6) if deviation is not None else None,
            "deviation_pct": f"{deviation * 100:+.2f}%" if deviation is not None else "N/A",
        })

    return results


def main():
    parser = argparse.ArgumentParser(description="获取 A股 ETF 实时价格和 MA20")
    parser.add_argument("--codes", nargs="+",
                        default=["sh510310", "sz159338"],
                        help="ETF 代码列表（带市场前缀，如 sh510310）")
    parser.add_argument("--json", action="store_true", help="输出 JSON 格式")
    args = parser.parse_args()

    data = get_etf_data(args.codes)

    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(f"数据获取时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("-" * 55)
        for item in data:
            if "error" in item:
                print(f"{item['code']} ({item['name']}): ⚠️ {item['error']}")
            else:
                ma20_str = f"{item['ma20']}" if item['ma20'] else "N/A"
                print(f"{item['code']} ({item['name']})")
                print(f"  当前价: {item['current_price']}")
                print(f"  MA20:   {ma20_str}")
                print(f"  偏离度: {item['deviation_pct']}")
                print()


if __name__ == "__main__":
    main()
