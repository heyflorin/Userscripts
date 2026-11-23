// ==UserScript==
// @name            PaywallPassPlus
// @name:de         PaywallPassPlus
// @version         0.2.1
// @description     redirect to archive.is
// @description:de  Weiterleitung zu archive.is
// @icon            https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/Hybrid_Access_logo_alternative.svg/250px-Hybrid_Access_logo_alternative.svg.png
// @author          magotar
// @license         GPL-3.0-or-later

// @match           https://www.bazonline.ch/*
// @match           https://www.nzz.ch/*


// @match           https://www.abendblatt.de/*
// @match           https://rp-online.de/*
// @match           https://ga.de/*
// @match           https://www.heise.de/*
// @match           https://www.bild.de/*
// @match           https://www.badische-zeitung.de/*
// @match           https://www.spiegel.de/*
// @match           https://www.waz.de/*
// @match           https://www.zeit.de/*
// @match           https://www.berliner-zeitung.de/*
// @match           https://www.welt.de/*
// @match           https://www.freitag.de/*
// @match           https://www.faz.net/*
// @match           https://m.faz.net/*
// @match           https://www.sueddeutsche.de/*
// @match           https://sz-magazin.sueddeutsche.de/*
// @match           https://www.tagesspiegel.de/*

// @match           https://www.zerohedge.com/*
// @match           https://nytimes.com/*
// @match           https://www.nytimes.com/*


// @match           https://archive.today/*
// @match           https://archive.ph/*
// @match           https://archive.is/*
// @match           https://archive.fo/*
// @match           https://archive.li/*
// @match           https://archive.md/*
// @match           https://archive.vn/*
// @grant           GM.registerMenuCommand
// @grant           GM.xmlHttpRequest
// @connect         archive.today
// @connect         archive.ph
// @connect         archive.is
// @connect         archive.fo
// @connect         archive.li
// @connect         archive.md
// @connect         archive.vn
// @namespace https://greasyfork.org/users/1580381
// @downloadURL https://update.greasyfork.org/scripts/569764/PaywallPassPlus.user.js
// @updateURL https://update.greasyfork.org/scripts/569764/PaywallPassPlus.meta.js
// ==/UserScript==

/* global GM */
/* jshint asi: true, esversion: 8 */

