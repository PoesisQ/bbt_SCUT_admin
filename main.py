import argparse
import asyncio
import re

from auth import is_logged_in
from browser import create_browser, do_login, intercept_subtitle, get_course_catalogue
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


async def cmd_get(args):
    if not is_logged_in():
        print("请先登录：uv run python main.py login")
        return

    # 确定要抓取的课程列表：[(course_id, sub_id, title), ...]
    tasks: list[tuple[str | None, str, str]] = []

    if args.all:
        # 从第一个 URL 中提取 course_id，获取整门课程的目录
        url = args.urls[0] if args.urls else None
        if not url:
            url = input("请粘贴课程链接以获取课程目录：\n> ").strip()

        course_id, sub_id = parse_course_url(url)
        if not course_id:
            print("链接中缺少 course_id，无法获取课程目录。")
            return

        print(f"正在获取课程目录（course_id={course_id}）...")
        browser, context = await create_browser(headless=args.headless)
        catalogue = await get_course_catalogue(context, course_id)
        if not catalogue:
            print("未找到课程目录。")
            await context.close()
            await browser.close()
            return

        print(f"共 {len(catalogue)} 节课\n")
        for item in catalogue:
            tasks.append((course_id, item["sub_id"], item.get("title", "")))
    elif args.urls:
        for url in args.urls:
            course_id, sub_id = parse_course_url(url)
            if sub_id:
                tasks.append((course_id, sub_id, ""))
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
        tasks.append((course_id, sub_id, ""))

    if not args.all:
        browser, context = await create_browser(headless=args.headless)

    success = 0
    failed = 0
    for i, (course_id, sub_id, title) in enumerate(tasks, 1):
        label = f"{title} ({sub_id})" if title else sub_id
        print(f"[{i}/{len(tasks)}] {label}")
        try:
            data = await intercept_subtitle(context, sub_id, course_id=course_id)
            json_path, srt_path, txt_path = save_subtitle(data, sub_id)
            print(f"  成功！共 {len(data)} 条字幕")
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

    get_parser = subparsers.add_parser("get", help="获取课程字幕")
    get_parser.add_argument("urls", nargs="*", help="课程链接（支持多个）")
    get_parser.add_argument("--all", action="store_true", help="批量导出整门课程所有课时字幕")
    get_parser.add_argument("--headless", action="store_true", help="无头模式运行（不显示浏览器窗口）")

    args = parser.parse_args()

    if args.command == "login":
        asyncio.run(cmd_login(args))
    elif args.command == "get":
        asyncio.run(cmd_get(args))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
