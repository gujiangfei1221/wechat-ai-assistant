#!/usr/bin/env python3
"""
profit_alert.py — 模块B：阶梯止盈防守引擎

触发时机: 每个交易日 14:50（收盘前监控）

用法:
    python3 profit_alert.py --cost-310 3.650 --cost-338 1.120
    python3 profit_alert.py --cost-310 3.650 --cost-338 1.120 --reset-alerts
    python3 profit_alert.py --cost-310 3.650 --cost-338 1.120 --json

止盈规则:
    收益率 >= 10% → Level 1: 建议卖出 20% 仓位
    收益率 >= 20% → Level 2: 建议卖出 50% 仓位（更高优先级）
    已提醒过的级别不重复推送（去重，直到手动 --reset-alerts）
"""

import argparse
import json
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
from fetch_etf_data import get_etf_data


# ── 止盈阶梯配置 ──────────────────────────────────────
PROFIT_LEVELS = [
    {
        "level": 2,
        "threshold": 0.20,
        "sell_ratio": 0.50,
        "label": "止盈警报 Level 2",
        "action": "建议手动卖出 50% 仓位，将利润彻底落袋！",
        "emoji": "🔔🔔",
    },
    {
        "level": 1,
        "threshold": 0.10,
        "sell_ratio": 0.20,
        "label": "止盈警报 Level 1",
        "action": "建议手动卖出 20% 仓位，收回部分本金。",
        "emoji": "🔔",
    },
]

# 去重记录文件（保存在用户 home 目录）
ALERT_STATE_FILE = os.path.expanduser("~/.a-share-investor-alerts.json")


def load_alert_state() -> dict:
    """加载已发送的警报记录"""
    if os.path.exists(ALERT_STATE_FILE):
        try:
            with open(ALERT_STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_alert_state(state: dict):
    """保存警报记录"""
    try:
        with open(ALERT_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"⚠️ 无法保存警报状态: {e}", file=sys.stderr)


def reset_alert_state():
    """重置所有警报记录（用于仓位调整后重新开始监控）"""
    if os.path.exists(ALERT_STATE_FILE):
        os.remove(ALERT_STATE_FILE)
    print("✅ 止盈警报记录已重置")


def check_profit(code: str, current_price: float, cost_price: float,
                 alert_state: dict) -> dict:
    """检查单只 ETF 的止盈状态"""
    profit_rate = (current_price - cost_price) / cost_price
    triggered = []

    for lvl_cfg in PROFIT_LEVELS:
        level = lvl_cfg["level"]
        threshold = lvl_cfg["threshold"]
        state_key = f"{code}_level{level}"

        if profit_rate >= threshold:
            already_alerted = alert_state.get(state_key, False)
            triggered.append({
                "level": level,
                "label": lvl_cfg["label"],
                "threshold_pct": f"{threshold*100:.0f}%",
                "sell_ratio_pct": f"{lvl_cfg['sell_ratio']*100:.0f}%",
                "action": lvl_cfg["action"],
                "emoji": lvl_cfg["emoji"],
                "already_alerted": already_alerted,
                "state_key": state_key,
            })
            break  # 只触发最高级别（避免同时触发L1和L2）

    return {
        "code": code,
        "current_price": current_price,
        "cost_price": cost_price,
        "profit_rate": round(profit_rate, 6),
        "profit_pct": f"{profit_rate * 100:+.2f}%",
        "triggered": triggered,
    }


def run_profit_alert(cost_310: float, cost_338: float,
                     force_alert: bool = False) -> dict:
    """主逻辑：获取实时价格 → 计算收益率 → 触发止盈警报"""
    cost_map = {"510310": cost_310, "159338": cost_338}
    etf_data = get_etf_data(["sh510310", "sz159338"])
    alert_state = load_alert_state()

    results = []
    new_alerts = []
    state_updates = {}

    for item in etf_data:
        code = item["code"]
        cost = cost_map.get(code)

        if "error" in item or cost is None:
            results.append({
                "code": code,
                "name": item.get("name", code),
                "error": item.get("error", "未提供成本价"),
            })
            continue

        current = item["current_price"]
        check = check_profit(code, current, cost, alert_state)
        check["name"] = item.get("name", code)

        for t in check["triggered"]:
            if not t["already_alerted"] or force_alert:
                new_alerts.append({
                    "code": code,
                    "name": check["name"],
                    **t,
                })
                state_updates[t["state_key"]] = True

        results.append(check)

    # 持久化新的警报状态
    if state_updates:
        alert_state.update(state_updates)
        save_alert_state(alert_state)

    return {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "results": results,
        "new_alerts": new_alerts,
        "has_new_alert": len(new_alerts) > 0,
    }


def format_report(result: dict) -> str:
    """格式化为投顾对话风格的文字报告"""
    now = datetime.now()
    weekday_cn = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][now.weekday()]
    lines = [
        f"【止盈监控报告】{now.strftime('%Y-%m-%d')} ({weekday_cn}) {now.strftime('%H:%M')}",
        "─" * 45,
    ]

    for item in result["results"]:
        if "error" in item:
            lines.append(f"\n⚠️  {item['code']} ({item.get('name', '')}): {item['error']}")
            continue

        profit_emoji = "📈" if item["profit_rate"] > 0 else "📉"
        lines.append(f"\n{profit_emoji} {item['code']} ({item['name']})")
        lines.append(
            f"   当前价: {item['current_price']}  |  成本价: {item['cost_price']}  |  "
            f"收益率: {item['profit_pct']}"
        )

        if not item["triggered"]:
            lines.append("   ✅ 未触及止盈线，继续持有。")
        else:
            for t in item["triggered"]:
                if t["already_alerted"]:
                    lines.append(f"   ℹ️  [{t['label']}] 已于之前提醒过（已到 {t['threshold_pct']}）")
                else:
                    lines.append(f"   {t['emoji']} 【{t['label']}】收益率已达 {t['threshold_pct']}！")
                    lines.append(f"      → {t['action']}")

    lines.append("\n" + "─" * 45)

    if result["new_alerts"]:
        lines.append("🚨 【今日新增止盈提醒】")
        for a in result["new_alerts"]:
            lines.append(
                f"  {a['emoji']} {a['code']} {a['name']}: {a['label']} — {a['action']}"
            )
    else:
        lines.append("✅ 今日无新增止盈提醒，持仓安全，保持纪律。")

    lines.append(f"\n💡 提示：如已按提醒操作调仓，请运行 --reset-alerts 重置记录。")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="A股ETF阶梯止盈防守引擎")
    parser.add_argument("--cost-310", type=float, required=True,
                        help="510310 沪深300ETF 持仓平均成本价（元/份）")
    parser.add_argument("--cost-338", type=float, required=True,
                        help="159338 中证A500ETF 持仓平均成本价（元/份）")
    parser.add_argument("--reset-alerts", action="store_true",
                        help="重置已发送的止盈警报记录（调仓后使用）")
    parser.add_argument("--force", action="store_true",
                        help="强制推送所有触达的警报（忽略去重）")
    parser.add_argument("--json", action="store_true", help="输出 JSON 格式")
    args = parser.parse_args()

    if args.reset_alerts:
        reset_alert_state()
        return

    result = run_profit_alert(
        cost_310=args.cost_310,
        cost_338=args.cost_338,
        force_alert=args.force,
    )

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(format_report(result))


if __name__ == "__main__":
    main()
