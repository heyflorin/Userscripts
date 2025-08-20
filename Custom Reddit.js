// ==UserScript==
// @name         Custom Reddit
// @version      0.1
// @description  My custom Reddit tweaks
// @author       Florin Catalin Mehedinti
// @run-at       document-start
// @match        https://www.reddit.com/*
// @grant        GM.addStyle
// ==/UserScript==

(function () {
  // 1) Hide ASAP to avoid flash
  const HIDE_ID = 'us-hide-until-styled';
  const hide = document.createElement('style');
  hide.id = HIDE_ID;
  hide.textContent = 'html{visibility:hidden !important;}';
  // Use <html> if <head> not ready yet
  (document.head || document.documentElement).appendChild(hide);

  // 2) GM_addStyle wrapper with fallback
  const addCSS = (css) => {
    if (typeof GM_addStyle === 'function') { GM_addStyle(css); return; }
    if (typeof GM !== 'undefined' && typeof GM.addStyle === 'function') { GM.addStyle(css); return; }
    const s = document.createElement('style'); s.textContent = css;
    document.head.appendChild(s);
  };

  // 3) Your CSS (inline here; or assemble dynamically)
  const CSS = `
  
/* Florin's Edits */

.content > .sitetable {
    background-color: red !important;
}

a {
    color: rgb(58, 58, 58) !important;
    font-weight: 500;
    transition: filter 0.5s ease-in;
}

.top-matter .title {
    font-weight: normal !important;
}

.title a:hover {
    color: rgb(92,92,92) !important;
    text-decoration: underline !important;
}

a:active,
a:focus {
    color: rgb(65, 96, 125) !important;
    filter: brightness(1) !important;

}

.search-result-group .contents {
    overflow: hidden !important;
}

.thing.link:not(.thing.last-clicked) {
    /*             border-bottom: 1px #181818 solid !important; */
    border-bottom: 1px #e0e0e0 solid !important;
}

.midcol {
    /*             border-right: 1px #181818 solid !important; */
    border-right: 1px #e0e0e0 solid !important;
}

.pinnable-placeholder .pinnable-content * {
    border: none !important;
}

.thing.link:first-child {
    padding-top: 20px !important;
}

.link.last-clicked {
    border-color: #e0e0e0 !important;
    border-style: solid !important;
    border-top: none !important;
    border-left: none !important;
    border-right: none !important;
}

.link.last-clicked * {
    filter: blur(1px);
    transition: filter .3s ease-in;
}

.link.last-clicked:hover * {
    filter: blur(0px);
}


.link.hidden * {
    filter: blur(1px);
    transition: filter .3s ease-in;
    opacity: 1 !important;
}

.link {
    opacity: 1 !important;
}

.hidden {
    opacity: 1 !important;
}

.link.hidden:hover * {
    filter: blur(0px);
}

.side .spacer:first-child {
    display: block !important;
    max-height: 50px !important;
    min-height: 50px !important;
}

.side {
    position: fixed !important;
    top: 0px !important;
    right: calc(50% - 165px) !important;
    background: transparent !important;
    z-index: 99 !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    background-color: transparent !important;
    height: auto !important;
}

.side .spacer {
    padding-top: 0px !important;
    margin-top: 0px !important;
}

.content {
    margin-top: 0px !important;
    padding-top: 0px !important;
}

.comments-page .content {
    margin-left: 0px !important;
    margin-right: 0px !important;
}

.content:first-child {
    padding-top: 10px !important;
}

#header-img {
    max-width: 32px !important;
    margin-left: 10px !important;
    margin-top: 8px !important;
    zoom: 0.7 !important;
}

.listing-chooser .global {
    margin-right: -15px !important;
    border: none !important;
}

.listing-chooser .global .selected {
    padding-right: 0px !important;
    margin-right: 0px !important;
}

.searchpane,
.infobar {
    width: calc(100% - 125px) !important;
    overflow: hidden !important;
    margin: 0 auto !important;
}

.infobar {
    font-size: 0.85rem !important;
    margin-top: 0px !important;
    margin-bottom: 15px !important;
    border-radius: 0px 0px 10px 10px !important;
    border-top: none !important;
}

.searchpane {
    position: sticky !important;
    top: 62.5px !important;
    border-radius: 0px 0px 10px 10px !important;
    border-top: none !important;
}

#header {
    position: sticky !important;
    top: 0 !important;
    font-size: 0.6rem !important;
    background-color: rgba(0, 0, 0, 0.293) !important;
    border-bottom-color: #c4c4c4 !important;
}

#header div {
    /*             background-color: rgba(36, 36, 36, 0.773) !important; */
    background-color: rgba(233, 233, 233, 0.77) !important;
    backdrop-filter: blur(3px) !important;
}

#header div:nth-child(2) {
    border: none !important;
}

#sr-header-area div {
    /*             background: rgb(24, 23, 23) !important; */
    background: rgb(254, 254, 254) !important;
}

.pagename.redditname {
    margin-left: 13px !important;
}

.thing.link {
    display: flex !important;
    flex-direction: row !important;
    margin: 0px !important;
    padding-top: 5px !important;
    padding-bottom: 5px !important;
}

.thing.link img,
.thing.link .thumbnail {
    min-width: 70px !important;
    overflow: visible !important;
    min-height: 70px !important;
    max-width: 70px !important;
    max-height: 70px !important;
    object-fit: cover !important;
    object-position: top !important;
    border-radius: 5px !important;
}

.thing.link div img {
    width: 100% !important;
    height: 100% !important;
    max-width: calc(100dvw - 20%) !important;
    max-height: 100% !important;
    border-radius: 0 !important;
}

.midcol {
    min-width: 40px !important;
    max-width: 40px !important;
    display: flex !important;
    justify-content: center !important;
    flex-direction: column !important;
    margin-left: 0px !important;
    padding-left: 0px !important;
    height: auto !important;
}

.midcol .score {
    padding: 1px;
    font-size: calc(100% - 4px) !important;
}

.midcol .arrow {
    padding: 0px !important;
    zoom: .8 !important;
}

.grippy {
    background-color: transparent !important;
    background-image: none !important;
    border: none !important;
    height: 75px !important;
    margin-top: 0px !important;
    z-index: 555 !important;
    box-shadow: none !important;
    transition: none !important;
    width: 30px !important;
}

.grippy:hover:after,
.grippy:hover:before {
    background: transparent !important;
    display: none !important;
}

.thing.link .duration-overlay {
    height: auto !important;
    position: relative !important;
    top: -12px !important;
    left: 0px !important;
    border-radius: 0 0 5px 5px !important;
}

.reddit-video-player-root img {
    min-height: 16px !important;
    min-width: 16px !important;
}

.pinnable-placeholder .pinnable-content,
.comments-page .pinnable-placeholder .pinnable-content.pinned {
    background-color: #1a1919 !important;
    width: 100dvw !important;
    border-radius: 0 0 10px 10px !important;
}

.comments-page .pinnable-placeholder .pinnable-content {
    width: auto !important;
}

.pinnable-placeholder .pinnable-content div div div div {
    border-radius: 10px !important;
}

.pinnable-placeholder .pinnable-content * {
    border: none !important;
}

.pinnable-placeholder .pinnable-content.pinned div img {
    max-width: 30px !important;
    object-fit: fill !important;
}

.thumbnail.self {
    filter: brightness(0.5) contrast(3) !important;
    min-height: 51px !important;
}

.listing-chooser {
    position: fixed !important;
    overflow-y: scroll !important;
    overflow-x: hidden !important;
    overscroll-behavior: none !important;
    text-align: right !important;
    display: flex !important;
    flex-direction: column !important;
}

html,
body {
    overscroll-behavior: none !important;
}

.global {
    z-index: 5555 !important;
}

.global li.selected::before {
    margin-right: 3px !important;
}

.listing-chooser .contents .multis,
.listing-chooser .contents .other {
    flex-grow: 1 !important;
    margin-right: -15px !important;
    overflow: visible !important;
}

.listing-chooser.initialized {
    border-right-style: solid !important;
    border-width: 0.9px !important;
    border-color: #c4c4c4 !important;
}

.listing-chooser-collapsed .content {
    margin-left: 35px !important
}

.listing-chooser-collapsed .listing-chooser.initialized {
    width: 15px !important;
}

.listing-chooser-collapsed .listing-chooser a {
    visibility: hidden !important;
}

.listing-chooser-collapsed .listing-chooser .contents .multis,
.listing-chooser-collapsed .listing-chooser .contents .other {
    filter: brightness(.82) blur(5px) !important;
    transition: filter 2s !important;
    pointer-events: none !important;
}

.listing-chooser-collapsed .listing-chooser {
    background: rgba(0, 0, 0, 0.26) !important;
    transition: background 1s !important;
    overflow: hidden !important;
}

body.with-listing-chooser.listing-chooser-collapsed .listing-chooser .grippy {
    width: 100% !important;
}

body.with-listing-chooser.listing-chooser-collapsed .listing-chooser .grippy {
    width: 100% !important;
}

.drop-choices.srdrop.inuse {
    top: 54.5px !important;
    border-top: none !important;
}

.listing-chooser {
    /* background: black !important; */
    font-size: 0.6rem !important;
    margin-top: -2.5px !important;
}

#sr-header-area .sr-list {
    overflow: auto !important;
    margin-right: 25px !important;
    padding-right: 20px !important;
    scrollbar-width: none !important;
}

#sr-more-link {
    padding-left: 5px !important;
}

#header-bottom-right #mail,
#header-bottom-right #notifications,
#header-bottom-right #chat-v2 {
    zoom: .6 !important;
}

.listing-chooser li.selected {
    margin-right: -14px !important;
}

.global li {
    position: relative !important;
    z-index: 35 !important;
}

.global li:before,
.global li.selected::before {
    position: absolute !important;
    top: 50% !important;
    right: 0 !important;
    margin-top: -5px !important;
    margin-right: 9px !important;
    display: block !important;
    content: '' !important;
    border: 5px solid transparent !important;
    border-style: solid solid outset !important;
    border-left-color: #79a6d2 !important;

}

.global li:before {
    transform: rotateY(3.142rad) !important;
    transition: transform .3s !important;
}

.listing-chooser-collapsed .global li:before {
    transform: rotateY(0) !important;
    margin-right: 3px !important;
}

.drop-choices.srdrop.inuse {
    border-color: #c4c4c4 !important;
    height: calc(100dvh - 55px) !important;
    overflow-y: scroll !important;
    overflow-x: hidden !important;
    ;
}

.sr-list {
    margin-left: 0px !important;
    padding-left: 10px !important;
}

#header-bottom-left {
    padding-top: 25px !important;
}

.tabmenu a {
    background: red;
    border-radius: 3px 3px 0 0 !important;
}

.tabmenu li.selected a {

    border-bottom: initial !important;
}

.tabmenu,
#header {
    border-width: .9px !important;
}

.listing-chooser {
    background-color: rgb(224, 223, 223) !important;
}

.listing-chooser.initialized a {
    text-wrap: nowrap !important;
}

.dismiss-pinnable.c-close.c-hide-text {
    filter: brightness(3)
}

.dismiss-pinnable.c-close.c-hide-text {
    filter: brightness(4) !important;
}

.reddit-video-controller-root img,
.reddit-video-controller-root svg {
    zoom: 0.27;
}

.reddit-video-controller-root .pinned img,
.reddit-video-controller-root .pinned svg {
    zoom: 0.7;
}

.interstitial-controls.hide-when-pinned.reddit-video-controller-root .play-pause {
    width: 24px !important;
    zoom: initial !important;
}

.pinned .thing .midcol {
    margin-top: 5px !important;
}

.commentarea * {
    border-width: 0.9px !important;
}

.noncollapsed.morechildren {
    margin-left: 8px !important;
}

.tagline {
    text-wrap: nowrap !important;

}

.tagline a.author {
    margin-right: 0px !important;
}

.flat-list.buttons :not(:first-child) {
    padding-right: 10px !important;
    padding-left: 10px !important;
    padding-bottom: 2px !important;
    border-left: solid !important;
    border-width: .9px !important;
    border-color: #ccc !important;
    font-weight: normal !important;
}

.top-matter .title {
    margin-bottom: 5px !important;
}

.flat-list.buttons :not(:first-child) a {
    font-weight: normal !important;
}

.live-timestamp {
    font-weight: bold !important;
}

.nav-buttons {
    margin-top: 10px !important;
}

body.with-listing-chooser #header .pagename {
    bottom: 23px !important;
}

.hidden-post-placeholder {
    margin-bottom: 0px !important;
    border-top: none !important;
    border-right: none !important;
    border-left: none !important;
    background-color: rgba(208, 208, 208, 0.12) !important;
    border-bottom: 0.9px solid #e0e0e0 !important;
}

.hidden-post-placeholder div {
    text-transform: lowercase !important;
    color: gray !important;
}

.subreddits-page .subreddit {
    display: flex !important;
    flex-direction: row !important;
    align-items: start !important;

}

.subreddits-page .midcol {
    min-width: 90px !important;
    display: block !important;
    padding-right: 12px !important;
    margin-right: 10px !important;
}

.media-preview {
    max-width: 70dvw !important;
    max-height: 70dvh !important;
    scrollbar-width: none !important;
}

.sidebox.submit.submit-link {
    display: none !important;
    ;
}

.search-age .searchpane {
    position: sticky !important;
    top: 62.5px !important;
    border-radius: 0px 0px 10px 10px !important;
    border-top: none !important;
}

.search-page .searchpane.raisedbox {
    top: 61px !important;
    background: #e0e0e0 url(../search-large.png) 26px center no-repeat !important;
    ;
    z-index: 99 !important;
    ;
}

.listing.search-result-listing {
    margin-top: 25px;
}

.search-result.search-result-link.has-thumbnail.has-linkflair .thumbnail,
.search-page .thumbnail img {
    min-width: 70px !important;
    overflow: visible !important;
    min-height: 70px !important;
    max-width: 70px !important;
    max-height: 70px !important;
    object-fit: cover !important;
    object-position: top !important;
    border-radius: 5px !important;
}

.search-page .duration-overlay {
    height: auto !important;
    position: relative !important;
    top: -12px !important;
    left: 0px !important;
    border-radius: 0 0 5px 5px !important;
}

.combined-search-page.search-page .searchpane {
    position: sticky !important;
    margin-left: 0px !important;
    margin-right: 0px !important;
    top: 60.5px !important;
    width: calc(100% - 65px) !important;
    overflow: hidden !important;
    margin: 0 auto !important;
    border: 1px solid gray !important;
    border-top: none !important;

}

.search-page .search-result {
    margin-bottom: 15px !important;
}

.search-result-group {
    max-width: 100% !important;
}

#searchexpando.infobar {
    font-size: .65rem !important;
    width: calc(100% - 24px) !important;
    padding-left: 5px !important;
    padding-right: 5px !important;
    padding-top: 0px !important;
    padding-bottom: 0px !important;
    margin: 0px !important;
    margin-left: 6px !important;
}

#searchexpando label {
    position: relative !important;
    display: flex !important;
    flex-direction: row !important;
    height: auto !important;
    padding-top: 5px;
    padding-bottom: 2px;
}

#searchexpando label {
    margin-bottom: 3px !important;
}

#searchexpando label input {
    margin-left: 0px !important;
    margin-right: 5px !important;
    min-width: 12px !important;
    max-width: 12px !important;
    max-height: 12px !important;
    margin-bottom: 0px !important;
    margin-top: 0px !important;
}

.side #search,
.subreddits-page #search,
.side #search input:first-child[type=text] {
    width: 250px !important;
    overflow: hidden !important;
}

.side #search input:first-child[type=text] {
    transition:
        padding 0.16s ease-in-out,
        height 0.16s ease-in-out;
    padding-top: 3px !important;
    height: 29px !important;
}

.side #search input:first-child[type=text]:hover {
    padding-top: 13px !important;
    height: 38px !important;
}

.search-page #search,
.subreddits-page #search {
    width: initial !important;
    overflow: initial !important;
}

#search input:focus {
    outline-offset: -4px !important;
    outline-width: .5px !important;
    outline-style: none !important;
    outline-color: #c4c4c4 !important;
}

#search input {
    border-radius: 0 0 8px 8px !important;
    border-top: none !important;
    border-width: 1px !important;
    border-color: #c4c4c4 !important;
    font-size: .65rem !important;
}

.search-page #search input,
.subreddits-page #search input {
    border-radius: 8px 8px 8px 8px !important;
    border-bottom: 1px solid #c4c4c4 !important;
    border-color: #c4c4c4 !important;
}

input[type="submit"] {
    margin-left: 5px !important;
    border: 1px solid !important;
    padding: 14px !important;
    background-position: 7px 7px !important;
}

.search-page #search input[type="submit"],
.subreddits-page #search input[type="submit"] {
    margin-left: -26px !important;
    border-bottom: none !important;
    border-color: transparent !important;
    border-radius: 100% !important;
    padding: 11px !important;
    background-position: 4px 4px !important;
    box-shadow: none !important;
    display: none;
}

/* Consolidated hides (none) */
#sr-header-area .sr-list::-webkit-scrollbar {
    display: none;
}

.media-preview::-webkit-scrollbar {
    display: none;
}

/* Consolidated hides (none!important) */
#searchexpando,
.bottommenu.debuginfo,
#discussions,
#contributors,
.report-button,
.crosspost-button,
.side .spacer,
.side .titlebox,
.rank,
#redesign-beta-optin-btn,
body.with-listing-chooser .listing-chooser .grippy:after,
body.with-listing-chooser.listing-chooser-collapsed .listing-chooser .grippy:after,
.reddit-video-player-root div div:nth-child(6) div:first-child img,
.listing-chooser .contents h3,
.dropdown.srdrop,
#header-img,
.footer-parent,
.hidden-post-placeholder,
.sidebox .create,
.sidebox .morelink,
#searchexpando p {
    display: none !important;
}

  `;

  // 4) Run early AND also after DOM is ready (covers both timings)
  // Early pass (document-start)
  addCSS(CSS);

  const reveal = () => {
    // Give the browser a tick to apply styles before reveal
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(HIDE_ID);
        if (el) el.remove();
      });
    });
  };

  // If DOM is already interactive/complete, reveal now; else wait
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Optional: add more late CSS here if needed
      // addCSS(moreCSS);
      reveal();
    });
    // Safety: if something delays DOMContentLoaded, still reveal at window load
    window.addEventListener('load', reveal, { once: true });
  } else {
    reveal();
  }
})();
