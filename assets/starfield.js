/* Plutón — campo de estrellas sutil con titileo.
   Script clásico (funciona con file://). Se inicia solo al cargar; expone
   window.Pluton.starfield y window.Pluton.reducedMotion para el resto del proyecto.

   Las estrellas fijas se pintan una vez en un canvas; solo unas pocas titilan,
   y lo hacen animando opacity con CSS, así que no hay bucle de dibujo. */
(function () {
  "use strict";

  var Pluton = (window.Pluton = window.Pluton || {});

  var motionQuery =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : { matches: false };

  Pluton.reducedMotion = function () {
    return motionQuery.matches;
  };

  // PRNG con semilla: el cielo es el mismo en cada carga.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  Pluton.random = mulberry32;

  Pluton.starfield = function (options) {
    var opts = options || {};
    var seed = opts.seed || 1930; // año del descubrimiento de Plutón
    var density = opts.density || 1;
    var host = opts.host || document.body;

    var root = document.createElement("div");
    root.className = "starfield";
    root.setAttribute("aria-hidden", "true");

    var canvas = document.createElement("canvas");
    root.appendChild(canvas);
    host.insertBefore(root, host.firstChild);

    var twinklers = [];

    function paint() {
      var w = root.clientWidth || window.innerWidth;
      var h = root.clientHeight || window.innerHeight;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var rand = mulberry32(seed);
      var count = Math.round(Math.min(260, (w * h) / 7000) * density);

      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);

      var ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Los colores salen de los tokens: en modo claro las estrellas son tinta sobre papel.
      var css = window.getComputedStyle(document.documentElement);
      var plain = css.getPropertyValue("--star").trim() || "#e6edf3";
      var warm = css.getPropertyValue("--star-warm").trim() || "#c9a27e";
      var cold = css.getPropertyValue("--star-cold").trim() || "#9cc7ff";

      for (var i = 0; i < count; i++) {
        var x = rand() * w;
        var y = rand() * h;
        var size = rand();
        var r = size < 0.86 ? 0.5 + rand() * 0.4 : 0.9 + rand() * 0.6;
        var tone = rand();
        ctx.globalAlpha = 0.16 + rand() * 0.42;
        ctx.fillStyle = tone < 0.12 ? warm : tone < 0.24 ? cold : plain;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Estrellas que titilan: pocas, en posiciones relativas para sobrevivir al resize.
      if (!twinklers.length) {
        var total = Math.round(Math.min(34, 10 + count / 8));
        for (var k = 0; k < total; k++) {
          var star = document.createElement("i");
          var d = 1 + Math.round(rand() * 1.4);
          star.style.left = (rand() * 100).toFixed(2) + "%";
          star.style.top = (rand() * 100).toFixed(2) + "%";
          star.style.width = d + "px";
          star.style.height = d + "px";
          star.style.setProperty("--twinkle", (3.2 + rand() * 4.8).toFixed(2) + "s");
          star.style.setProperty("--delay", (-rand() * 8).toFixed(2) + "s");
          root.appendChild(star);
          twinklers.push(star);
        }
      }
    }

    var pending = 0;
    function onResize() {
      window.clearTimeout(pending);
      pending = window.setTimeout(paint, 150);
    }

    paint();
    window.addEventListener("resize", onResize);
    document.addEventListener("pluton:themechange", paint);

    return {
      element: root,
      repaint: paint,
      destroy: function () {
        window.removeEventListener("resize", onResize);
        document.removeEventListener("pluton:themechange", paint);
        window.clearTimeout(pending);
        if (root.parentNode) root.parentNode.removeChild(root);
      },
    };
  };

  function autostart() {
    if (!document.body || document.body.getAttribute("data-starfield") === "off") return;
    if (document.querySelector(".starfield")) return;
    Pluton.sky = Pluton.starfield({
      density: Number(document.body.getAttribute("data-starfield-density")) || 1,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autostart);
  } else {
    autostart();
  }
})();
