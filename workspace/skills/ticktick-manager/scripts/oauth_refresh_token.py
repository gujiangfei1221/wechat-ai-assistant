#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error


def env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        print(f"[ERROR] Missing env: {name}")
        sys.exit(1)
    return value


def upsert_env_file(env_file: str, values: dict[str, str]) -> None:
    existing_lines: list[str] = []
    if os.path.exists(env_file):
        with open(env_file, "r", encoding="utf-8") as f:
            existing_lines = f.read().splitlines()

    updated = {k: False for k in values.keys()}
    result_lines: list[str] = []

    for line in existing_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            result_lines.append(line)
            continue

        key, _ = line.split("=", 1)
        key = key.strip()
        if key in values:
            result_lines.append(f"{key}={values[key]}")
            updated[key] = True
        else:
            result_lines.append(line)

    for key, value in values.items():
        if not updated[key]:
            result_lines.append(f"{key}={value}")

    with open(env_file, "w", encoding="utf-8") as f:
        f.write("\n".join(result_lines).rstrip() + "\n")


def main():
    parser = argparse.ArgumentParser(description="Refresh TickTick OAuth token")
    parser.add_argument(
        "--write-env",
        action="store_true",
        help="Write refreshed tokens back to env file",
    )
    parser.add_argument(
        "--env-file",
        default=".env",
        help="Env file path used with --write-env (default: .env)",
    )
    args = parser.parse_args()

    base_url = os.getenv("TICKTICK_OAUTH_BASE_URL", "https://dida365.com").strip().rstrip("/")
    token_url = f"{base_url}/oauth/token"

    client_id = env("TICKTICK_CLIENT_ID")
    client_secret = env("TICKTICK_CLIENT_SECRET")
    redirect_uri = env("TICKTICK_REDIRECT_URI")
    refresh_token = env("TICKTICK_REFRESH_TOKEN")

    payload = {
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "redirect_uri": redirect_uri,
    }

    data = urllib.parse.urlencode(payload).encode("utf-8")
    req = urllib.request.Request(
        token_url,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode("utf-8")
            result = json.loads(body)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        print(json.dumps({"status": e.code, "error": body}, ensure_ascii=False))
        sys.exit(1)
    except urllib.error.URLError as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)

    access_token = result.get("access_token", "")
    new_refresh_token = result.get("refresh_token", "")
    expires_in = result.get("expires_in")

    if not access_token:
        print(json.dumps({"error": "No access_token in response", "response": result}, ensure_ascii=False))
        sys.exit(1)

    masked_access = f"{access_token[:8]}***" if len(access_token) >= 8 else "***"
    masked_refresh = f"{new_refresh_token[:8]}***" if len(new_refresh_token) >= 8 else ("***" if new_refresh_token else "")

    print("[OK] Token refreshed")
    print(f"access_token(masked): {masked_access}")
    if new_refresh_token:
        print(f"refresh_token(masked): {masked_refresh}")
    if expires_in is not None:
        print(f"expires_in: {expires_in}")

    if args.write_env:
        values = {"TICKTICK_ACCESS_TOKEN": access_token}
        if new_refresh_token:
            values["TICKTICK_REFRESH_TOKEN"] = new_refresh_token
        upsert_env_file(args.env_file, values)
        print(f"[OK] Wrote refreshed token(s) to: {args.env_file}")
        return

    print("\n# Copy to your shell/.env (keep secret):")
    print(f"TICKTICK_ACCESS_TOKEN={access_token}")
    if new_refresh_token:
        print(f"TICKTICK_REFRESH_TOKEN={new_refresh_token}")


if __name__ == "__main__":
    main()
