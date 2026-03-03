#!/usr/bin/env python3
"""
dip_invest.py — 模块A：非对称定投决策引擎

触发时机: 每周一 12:00（或用户主动询问定投建议时）

用法:
    python3 dip_invest.py
    python3 dip_invest.py --base-310 1000 --base-338 600
    python3 dip_invest.py --json

输出示例:
    【定投决策报告】2026-03-03 (周一)
    ────────────────────────────────────────
    510310 (沪深300ETF): 当前价=3.985, MA20=3.921, 偏离度=+1.63%
      → 场景2: 震荡区，执行基础定投 1000 元
    159338 (中证A500ETF): 当前价=1.138, MA20=1.178, 偏离度=-3.40%
      → 场景3: 超跌区，建议加仓 900 元（1.5x）
    ────────────────────────────────────────
    【汇总指令】
    买入 510310 易方达沪深300ETF: 1000 元
    买入 159338 国泰中证A500ETF:  900 元（超跌加倍，请检查条件单是否触发）
"""

import argparse
import json
import sys
import os
from datetime import datetime

# 将 scripts 目录加入 path，以复用 fetch_etf_data
sys.path.insert(0, os.path.dirname(__file__))
from fetch_etf_data import get_etf_data


# ── 默认配置 ──────────────────────────────────────────
DEFAULT_BASE_AMOUNTS = {
    "510310": 1000,  # 沪深300ETF 每周基础定投金额（元）
    "159338": 600,   # 中证A500ETF 每周基础定投金额（元）
}

THRESHOLDS = {
    "high": 0.02,   # 偏离度 > +2%：大涨，暂停定投
    "low": -0.02,   # 偏离度 < -2%：大跌，加倍抄底
}

MULTIPLIER_OVERSOLD = 1.5  # 超跌时倍数


def decide_invest(code: str, deviation: float | None, base_amount: int) -> dict:
    """根据偏离度决定定投金额和场景"""
    if deviation is None:
        return {
            "scenario": 0,
            "label": "数据异常",
            "amount": 0,
            "message": f"⚠️ 无法获取 MA20 数据，本周跳过 {code} 定投，请手动核查。",
        }

    if deviation > THRESHOLDS["high"]:
        return {
            "scenario": 1,
            "label": "大涨/强势区",
            "amount": 0,
            "message": (
                f"当前处于均线上方强势区（偏离 {deviation*100:+.2f}%），"
                f"暂停本周定投（买入 0 元），避免追高。"
            ),
        }
    elif deviation < THRESHOLDS["low"]:
        amount = int(base_amount * MULTIPLIER_OVERSOLD)
        return {
            "scenario": 3,
            "label": "大跌/超跌区",
            "amount": amount,
            "message": (
                f"当前处于均线下方超跌区（偏离 {deviation*100:+.2f}%），"
                f"建议触发网格抄底！请检查券商【定价买入条件单】是否已自动触发。"
                f"如未触发，建议手动买入 {amount} 元（{MULTIPLIER_OVERSOLD}x 基础金额）。"
            ),
        }
    else:
        return {
            "scenario": 2,
            "label": "震荡/均线区",
            "amount": base_amount,
            "message": (
                f"当前处于均线震荡区（偏离 {deviation*100:+.2f}%），"
                f"执行基础定投：买入 {base_amount} 元。"
            ),
        }


def run_dip_invest(base_310: int = 1000, base_338: int = 600) -> dict:
    """主逻辑：获取数据 → 计算信号 → 生成决策"""
    base_amounts = {"510310": base_310, "159338": base_338}
    etf_data = get_etf_data(["sh510310", "sz159338"])

    decisions = []
    for item in etf_data:
        code = item["code"]
        base = base_amounts.get(code, 1000)
        deviation = item.get("deviation")

        if "error" in item:
            decision = {
                "scenario": 0,
                "label": "获取失败",
                "amount": 0,
                "message": f"⚠️ {item['error']}，本周跳过 {code} 定投。",
            }
        else:
            decision = decide_invest(code, deviation, base)

        decisions.append({
            "code": code,
            "name": item.get("name", code),
            "current_price": item.get("current_price"),
            "ma20": item.get("ma20"),
            "deviation_pct": item.get("deviation_pct", "N/A"),
            "base_amount": base,
            **decision,
        })

    return {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "weekday": datetime.now().strftime("%A"),
        "decisions": decisions,
        "total_invest": sum(d["amount"] for d in decisions),
    }


def format_report(result: dict) -> str:
    """格式化为投顾对话风格的文字报告"""
    now = datetime.now()
    weekday_cn = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][now.weekday()]
    lines = [
        f"【智定投决策报告】{now.strftime('%Y-%m-%d')} ({weekday_cn})",
        "─" * 45,
    ]

    for d in result["decisions"]:
        lines.append(f"\n📊 {d['code']} ({d['name']})")
        if d.get("current_price"):
            lines.append(f"   当前价: {d['current_price']}  |  MA20: {d['ma20']}  |  偏离度: {d['deviation_pct']}")
        scenario_icons = {1: "🔴", 2: "🟡", 3: "🟢", 0: "⚠️"}
        icon = scenario_icons.get(d["scenario"], "❓")
        lines.append(f"   {icon} {d['message']}")

    lines.append("\n" + "─" * 45)
    lines.append("【汇总操作指令】")
    for d in result["decisions"]:
        if d["amount"] > 0:
            suffix = "（超跌加倍，请同步检查条件单）" if d["scenario"] == 3 else ""
            lines.append(f"  ✅ 买入 {d['code']} {d['name']}: {d['amount']} 元{suffix}")
        else:
            lines.append(f"  ⏸️  {d['code']} {d['name']}: 本周暂停")
    lines.append(f"\n  📌 本周合计定投: {result['total_invest']} 元")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="A股ETF非对称定投决策引擎")
    parser.add_argument("--base-310", type=int, default=1000,
                        help="510310 每周基础定投金额（元），默认 1000")
    parser.add_argument("--base-338", type=int, default=600,
                        help="159338 每周基础定投金额（元），默认 600")
    parser.add_argument("--json", action="store_true", help="输出 JSON 格式")
    args = parser.parse_args()

    result = run_dip_invest(base_310=args.base_310, base_338=args.base_338)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(format_report(result))


if __name__ == "__main__":
    main()
