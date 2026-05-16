import asyncio
import re

from playwright.async_api import async_playwright, Browser, BrowserContext

from config import (
    BASE_URL,
    COURSE_LIST_URL,
    LIVINGROOM_URL,
    LOGIN_TIMEOUT,
    PORTAL_URL,
    SUBTITLE_TIMEOUT,
    SUBTITLE_URL_PATTERN,
)
from auth import save_auth, get_auth_path


def _extract_list(body) -> list[dict] | None:
    """从 JSON 响应中提取字幕列表，支持多层嵌套。"""
    if isinstance(body, list):
        # 如果每个元素都有 BeginSec/Text，直接就是字幕列表
        if body and isinstance(body[0], dict) and "BeginSec" in body[0]:
            return body
        # 尝试从包装对象中提取
        for item in body:
            if isinstance(item, dict):
                inner = _extract_list(item)
                if inner:
                    return inner
        return body
    if isinstance(body, dict):
        for key in ("all_content", "data", "result", "list", "rows"):
            val = body.get(key)
            if isinstance(val, list) and val:
                return _extract_list(val)
    return None


async def create_browser(headless: bool = False) -> tuple[Browser, BrowserContext]:
    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=headless)

    auth_path = get_auth_path()
    if auth_path:
        context = await browser.new_context(storage_state=auth_path)
    else:
        context = await browser.new_context()

    return browser, context


async def do_login(context: BrowserContext):
    page = await context.new_page()
    # 访问华园视频首页，未登录会自动跳转到学校统一认证（含二维码）
    await page.goto(BASE_URL)
    print("请在弹出的浏览器窗口中扫码登录...")
    print(f"等待登录完成（超时 {LOGIN_TIMEOUT // 1000} 秒）")

    try:
        # 登录成功后最终会回到 video.jw.scut.edu.cn 下的页面
        await page.wait_for_url(f"{BASE_URL}/**", timeout=LOGIN_TIMEOUT)
        # 额外等待页面完全加载
        await page.wait_for_load_state("networkidle")
        print("登录成功！")
        await save_auth(context)
        print("登录状态已保存。")
    except Exception:
        print("登录超时，请重试。")
        raise
    finally:
        await page.close()


async def intercept_subtitle(
    context: BrowserContext,
    sub_id: str,
    course_id: str | None = None,
    tenant_code: str = "21",
    timeout: int = SUBTITLE_TIMEOUT,
) -> list[dict]:
    page = await context.new_page()
    subtitle_data: list[dict] | None = None

    async def handle_response(response):
        nonlocal subtitle_data
        if SUBTITLE_URL_PATTERN in response.url and response.status == 200:
            try:
                body = await response.json()
                items = _extract_list(body)
                if items:
                    subtitle_data = items
            except Exception:
                pass

    page.on("response", handle_response)

    if course_id:
        play_url = f"{LIVINGROOM_URL}?course_id={course_id}&sub_id={sub_id}&tenant_code={tenant_code}"
    else:
        play_url = f"{LIVINGROOM_URL}?sub_id={sub_id}&tenant_code={tenant_code}"

    await page.goto(play_url, wait_until="networkidle")

    elapsed = 0
    interval = 1
    while subtitle_data is None and elapsed < timeout / 1000:
        await asyncio.sleep(interval)
        elapsed += interval

    await page.close()

    if subtitle_data is None:
        raise RuntimeError(f"未能拦截到课程 {sub_id} 的字幕数据（超时 {timeout // 1000}s）")

    return subtitle_data


async def get_course_list(context: BrowserContext) -> list[dict]:
    page = await context.new_page()
    courses: list[dict] = []

    async def handle_response(response):
        if response.status != 200:
            return
        url = response.url
        if "courseapi" in url or "courselist" in url:
            try:
                body = await response.json()
                if isinstance(body, list):
                    courses.extend(body)
                elif isinstance(body, dict):
                    for key in ("data", "result", "list", "rows", "courses"):
                        if key in body and isinstance(body[key], list):
                            courses.extend(body[key])
                            break
            except Exception:
                pass

    page.on("response", handle_response)
    await page.goto(COURSE_LIST_URL, wait_until="networkidle")
    await asyncio.sleep(3)
    await page.close()

    if not courses:
        page2 = await context.new_page()
        await page2.goto(COURSE_LIST_URL, wait_until="networkidle")
        items = await page2.query_selector_all("a[href*='sub_id'], a[href*='course_id']")
        for item in items:
            href = await item.get_attribute("href") or ""
            text = (await item.inner_text()).strip()
            sub_match = re.search(r"sub_id=(\d+)", href)
            course_match = re.search(r"course_id=(\d+)", href)
            if sub_match:
                entry = {"sub_id": sub_match.group(1), "name": text}
                if course_match:
                    entry["course_id"] = course_match.group(1)
                courses.append(entry)
        await page2.close()

    return courses
