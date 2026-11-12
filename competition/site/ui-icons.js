/* 从 extension/ui.js 摘出的纯展示层：内联 SVG 图标 + favicon。
 * 不含 chrome.* API、不含任何网络请求，也不接管页面导航。 */
(function () {
  "use strict";
  var paths = {
    book: '<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zM13 7a3 3 0 0 1 3-3h5v15h-4a4 4 0 0 0-4 2"/>',
    grid: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
    wave: '<path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4"/>',
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4M18 4h4"/>',
    settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="8" cy="18" r="2" fill="currentColor"/>',
    arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
    link: '<path d="m10 7 2-2a5 5 0 0 1 7 7l-2 2M14 17l-2 2a5 5 0 0 1-7-7l2-2M8 16l8-8"/>',
    paperclip: '<path d="m21 11-8.5 8.5a5 5 0 0 1-7.1-7.1l9.2-9.2a3.5 3.5 0 0 1 5 5l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
    shield: '<path d="m12 3 8 3v6c0 4-5 8-8 9-3-1-8-5-8-9V6zM8 12l3 3 5-6"/>',
    folder: '<path d="M3 7V5h7l2 3h9v12H3z"/>',
    play: '<path d="m8 4 12 8-12 8z"/>',
    refresh: '<path d="M20 7V3M20 7h-4M20 7a9 9 0 1 0 1 8"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M12 17h.01"/>',
    check: '<path d="m5 12 4 4L20 5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>'
  };
  function icons(root) {
    (root || document).querySelectorAll("[data-icon]").forEach(function (target) {
      var name = target.getAttribute("data-icon");
      if (!paths[name]) return;
      target.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + paths[name] + "</svg>";
    });
  }
  icons(document);
  var favicon = document.createElement("link");
  favicon.rel = "icon";
  favicon.type = "image/png";
  favicon.href = "brand.png";
  document.head.appendChild(favicon);
  window.BuxueIcons = icons;
})();
