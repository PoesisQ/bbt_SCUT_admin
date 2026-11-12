"""Rebuild the public lecture vectors with the same browser model as the site."""

import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright


SITE = Path(__file__).resolve().parent


def build_vectors():
    handler = partial(SimpleHTTPRequestHandler, directory=str(SITE))
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(channel="msedge")
                page = browser.new_page()
                page.goto(f"http://127.0.0.1:{server.server_port}/")
                index = page.evaluate("""async () => {
                    const { embed, modelVersion } = await import('./embeddings.js');
                    const chunks = BuxueRetrieval.buildIndex(BUXUE_CORPUS).chunks.filter(chunk => !chunk.notice);
                    const vectors = await embed(chunks.map(chunk => chunk.text));
                    const rows = chunks.map(({ id, text }, i) => ({ id, text, vector: vectors[i] }));
                    return { modelVersion, rows };
                }""")
                browser.close()
        finally:
            server.shutdown()

    for row in index["rows"]:
        row["vector"] = [round(value, 7) for value in row["vector"]]
    output = SITE / "data" / "vectors.json"
    output.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(index['rows'])} embeddings written to {output}")


if __name__ == "__main__":
    build_vectors()
