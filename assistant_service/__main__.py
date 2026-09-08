import argparse
import webbrowser

import uvicorn

from .app import create_app
from .settings import Settings


def main():
    parser = argparse.ArgumentParser(description="启动本机 SCUT 学习助手")
    parser.add_argument("--open", action="store_true", help="打开本地学习面板并填入连接口令")
    args = parser.parse_args()
    settings = Settings()
    if args.open:
        webbrowser.open("http://127.0.0.1:8765/#token=" + settings.data["token"])
    print("SCUT 本地服务：http://127.0.0.1:8765")
    print("扩展连接口令保存在：" + str(settings.root / "connection.txt"))
    uvicorn.run(create_app(settings), host="127.0.0.1", port=8765, access_log=False)


if __name__ == "__main__":
    main()
