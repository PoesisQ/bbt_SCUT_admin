import argparse
import asyncio
import re

from auth import is_logged_in
from browser import create_browser, do_login, intercept_subtitle, get_course_list
from subtitle import save_subtitle

LIVINGROOM_URL_RE = re.compile(
    r"video\.jw\.scut\.edu\.cn/livingroom\?.*?"
    r"(?:^|&|)(?:course_id=(\d+))?"
    r"(?:^|&|)(?:sub_id=(\d+))"
)


def parse_course_url(url: str) -> tuple[str | None, str | None]:
    """从课程 URL 中解析 course_id 和 sub_id。"""
    m = LIVINGROOM_URL_RE.search(url)
    if m:
        return m.group(1), m.group(2)
    return None, None


async def cmd_login(args):
    browser, context = await create_browser(headless=False)
    try:
        await do_login(context)
    finally:
        await context.close()
        await browser.close()


async def cmd_courses(args):
    if not is_logged_in():
        print("请先登录：uv run python main.py login")
        return

    browser, context = await create_browser(headless=True)
    try:
        courses = await get_course_list(context)
        if not courses:
            print("未找到课程列表。可能登录状态已过期，请重新登录。")
            return

        print(f"\n共找到 {len(courses)} 门课程：\n")
        for c in courses:
            sub_id = c.get("sub_id", c.get("id", "?"))
            name = c.get("name", c.get("title", c.get("course_name", "未知")))
            print(f"  [{sub_id}] {name}")
    finally:
        await context.close()
        await browser.close()


async def cmd_get(args):
    if not is_logged_in():
        print("请先登录：uv run python main.py login")
        return

    # 确定要抓取的课程列表：[(course_id, sub_id), ...]
    tasks: list[tuple[str | None, str]] = []

    if args.urls:
        for url in args.urls:
            course_id, sub_id = parse_course_url(url)
            if sub_id:
                tasks.append((course_id, sub_id))
            else:
                print(f"无法解析链接：{url}")
    else:
        print("请粘贴课程链接（回车确认）：")
        url = input("> ").strip()
        if not url:
            print("未提供链接。")
            return
        course_id, sub_id = parse_course_url(url)
        if not sub_id:
            print("无法从链接中解析课程信息，请检查链接是否正确。")
            return
        tasks.append((course_id, sub_id))

    browser, context = await create_browser(headless=args.headless)

    success = 0
    failed = 0
    for i, (course_id, sub_id) in enumerate(tasks, 1):
        label = sub_id
        print(f"[{i}/{len(tasks)}] 正在获取课程 {label} 的字幕...")
        try:
            data = await intercept_subtitle(context, sub_id, course_id=course_id)
            json_path, srt_path, txt_path = save_subtitle(data, sub_id)
            print(f"  成功！共 {len(data)} 条字幕")
            print(f"  JSON: {json_path}")
            print(f"  SRT:  {srt_path}")
            print(f"  TXT:  {txt_path}")
            success += 1
        except Exception as e:
            print(f"  失败: {e}")
            failed += 1

    await context.close()
    await browser.close()
    print(f"\n完成：成功 {success}，失败 {failed}")


def main():
    parser = argparse.ArgumentParser(description="华园视频字幕提取工具")
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("login", help="扫码登录华园视频")

    subparsers.add_parser("courses", help="列出所有课程")

    get_parser = subparsers.add_parser("get", help="获取课程字幕")
    get_parser.add_argument("urls", nargs="*", help="课程链接（支持多个）")
    get_parser.add_argument("--headless", action="store_true", help="无头模式运行（不显示浏览器窗口）")

    args = parser.parse_args()

    if args.command == "login":
        asyncio.run(cmd_login(args))
    elif args.command == "courses":
        asyncio.run(cmd_courses(args))
    elif args.command == "get":
        asyncio.run(cmd_get(args))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
