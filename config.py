from pathlib import Path

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
OUTPUT_DIR = BASE_DIR / "output"
AUTH_STATE_FILE = DATA_DIR / "auth_state.json"

PORTAL_URL = "https://bbtxt.scut.edu.cn/learn/"
BASE_URL = "https://video.jw.scut.edu.cn"
COURSE_LIST_URL = BASE_URL
LIVINGROOM_URL = f"{BASE_URL}/livingroom"

SUBTITLE_API_PATH = "/courseapi/v3/web-socket/search-trans-result"
SUBTITLE_URL_PATTERN = "search-trans-result"

LOGIN_TIMEOUT = 120_000
SUBTITLE_TIMEOUT = 60_000
