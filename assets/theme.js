/* Plutón — modo claro / oscuro.
   Script clásico y síncrono en <head>: fija data-theme en <html> antes del primer
   pintado, así no hay destello. Por defecto oscuro; la elección se guarda en una
   clave común a la serie, de modo que en GitHub Pages viaja de un proyecto a otro.

   Expone window.Pluton.theme { get, set, toggle } y emite "pluton:themechange"
   en document para lo que pinta colores desde JavaScript (canvas, escenas). */
(function () {
  "use strict";

  var Pluton = (window.Pluton = window.Pluton || {});
  var KEY = "pluton:theme";
  var root = document.documentElement;

  function valid(value) {
    return value === "light" || value === "dark";
  }

  function stored() {
    try {
      var value = window.localStorage.getItem(KEY);
      return valid(value) ? value : null;
    } catch (err) {
      return null;
    }
  }

  var current = stored() || "dark";
  root.setAttribute("data-theme", current);

  function syncControls() {
    var light = current === "light";
    var toggles = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < toggles.length; i++) {
      toggles[i].setAttribute("aria-checked", String(light));
      toggles[i].title = light ? "Cambiar a modo oscuro" : "Cambiar a modo claro";
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    var bg = window.getComputedStyle(root).getPropertyValue("--bg").trim();
    if (meta && bg) meta.setAttribute("content", bg);
  }

  function apply() {
    root.setAttribute("data-theme", current);
    syncControls();
    document.dispatchEvent(new CustomEvent("pluton:themechange", { detail: { theme: current } }));
  }

  function reducedMotion() {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function set(theme, options) {
    if (!valid(theme) || theme === current) return;
    current = theme;
    if (!options || options.persist !== false) {
      try {
        window.localStorage.setItem(KEY, theme);
      } catch (err) {
        /* almacenamiento no disponible: el tema vale para esta visita */
      }
    }
    // Fundido de toda la página donde el navegador lo ofrece; si no, cambio directo.
    if (typeof document.startViewTransition === "function" && !reducedMotion() && !document.hidden) {
      document.startViewTransition(apply);
    } else {
      apply();
    }
  }

  Pluton.theme = {
    get: function () {
      return current;
    },
    set: set,
    toggle: function () {
      set(current === "light" ? "dark" : "light");
    },
  };

  function isActivation(event) {
    return event.key === "Enter" || event.key === " ";
  }

  function bind() {
    var toggles = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < toggles.length; i++) {
      (function (button) {
        button.addEventListener("click", function (event) {
          // Clic de ratón o dedo (detail > 0): se suelta el foco para que el teclado
          // físico siga siendo del proyecto y no repita el interruptor.
          if (event.detail > 0) button.blur();
          Pluton.theme.toggle();
        });
        // Enter y Espacio sobre el interruptor son solo suyos: no deben llegar a los
        // atajos globales de cada proyecto (calcular, regenerar, pausar...).
        button.addEventListener("keydown", function (event) {
          if (isActivation(event)) event.stopPropagation();
        });
        button.addEventListener("keyup", function (event) {
          if (isActivation(event)) event.stopPropagation();
        });
      })(toggles[i]);
    }
    syncControls();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  // Otra pestaña de la serie cambió el tema: esta la sigue.
  window.addEventListener("storage", function (event) {
    if (event.key === KEY && valid(event.newValue)) set(event.newValue, { persist: false });
  });
})();