(async function () {
  'use strict'

  const scriptName = 'PaywallPassPlus'

  const hostnames = [
    'archive.is',
    'archive.ph',
    'archive.today',
    'archive.fo',
    'archive.li',
    'archive.md',
    'archive.vn'
  ]
  const archiveHostCacheKey = 'paywall_bypass_archive_host'
  const archiveHostCacheTtlMs = 10 * 60 * 1000

  function sleep (t) {
    return new Promise(resolve => setTimeout(resolve, t))
  }

  function getCachedArchiveHostname () {
    try {
      const raw = window.sessionStorage.getItem(archiveHostCacheKey)
      if (!raw) return null

      const cache = JSON.parse(raw)
      if (!cache || typeof cache.hostname !== 'string' || typeof cache.ts !== 'number') {
        return null
      }

      const isFresh = Date.now() - cache.ts < archiveHostCacheTtlMs
      const isKnownHost = hostnames.includes(cache.hostname)

      if (isFresh && isKnownHost) {
        return cache.hostname
      }
    } catch (err) {
      console.debug('No usable archive host cache', err)
    }

    return null
  }

  function setCachedArchiveHostname (hostname) {
    try {
      window.sessionStorage.setItem(archiveHostCacheKey, JSON.stringify({
        hostname,
        ts: Date.now()
      }))
    } catch (err) {
      console.debug('Cannot persist archive host cache', err)
    }
  }

  function clearCachedArchiveHostname () {
    try {
      window.sessionStorage.removeItem(archiveHostCacheKey)
    } catch (err) {
      console.debug('Cannot clear archive host cache', err)
    }
  }

  function checkAvailability (hostname) {
    return new Promise(function (resolve, reject) {
      const onResponse = function (response) {
        const status = response && typeof response.status === 'number' ? response.status : 0
        if ((status >= 200 && status <= 400) || status === 429) {
          resolve(response)
        } else {
          reject(new Error('HOST_UNAVAILABLE'))
        }
      }
      GM.xmlHttpRequest({
        url: `https://${hostname}/`,
        method: 'GET',
        timeout: 5000,
        headers: {
          Range: 'bytes=0-63'
        },
        onload: onResponse,
        ontimeout: onResponse,
        onerror: onResponse
      })
    })
  }

  function showSpinner (msg) {
    let style = document.getElementById('check_host_style')
    if (!style) {
      style = document.head.appendChild(document.createElement('style'))
      style.setAttribute('id', 'check_host_style')
      style.textContent = `
        #check_host_spinner {
          position: fixed;
          background: #fff;
          height: 2.2em;
          top: 1em;
          left: 50%;
          transform: translate(-50%, 0);
          z-index: 1000;
          border-radius: 5px;
          border: 1px solid black;
          color: black;
          min-width: 7em;
          padding:3px;
        }
        #check_host_spinner .spinner-element {
          animation-duration: 1s;
          animation-iteration-count: infinite;
          animation-name: slide;
          animation-timing-function: linear;
          animation-direction: alternate-reverse;
          animation-play-state: running;
          background-color: #000;
          border-radius: 50%;
          border: 2px solid #fff;
          color: #fff;
          height: 1em;
          margin: auto;
          margin-left: 0;
          width: 1em;
          margin-top: -0.5em;
        }

        @keyframes slide {
          from {
            margin-left:0
          }
          to {
            margin-left:80%
          }
        }
      `
    }

    let div = document.getElementById('check_host_spinner')
    if (!div) {
      div = document.body.appendChild(document.createElement('div'))
      div.setAttribute('id', 'check_host_spinner')
      const text = div.appendChild(document.createElement('span'))
      text.setAttribute('id', 'check_host_text')
      const spinner = div.appendChild(document.createElement('div'))
      spinner.classList.add('spinner-element')
    }
    document.getElementById('check_host_text').innerHTML = msg || ''
    document.querySelector('#check_host_spinner .spinner-element').style.display = 'block'
  }

  function stopSpinner () {
    const e = document.querySelector('#check_host_spinner .spinner-element')
    if (e) {
      e.style.display = 'none'
    }
  }

  function hasPaywallElements (doc, selectors) {
    return selectors.some(selector => doc.querySelector(selector))
  }

  function hasJsonLdPaywall (doc) {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]')
    for (const script of scripts) {
      const text = script.textContent || ''
      if (!text) continue

      // Many publishers expose hard/soft paywalls through schema.org metadata.
      if (/"isAccessibleForFree"\s*:\s*false/i.test(text)) {
        return true
      }
    }
    return false
  }

  function checkSitePaywall (doc, selectors) {
    return hasPaywallElements(doc, selectors) || hasJsonLdPaywall(doc)
  }

  function hostnameMatches (hostname, siteHostname) {
    if (!siteHostname) return false

    // Match leading-dot suffixes like `.faz.net`
    if (siteHostname.startsWith('.')) {
      return hostname.endsWith(siteHostname)
    }

    // Match prefix patterns like `archive.` for `archive.today`, `archive.ph`, ...
    if (siteHostname.endsWith('.')) {
      const exact = siteHostname.slice(0, -1)
      return hostname === exact || hostname.startsWith(siteHostname)
    }

    return hostname === siteHostname || hostname.endsWith(`.${siteHostname}`)
  }

  async function archivePage (url) {
    window.setTimeout(() => showSpinner('archive'), 0)

    // Check which hostname of archive is currently available
    let workingHostname = null
    const cachedHostname = getCachedArchiveHostname()
    const hostnamesToCheck = cachedHostname
      ? [cachedHostname, ...hostnames.filter(hostname => hostname !== cachedHostname)]
      : hostnames

    for (const hostname of hostnamesToCheck) {
      try {
        window.setTimeout(() => showSpinner(hostname), 0)
        await checkAvailability(hostname)
        workingHostname = hostname
        setCachedArchiveHostname(hostname)
        break
      } catch (err) {
        if (err && 'message' in err && err.message === 'HOST_UNAVAILABLE') {
          if (hostname === cachedHostname) {
            clearCachedArchiveHostname()
          }
          console.debug(`${hostname} is NOT available`)
        } else {
          throw err
        }
      }
    }

    if (workingHostname) {
      const redirectUrl = `https://${workingHostname}/submit/?url=${encodeURIComponent(url)}`
      
      // push current url to document history
      document.location.assign(url)
      // wait that the url is pushed to history
      setTimeout(() => {
        document.location.assign(redirectUrl)
      }, 100)
      
     document.location.href = redirectUrl
    } else {
      window.setTimeout(() => {
        showSpinner(`<a href="https://archive.today/submit/?url=${encodeURIComponent(url)}">Try archive.today</a>`)
        stopSpinner()
      }, 200)
      window.alert(scriptName +
        '\n\nSorry, all of the archive.today domains seem to be down.\n\nChecked:\n' +
        hostnames.join('\n') +
        '\n\nIf you are using a Cloudflare DNS, try to switch to another DNS provider or use a VPN. Currently Cloudflare can\'t reliably resolve archive.today.')
    }
  }

  GM.registerMenuCommand(scriptName + ' - Archive.today page', () => archivePage(document.location.href))

  let running = false
  let checking = false
  let firstRun = true

  async function main () {
    if (running || checking) {
      return
    }
    checking = true

    try {

      // {
      //   hostname: 'spiegel.de',
      //   check: (doc, win) => {},
      //   waitOnFirstRun: true, // optional: defaults to false
      //   action: (doc, win) => {}, // optional - defaults to `archivePage`
      // }

      const sites = [
        {
          hostname: 'bazonline.ch',
          check: (doc) => {
            return doc.location.pathname.length > 1 && checkSitePaywall(doc, [
              '#paywall',
              '[id*="paywall"]',
              '[class*="paywall"]',
              '[class*="metered"]',
              '[class*="plus"]',
              '[data-testid*="paywall"]'
            ])
          }
        },
        {
          hostname: 'nzz.ch',
          check: (doc) => {
            return doc.location.pathname.length > 1 && checkSitePaywall(doc, [
              '#paywall',
              '[id*="paywall"]',
              '[class*="paywall"]',
              '[class*="nzzplus"]',
              '[class*="metered"]',
              '[data-testid*="paywall"]'
            ])
          }
        },
        {
          hostname: 'ga.de',
          check: (doc) => {
            return doc.location.pathname.length > 1 && checkSitePaywall(doc, [
              '#paywall',
              '[id*="paywall"]',
              '[class*="paywall"]',
              '[class*="piano"]',
              '[data-area*="paywall"]',
              '[data-testid*="paywall"]'
            ])
          }
        },
        {
          hostname: 'rp-online.de',
          check: (doc) => {
            return doc.location.pathname.length > 1 && checkSitePaywall(doc, [
              '#paywall',
              '[id*="paywall"]',
              '[class*="paywall"]',
              '[class*="piano"]',
              '[data-area*="paywall"]',
              '[data-testid*="paywall"]'
            ])
          }
        },
        {
          hostname: 'bild.de',
          check: (doc) => {
            return doc.querySelector('ps-lefty-next-web')
          }
        },
        {
          hostname: 'badische-zeitung.de',
          check: (doc) => {
            return doc.location.pathname.length > 1 && checkSitePaywall(doc, [
              '#paywall',
              '[id*="paywall"]',
              '[class*="paywall"]',
              '[class*="bzplus"]',
              '[data-area*="paywall"]',
              '[data-testid*="paywall"]'
            ])
          }
        },
        {
          hostname: 'heise.de',
          check: (doc) => {
            return doc.querySelector('.js-upscore-article-content-for-paywall')
          }
        },
        {
          hostname: 'waz.de',
          check: (doc) => {
            return doc.location.pathname.length > 1 && checkSitePaywall(doc, [
              '#paywall',
              '[id*="paywall"]',
              '[class*="paywall"]',
              '[class*="piano"]',
              '[data-qa*="paywall"]',
              '[data-testid*="paywall"]'
            ])
          }
        },
        {
          hostname: 'berliner-zeitung.de',
          check: (doc) => {
            return doc.location.pathname.length > 1 && checkSitePaywall(doc, [
              '#paywall',
              '[id*="paywall"]',
              '[class*="paywall"]',
              '[class*="metered"]',
              '[class*="paid-content"]',
              '[data-area*="paywall"]'
            ])
          }
        },
        {
          hostname: 'welt.de',
          check: (doc) => {
            return doc.location.pathname.length > 1 && checkSitePaywall(doc, [
              '#paywall',
              '[id*="paywall"]',
              '[class*="paywall"]',
              '[class*="c-paywall"]',
              '[class*="o-paywall"]',
              '[data-testid*="paywall"]'
            ])
          }
        },
        {
          hostname: 'freitag.de',
          check: (doc) => {
            return doc.location.pathname.length > 1 && checkSitePaywall(doc, [
              '#paywall',
              '[id*="paywall"]',
              '[class*="paywall"]',
              '[class*="pluswall"]',
              '[class*="paid-content"]',
              '[data-area*="paywall"]'
            ])
          }
        },
        {
          hostname: 'spiegel.de',
          check: (doc) => {
            return doc.location.pathname.length > 1 && (
              doc.querySelector('[data-area="paywall"]') || (
                doc.querySelector('#Inhalt article header #spon-spplus-flag-l') &&
                    doc.querySelectorAll('article h2').length === 1
              )
            )
          }
        },
        {
          hostname: 'tagesspiegel.de',
          check: (doc) => {
            return doc.querySelectorAll('#paywall').length !== 0
          }
        },
        {
          hostname: 'zeit.de',
          check: (doc, win) => {
            return doc.location.pathname.length > 1 && (
              doc.querySelector('.zplus-badge__link') ||
                (doc.getElementById('paywall')?.childElementCount ?? 0) !== 0 ||
                ('k5aMeta' in win && win.k5aMeta.paywall === 'hard')
            )
          }
        },
        {
          hostname: '.faz.net',
          waitOnFirstRun: 6000,
          check: (doc) => {
            return doc.location.pathname.endsWith('.html') &&
                doc.querySelectorAll('.article [data-external-selector="header-title"]').length === 1 && ( // one heading -> article page
              doc.querySelector('[class*=atc-ContainerPaywall]') || // desktop
                    doc.querySelector('.wall.paywall') // desktop & mobile
            )
          }
        },
        {
          hostname: 'zerohedge.com',
          check: (doc, win) => {
            return doc.location.pathname.length > 1 && (
              doc.querySelector('[class*=PremiumOverlay] [class*=PremiumOverlay]') ||
                ('__NEXT_DATA__' in win && win.__NEXT_DATA__.props?.pageProps?.node?.isPremium === true)
            )
          }
        },
        {
          hostname: 'sz-magazin.sueddeutsche.de',
          check: (doc) => {
            return doc.location.search.includes('reduced=true') &&
                doc.querySelector('.articlemain__inner--reduced .paragraph--reduced')
          }
        },
        {
          hostname: 'sueddeutsche.de',
          check: (doc) => {
            return doc.location.search.includes('reduced=true') &&
                doc.querySelector('#sz-paywall iframe')
          }
        },
        {
          hostname: 'nytimes.com',
          check: (doc) => {
            return doc.querySelectorAll('#gateway-content iframe').length === 1
          }
        },
        {
          hostname: 'archive.',
          check: (doc) => {
            return doc.querySelector('form#submiturl [type=submit]')
          },
          action: (doc) => {
            const inputField = doc.querySelector('form#submiturl input#url')
            const submitButton = doc.querySelector('form#submiturl [type=submit]')
            const m = doc.location.search.match(/url=([^&]+)/)
            if (submitButton && inputField && m) {
              inputField.value = decodeURIComponent(m[1])
              submitButton.click()
            }
          }
        },
        {
          hostname: 'archive.',
          check: (doc, win) => {
            const input = doc.querySelector('#HEADER form input[name="q"]')
            if (!input || !input.value) return false

            let inputHostname
            try {
              const url = new URL(input.value)
              inputHostname = url.hostname
            } catch (err) {
              console.warn('Invalid URL in input:', input.value)
              return false
            }

            return sites.some(site =>
              site.hostname !== 'archive.' &&
                hostnameMatches(inputHostname, site.hostname) &&
                site.check(doc, win)
            )
          },
          action: (doc, win) => {
            // Redirect to history of this page, if there is also a paywall in this archive
            // Only redirect once for this session
            const key = doc.location.href
            const alreadyRedirected = win.sessionStorage.getItem(key)
            const historyLink = Array.from(doc.querySelectorAll('#HEADER form a'))
              .find(e => e.textContent.includes('history'))

            if (!alreadyRedirected && historyLink) {
              win.sessionStorage.setItem(key, '1')
              historyLink.click()
            }
          }
        }
      ]

      for (const site of sites) {
        if (hostnameMatches(document.location.hostname, site.hostname)) {
          const shouldWait = firstRun && site.waitOnFirstRun

          if (shouldWait) {
            // Wait a little the first time to let bypass-paywalls-firefox-clean do the job.
            firstRun = false
            await sleep(typeof site.waitOnFirstRun === 'number' ? site.waitOnFirstRun : 3000)
          }

          const result = await site.check(document, window)
          if (result) {
            running = true

            if (typeof site.action === 'function') {
              site.action(document, window)
            } else {
              await archivePage(document.location.href)
            }

            break
          }
        }
      }
      firstRun = false
    } finally {
      checking = false
    }
  }

  function watchForLatePaywalls (durationMs = 8000) {
    const root = document.documentElement
    if (!root) return

    let rerunTimeout = null
    const observer = new window.MutationObserver(() => {
      if (running) return

      if (rerunTimeout) {
        window.clearTimeout(rerunTimeout)
      }
      rerunTimeout = window.setTimeout(() => {
        void main()
      }, 250)
    })

    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true
    })

    window.setTimeout(() => {
      observer.disconnect()
      if (rerunTimeout) {
        window.clearTimeout(rerunTimeout)
      }
    }, durationMs)
  }

  await main()
  watchForLatePaywalls()
})()
