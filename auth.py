from pathlib import Path

from config import AUTH_STATE_FILE, DATA_DIR


def ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def is_logged_in() -> bool:
    return AUTH_STATE_FILE.exists() and AUTH_STATE_FILE.stat().st_size > 0


async def save_auth(context):
    ensure_data_dir()
    await context.storage_state(path=str(AUTH_STATE_FILE))


def get_auth_path() -> str | None:
    if is_logged_in():
        return str(AUTH_STATE_FILE)
    return None
