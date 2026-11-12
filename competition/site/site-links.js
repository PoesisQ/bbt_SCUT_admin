globalThis.BuxueLinks = (() => {
  const sharecode = new URLSearchParams(location.search).get("sharecode");

  function url(path, parameters = {}) {
    const target = new URL(path, location.href);
    if (sharecode) target.searchParams.set("sharecode", sharecode);
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== "" && value != null) target.searchParams.set(key, value);
    }
    return target.href;
  }

  for (const link of document.querySelectorAll("a[data-share-link]")) {
    link.href = url(link.getAttribute("href"));
  }
  return { url };
})();
