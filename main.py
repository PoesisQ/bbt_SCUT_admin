import argparse
import asyncio

from auth import is_logged_in
from browser import create_browser, do_login, intercept_subtitle, get_course_list
from subtitle import save_subtitle


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

    browser, context = await create_browser(headless=args.headless)

    sub_ids = args.sub_ids or []

    if args.all:
        print("正在获取课程列表...")
        courses = await get_course_list(context)
        sub_ids = [c.get("sub_id", c.get("id")) for c in courses if c.get("sub_id") or c.get("id")]
        print(f"共 {len(sub_ids)} 门课程")

    if not sub_ids:
        print("请指定 sub_id 或使用 --all")
        await context.close()
        await browser.close()
        return

    success = 0
    failed = 0
    for i, sub_id in enumerate(sub_ids, 1):
        print(f"[{i}/{len(sub_ids)}] 正在获取课程 {sub_id} 的字幕...")
        try:
            data = await intercept_subtitle(context, sub_id, course_id=args.course_id)
            json_path, srt_path = save_subtitle(data, sub_id)
            print(f"  成功！共 {len(data)} 条字幕")
            print(f"  JSON: {json_path}")
            print(f"  SRT:  {srt_path}")
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
    get_parser.add_argument("sub_ids", nargs="*", help="课程 sub_id（支持多个）")
    get_parser.add_argument("--all", action="store_true", help="获取所有课程字幕")
    get_parser.add_argument("--course-id", help="course_id 参数（部分课程必须）")
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
