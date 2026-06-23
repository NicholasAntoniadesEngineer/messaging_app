/**
 * Messenger early font-scale bootstrap.
 *
 * H-5 (CSP): extracted from an inline <script> in messenger.html so the page can
 * drop `script-src 'unsafe-inline'`. Loaded in <head> WITHOUT defer so it still
 * runs before first paint and sets the root font size from the saved preference,
 * exactly as the former inline block did.
 */
(function () {
    var scaleToPx = {
        'very-small': 13,
        small: 14,
        medium: 16,
        large: 18,
        'very-large': 20
    };
    var saved = localStorage.getItem('secure_messenger_fontScale') || 'medium';
    document.documentElement.style.fontSize = (scaleToPx[saved] || 16) + 'px';
})();
