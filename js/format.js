/* Formato de los datos de telemetría: coma decimal, signo menos tipográfico
   y unidades reales (km, km/s, minutos, horas). */
(function (root) {
  "use strict";

  var App = (root.OrbitSandbox = root.OrbitSandbox || {});
  var NBSP = " ";

  function num(value, digits) {
    var text = Math.abs(value).toFixed(digits);
    // El cero redondeado no lleva signo: "−0,000" no dice nada.
    var negative = value < 0 && Number(text) !== 0;
    return (negative ? "−" : "") + text.replace(".", ",");
  }

  // Enteros con separador de millares a partir de cinco cifras, como pide el español.
  function integer(value) {
    var rounded = Math.round(Math.abs(value));
    var text = String(rounded);
    if (rounded >= 10000) text = text.replace(/\B(?=(\d{3})+$)/g, NBSP);
    return (value < 0 && rounded !== 0 ? "−" : "") + text;
  }

  function km(value) {
    if (!isFinite(value)) return "∞";
    if (Math.abs(value) >= 1e6) return num(value / 1e6, 1) + NBSP + "mill. km";
    return integer(value) + NBSP + "km";
  }

  function speed(value, digits) {
    return num(value, digits === undefined ? 3 : digits) + NBSP + "km/s";
  }

  function duration(seconds) {
    if (!isFinite(seconds)) return "—";
    var minutes = Math.round(seconds / 60);
    if (minutes < 90) return minutes + NBSP + "min";
    if (minutes < 48 * 60) return Math.floor(minutes / 60) + NBSP + "h " + (minutes % 60) + NBSP + "min";
    var days = seconds / 86400;
    if (days < 365.25) return num(days, 1) + NBSP + "d";
    var years = days / 365.25;
    return years < 1e4 ? num(years, 1) + NBSP + "años" : "> 10" + NBSP + "000 años";
  }

  function satName(n) {
    return "SAT-" + (n < 10 ? "0" : "") + n;
  }

  App.fmt = {
    num: num,
    integer: integer,
    km: km,
    speed: speed,
    duration: duration,
    satName: satName,
    kinds: { orbit: "órbita", impact: "impacto", escape: "escape" },
  };
})(typeof window !== "undefined" ? window : globalThis);
