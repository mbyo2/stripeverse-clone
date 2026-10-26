/*!
 * BMaGlass Pay — universal pay button embed.
 *
 * Renders a "Pay with BMaGlass Pay" button bound to a BMaGlass
 * PAYMENT LINK (created in the app or via the developer API). Works
 * on any site that allows a script tag + a placeholder div: Wix,
 * Squarespace, Webflow, WordPress, static HTML, ...
 *
 * SECURITY MODEL: only the public payment-link URL belongs in a web
 * page. A payment link is a public payment page — anyone with it can
 * view it and pay it (paying requires the buyer's own BMaGlass
 * wallet). Your API key is a SECRET and must never appear in a page:
 * this script actively refuses to run if it sees a bmp_ key in its
 * configuration.
 *
 * Usage:
 *   <div class="bmaglass-pay-button"
 *        data-link="https://bmaglasspay.online/pay/YOUR_LINK_CODE"></div>
 *   <script src="https://bmaglasspay.online/embed/bmaglass-pay-button.js" async></script>
 *
 * Placeholder attributes:
 *   data-link   full payment-link URL (https://bmaglasspay.online/pay/<code>)
 *   data-code   just the link code (alternative to data-link)
 *   data-label  button text (default "Pay with BMaGlass Pay")
 *   data-target "_blank" to open the payment page in a new tab
 */
(function () {
    'use strict';

    var LINK_RE = /^https:\/\/bmaglasspay\.online\/pay\/[A-Za-z0-9_-]+\/?$/;

    function linkFromDataset(ds) {
        if (ds.link) return ds.link.trim();
        if (ds.code) return 'https://bmaglasspay.online/pay/' + ds.code.trim();
        return '';
    }

    function looksLikeSecret(value) {
        return typeof value === 'string' && value.indexOf('bmp_') !== -1;
    }

    function render(placeholder) {
        var ds = placeholder.dataset || {};
        var rawValues = [ds.link, ds.code];
        for (var i = 0; i < rawValues.length; i++) {
            if (looksLikeSecret(rawValues[i])) {
                // Never render, never transmit. Keys are server-side only.
                if (window.console) {
                    console.error('[BMaGlass Pay] Refusing to render: an API key (bmp_...) was placed in the ' +
                        'embed configuration. API keys are secret and must never be embedded in a web page. ' +
                        'Create a payment link instead and use its public URL.');
                }
                return;
            }
        }
        var url = linkFromDataset(ds);
        if (!LINK_RE.test(url)) {
            if (window.console) {
                console.warn('[BMaGlass Pay] Skipping a pay button whose link is not a ' +
                    'https://bmaglasspay.online/pay/<code> URL.');
            }
            return;
        }
        var a = document.createElement('a');
        a.href = url;
        if (ds.target === '_blank') {
            a.target = '_blank';
            a.rel = 'noopener';
        }
        a.textContent = ds.label || 'Pay with BMaGlass Pay';
        a.setAttribute('aria-label', a.textContent);
        a.style.cssText = [
            'display:inline-block',
            'background:#000000',
            'color:#ffffff',
            'font:600 16px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
            'padding:13px 26px',
            'border-radius:999px',
            'text-decoration:none',
            'border-bottom:3px solid #F7931A',
            'cursor:pointer'
        ].join(';');
        if (placeholder.parentNode) {
            placeholder.parentNode.replaceChild(a, placeholder);
        }
    }

    function init() {
        var nodes = document.querySelectorAll('.bmaglass-pay-button');
        for (var i = 0; i < nodes.length; i++) render(nodes[i]);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
