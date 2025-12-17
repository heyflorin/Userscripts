// ==UserScript==
// @name         Zoom Fix
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Fix Zoom
// @author       You
// @match        https://app.jetkvm.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  function changeViewPort(key, val) {
    var reg = new RegExp(key, "i"), oldval = document.querySelector('meta[name="viewport"]').content;
    var newval = reg.test(oldval) ? oldval.split(/,\s*/).map(function (v) { return reg.test(v) ? key + "=" + val : v; }).join(", ") : oldval += ", " + key + "=" + val;
    document.querySelector('meta[name="viewport"]').content = newval;
  }

  if (/iPad|iPhone|iPod|Android/i.test(navigator.userAgent)) {
    window.addEventListener("orientationchange", function () {
      changeViewPort("maximum-scale", 1);
      changeViewPort("maximum-scale", 10);
    })
  }

})();
