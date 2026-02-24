#!/usr/bin/env python3
import argparse
import json
import os
import sys
import urllib.error
import urllib.request


def load_dotenv(env_file: str = ".env") -> None:
    if not os.path.exists(env_file):
        return

    with open(env_file, "r", encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key.startswith("export "):
                key = key[len("export "):].strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def env(name: str, required: bool = True, default: str = "") -> str:
    value = os.getenv(name, default).strip()
    if required and not value:
        print(f"[ERROR] Missing env: {name}")
        sys.exit(1)
    return value


def request_json(method: str, path: str, payload: dict | None = None):
    base = env("TICKTICK_BASE_URL", required=False, default="https://api.dida365.com/open/v1")
    token = env("TICKTICK_ACCESS_TOKEN")
    url = f"{base.rstrip('/')}/{path.lstrip('/')}"

    data = None
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url=url, data=data, headers=headers, method=method.upper())

    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode("utf-8")
            print(body if body else "{}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        print(json.dumps({"status": e.code, "error": body}, ensure_ascii=False))
        sys.exit(1)
    except urllib.error.URLError as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)


def cmd_list_projects(_args):
    request_json("GET", "/project")


def cmd_list_tasks(args):
    request_json("GET", f"/project/{args.project_id}/data")


def cmd_create_task(args):
    payload = {
        "projectId": args.project_id,
        "title": args.title,
    }
    if args.content:
        payload["content"] = args.content
    if args.due:
        payload["dueDate"] = args.due
    request_json("POST", "/task", payload)


def cmd_complete_task(args):
    request_json("POST", f"/project/{args.project_id}/task/{args.task_id}/complete", {})


def cmd_update_task(args):
    payload = {"id": args.task_id}
    if args.project_id:
        payload["projectId"] = args.project_id
    if args.title:
        payload["title"] = args.title
    if args.content:
        payload["content"] = args.content
    if args.due:
        payload["dueDate"] = args.due
    if args.priority is not None:
        payload["priority"] = args.priority

    if len(payload) == 1:
        print("[ERROR] update-task requires at least one mutable field")
        sys.exit(1)

    request_json("POST", f"/task/{args.task_id}", payload)


def cmd_delete_task(args):
    request_json("DELETE", f"/project/{args.project_id}/task/{args.task_id}")


def main():
    load_dotenv()

    parser = argparse.ArgumentParser(description="TickTick(Dida365) OpenAPI helper")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("list-projects", help="List all projects")
    p.set_defaults(func=cmd_list_projects)

    p = sub.add_parser("list-tasks", help="List project tasks/data")
    p.add_argument("--project-id", required=True)
    p.set_defaults(func=cmd_list_tasks)

    p = sub.add_parser("create-task", help="Create a task")
    p.add_argument("--project-id", required=True)
    p.add_argument("--title", required=True)
    p.add_argument("--content", default="")
    p.add_argument("--due", default="")
    p.set_defaults(func=cmd_create_task)

    p = sub.add_parser("complete-task", help="Complete a task")
    p.add_argument("--project-id", required=True)
    p.add_argument("--task-id", required=True)
    p.set_defaults(func=cmd_complete_task)

    p = sub.add_parser("update-task", help="Update a task")
    p.add_argument("--task-id", required=True)
    p.add_argument("--project-id", default="")
    p.add_argument("--title", default="")
    p.add_argument("--content", default="")
    p.add_argument("--due", default="")
    p.add_argument("--priority", type=int)
    p.set_defaults(func=cmd_update_task)

    p = sub.add_parser("delete-task", help="Delete a task")
    p.add_argument("--project-id", required=True)
    p.add_argument("--task-id", required=True)
    p.set_defaults(func=cmd_delete_task)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
