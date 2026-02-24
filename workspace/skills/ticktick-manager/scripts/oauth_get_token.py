#!/usr/bin/env python3
import argparse
import json
import sys
import urllib.parse
import urllib.request
import urllib.error


def prompt_if_empty(value: str, label: str) -> str:
    if value.strip():
        return value.strip()
    entered = input(f"{label}: ").strip()
    if not entered:
        print(f"[ERROR] Missing required value: {label}")
        sys.exit(1)
    return entered


def main():
    parser = argparse.ArgumentParser(
        description="Exchange TickTick/Dida365 OAuth authorization code for access_token and refresh_token"
    )
    parser.add_argument("--client-id", default="", help="OAuth client id")
    parser.add_argument("--client-secret", default="", help="OAuth client secret")
    parser.add_argument("--redirect-uri", default="", help="OAuth redirect uri")
    parser.add_argument("--code", default="", help="Authorization code from callback URL")
    parser.add_argument(
        "--oauth-base-url",
        default="https://dida365.com",
        help="OAuth base URL (default: https://dida365.com)",
    )
    args = parser.parse_args()

    client_id = prompt_if_empty(args.client_id, "Client ID")
    client_secret = prompt_if_empty(args.client_secret, "Client Secret")
    redirect_uri = prompt_if_empty(args.redirect_uri, "Redirect URI")

    code = args.code.strip()
    if not code:
        print("\nOpen this URL in your browser, authorize, then copy `code` from callback URL:\n")
        auth_query = urllib.parse.urlencode(
            {
                "client_id": client_id,
                "scope": "tasks:read tasks:write",
                "state": "ticktick-local",
                "redirect_uri": redirect_uri,
                "response_type": "code",
            }
        )
        print(f"{args.oauth_base_url.rstrip('/')}/oauth/authorize?{auth_query}\n")
        code = input("Authorization Code: ").strip()
        if not code:
            print("[ERROR] Missing authorization code")
            sys.exit(1)

    token_url = f"{args.oauth_base_url.rstrip('/')}/oauth/token"
    payload = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        token_url,
        data=payload,
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
    refresh_token = result.get("refresh_token", "")
    expires_in = result.get("expires_in")

    if not access_token:
        print(json.dumps({"error": "Token response missing access_token", "response": result}, ensure_ascii=False))
        sys.exit(1)

    print("[OK] OAuth token exchange success")
    print(f"access_token: {access_token}")
    if refresh_token:
        print(f"refresh_token: {refresh_token}")
    else:
        print("refresh_token: <not returned by provider>")
    if expires_in is not None:
        print(f"expires_in: {expires_in}")

    print("\n# Suggested .env values")
    print(f"TICKTICK_ACCESS_TOKEN={access_token}")
    if refresh_token:
        print(f"TICKTICK_REFRESH_TOKEN={refresh_token}")


if __name__ == "__main__":
    main()
